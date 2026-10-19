const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');
const { registrarOperacion } = require('./bitacora');
const { validarPersona } = require('../lib/validaciones');

// =====================================================
// GET /alumnos
// Listar todos los alumnos activos
// Query params opcionales: ?id_curso=N
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { id_curso } = req.query;
  const esAdmin = req.usuario.tipo_persona === 'admin';

  if (id_curso && isNaN(id_curso)) {
    return res.status(400).json({ error: 'id_curso debe ser un número' });
  }

  try {
    // Admin ve TODOS (activos e inactivos). Profesor solo ve activos.
    let query = `
      SELECT
        a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
        a.email, a.telefono, a.fecha_nacimiento, a.activo,
        a.consentimiento_biometrico, a.consentimiento_fecha,
        c.nombre AS curso, c.id AS id_curso,
        EXISTS(SELECT 1 FROM rostros r WHERE r.id_alumno = a.id AND r.activo = TRUE) AS tiene_rostro
      FROM alumnos a
      LEFT JOIN cursos c ON a.id_curso = c.id
      WHERE 1=1
    `;
    if (!esAdmin) query += ' AND a.activo = TRUE';

    const params = [];
    if (id_curso) {
      params.push(id_curso);
      query += ` AND a.id_curso = $${params.length}`;
    }

    // Activos primero, luego inactivos; dentro de cada grupo por apellido
    query += ' ORDER BY a.activo DESC, a.apellido_paterno, a.nombre';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /alumnos]', err.message);
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

// =====================================================
// GET /alumnos/:id
// Obtener un alumno por ID
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      `SELECT
        a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
        a.email, a.telefono, a.direccion, a.fecha_nacimiento, a.activo,
        a.consentimiento_biometrico, a.consentimiento_fecha,
        a.consentimiento_id_apoderado,
        c.id AS id_curso, c.nombre AS curso
       FROM alumnos a
       LEFT JOIN cursos c ON a.id_curso = c.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /alumnos/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener alumno' });
  }
});

// =====================================================
// POST /alumnos
// Crear un nuevo alumno
// Body: { rut, nombre, apellido_paterno, apellido_materno, email, telefono, direccion, fecha_nacimiento, id_curso }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const {
    rut, nombre, apellido_paterno, apellido_materno,
    email, telefono, direccion, fecha_nacimiento, id_curso
  } = req.body;

  if (!rut || !nombre || !apellido_paterno) {
    return res.status(400).json({ error: 'Campos requeridos: rut, nombre, apellido_paterno' });
  }
  const errorDatos = validarPersona(req.body);
  if (errorDatos) return res.status(400).json({ error: errorDatos });

  try {
    const result = await pool.query(
      `INSERT INTO alumnos
         (rut, nombre, apellido_paterno, apellido_materno, email, telefono, direccion, fecha_nacimiento, id_curso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [rut, nombre, apellido_paterno, apellido_materno ?? null,
       email ?? null, telefono ?? null, direccion ?? null,
       fecha_nacimiento ?? null, id_curso ?? null]
    );
    registrarOperacion(req.usuario.id, 'CREAR alumno', 'alumnos', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un alumno con ese RUT' });
    }
    console.error('[POST /alumnos]', err.message);
    res.status(500).json({ error: 'Error al crear alumno' });
  }
});

// =====================================================
// POST /alumnos/importar
// Importación masiva. Body: { alumnos: [{ rut, nombre, apellido_paterno,
//   apellido_materno?, email?, telefono?, curso? }] }
// El campo "curso" acepta el NOMBRE del curso (ej: "3°A") o un id numérico.
// Devuelve resumen: { importados, errores: [{ fila, rut, error }] }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/importar', verificarToken, soloAdmin, async (req, res) => {
  const { alumnos } = req.body;
  if (!Array.isArray(alumnos) || !alumnos.length)
    return res.status(400).json({ error: 'Se requiere un array "alumnos" con al menos una fila' });

  const client = await pool.connect();
  try {
    // Mapa nombre_curso (en minúsculas) → id, para resolver el curso por nombre
    const cursosRes = await client.query('SELECT id, nombre FROM cursos WHERE activo = TRUE');
    const mapaCursos = new Map(cursosRes.rows.map(c => [c.nombre.toLowerCase().trim(), c.id]));

    await client.query('BEGIN');
    let importados = 0;
    const errores = [];

    for (let i = 0; i < alumnos.length; i++) {
      const a = alumnos[i];
      const fila = i + 1;
      const rut = (a.rut || '').trim();

      if (!rut || !a.nombre || !a.apellido_paterno) {
        errores.push({ fila, rut, error: 'Faltan campos requeridos (rut, nombre, apellido_paterno)' });
        continue;
      }
      const errorFila = validarPersona(a);
      if (errorFila) { errores.push({ fila, rut, error: errorFila }); continue; }

      // Resolver curso: numérico → id directo; texto → buscar por nombre
      let idCurso = null;
      const cursoRaw = (a.curso ?? a.id_curso ?? '').toString().trim();
      if (cursoRaw) {
        if (/^\d+$/.test(cursoRaw)) {
          idCurso = parseInt(cursoRaw);
        } else {
          idCurso = mapaCursos.get(cursoRaw.toLowerCase()) ?? null;
          if (idCurso === null) {
            errores.push({ fila, rut, error: `Curso "${cursoRaw}" no existe` });
            continue;
          }
        }
      }

      try {
        await client.query(
          `INSERT INTO alumnos
             (rut, nombre, apellido_paterno, apellido_materno, email, telefono, id_curso)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rut, a.nombre.trim(), a.apellido_paterno.trim(),
           a.apellido_materno?.trim() || null, a.email?.trim() || null,
           a.telefono?.trim() || null, idCurso]
        );
        importados++;
      } catch (e) {
        errores.push({ fila, rut, error: e.code === '23505' ? 'RUT ya existe' : 'Error al insertar' });
      }
    }

    await client.query('COMMIT');
    res.json({ importados, total: alumnos.length, errores });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /alumnos/importar]', err.message);
    res.status(500).json({ error: 'Error al importar alumnos' });
  } finally {
    client.release();
  }
});

// =====================================================
// PUT /alumnos/:id
// Actualizar datos de un alumno
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const {
    nombre, apellido_paterno, apellido_materno,
    email, telefono, direccion, fecha_nacimiento, id_curso
  } = req.body;
  const errorDatos = validarPersona(req.body);
  if (errorDatos) return res.status(400).json({ error: errorDatos });

  try {
    const result = await pool.query(
      `UPDATE alumnos SET
        nombre           = COALESCE($1, nombre),
        apellido_paterno = COALESCE($2, apellido_paterno),
        apellido_materno = COALESCE($3, apellido_materno),
        email            = COALESCE($4, email),
        telefono         = COALESCE($5, telefono),
        direccion        = COALESCE($6, direccion),
        fecha_nacimiento = COALESCE($7, fecha_nacimiento),
        id_curso         = COALESCE($8, id_curso)
       WHERE id = $9
       RETURNING *`,
      [nombre, apellido_paterno, apellido_materno,
       email, telefono, direccion, fecha_nacimiento,
       id_curso, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    registrarOperacion(req.usuario.id, 'EDITAR alumno', 'alumnos', id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /alumnos/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar alumno' });
  }
});

// =====================================================
// PATCH /alumnos/:id/reactivar
// Reactiva un alumno que fue desactivado (activo = TRUE)
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/reactivar', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE alumnos SET activo = TRUE WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Alumno no encontrado' });
    const a = result.rows[0];
    res.json({ mensaje: `Alumno ${a.nombre} ${a.apellido_paterno} reactivado correctamente` });
  } catch (err) {
    console.error('[PATCH /alumnos/:id/reactivar]', err.message);
    res.status(500).json({ error: 'Error al reactivar alumno' });
  }
});

// =====================================================
// PUT /alumnos/:id/consentimiento
// Registra o revoca el consentimiento del apoderado para el tratamiento de
// datos biométricos del alumno (Leyes N° 19.628 y N° 21.719, R.40).
// Body: { otorgado: true,  id_apoderado: N }  → otorga (el apoderado debe estar vinculado)
//       { otorgado: false }                    → revoca y ELIMINA el rostro registrado
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id/consentimiento', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { otorgado, id_apoderado } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (typeof otorgado !== 'boolean') {
    return res.status(400).json({ error: 'El campo "otorgado" debe ser verdadero o falso' });
  }

  const client = await pool.connect();
  try {
    const alumno = await client.query('SELECT id, nombre, apellido_paterno FROM alumnos WHERE id = $1', [id]);
    if (alumno.rows.length === 0) return res.status(404).json({ error: 'Alumno no encontrado' });

    await client.query('BEGIN');
    let rostroEliminado = false;

    if (otorgado) {
      if (!id_apoderado || isNaN(id_apoderado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Debes indicar el apoderado que otorga el consentimiento' });
      }
      const vinculo = await client.query(
        'SELECT 1 FROM alumnos_apoderados WHERE id_alumno = $1 AND id_apoderado = $2',
        [id, id_apoderado]
      );
      if (vinculo.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El apoderado indicado no está vinculado a este alumno' });
      }
      await client.query(
        `UPDATE alumnos
            SET consentimiento_biometrico = TRUE, consentimiento_fecha = NOW(),
                consentimiento_id_apoderado = $2
          WHERE id = $1`,
        [id, id_apoderado]
      );
    } else {
      await client.query(
        `UPDATE alumnos
            SET consentimiento_biometrico = FALSE, consentimiento_fecha = NOW()
          WHERE id = $1`,
        [id]
      );
      // Derecho de cancelación: sin consentimiento no se conserva el dato biométrico
      const borrado = await client.query('DELETE FROM rostros WHERE id_alumno = $1', [id]);
      rostroEliminado = borrado.rowCount > 0;
    }
    await client.query('COMMIT');

    const a = alumno.rows[0];
    res.json({
      mensaje: otorgado
        ? `Consentimiento registrado para ${a.nombre} ${a.apellido_paterno}`
        : `Consentimiento revocado para ${a.nombre} ${a.apellido_paterno}` +
          (rostroEliminado ? ' y su rostro fue eliminado' : ''),
      consentimiento_biometrico: otorgado,
      rostro_eliminado: rostroEliminado
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PUT /alumnos/:id/consentimiento]', err.message);
    res.status(500).json({ error: 'Error al registrar el consentimiento' });
  } finally {
    client.release();
  }
});

// =====================================================
// DELETE /alumnos/:id
// Elimina permanentemente al alumno de la BD.
// Las FK con CASCADE borran automáticamente:
//   rostros, asistencia_detalle, calificaciones, alumnos_apoderados
// Las FK con SET NULL dejan el id_alumno en NULL:
//   asistencia_facial_log, intentos_reconocimiento
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM alumnos WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    const a = result.rows[0];
    registrarOperacion(req.usuario.id, 'ELIMINAR alumno', 'alumnos', id);
    res.json({ mensaje: `Alumno ${a.nombre} ${a.apellido_paterno} eliminado correctamente` });
  } catch (err) {
    console.error('[DELETE /alumnos/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar alumno' });
  }
});

module.exports = router;
