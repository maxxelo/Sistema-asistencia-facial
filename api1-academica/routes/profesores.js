const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');
const { validarPersona } = require('../lib/validaciones');

// =====================================================
// GET /profesores
// Listar todos los profesores activos
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const esAdmin = req.usuario.tipo_persona === 'admin';
  try {
    // Admin ve TODOS los profesores. Profesor solo los activos.
    const filtro = esAdmin ? '' : 'WHERE activo = TRUE';
    const result = await pool.query(
      `SELECT
        id, rut, nombre, apellido_paterno, apellido_materno,
        email, telefono, especialidad, activo
       FROM profesores
       ${filtro}
       ORDER BY activo DESC, apellido_paterno, nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /profesores]', err.message);
    res.status(500).json({ error: 'Error al obtener profesores' });
  }
});

// =====================================================
// GET /profesores/:id
// Obtener un profesor con sus cursos asignados
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const profesor = await pool.query(
      `SELECT id, rut, nombre, apellido_paterno, apellido_materno,
              email, telefono, especialidad, activo
       FROM profesores WHERE id = $1`,
      [id]
    );

    if (profesor.rows.length === 0) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }

    const cursos = await pool.query(
      `SELECT DISTINCT c.id, c.nombre, asig.nombre AS asignatura
       FROM horarios h
       JOIN cursos c ON h.id_curso = c.id
       JOIN asignaturas asig ON h.id_asignatura = asig.id
       WHERE h.id_profesor = $1 AND c.activo = TRUE
       ORDER BY c.nombre`,
      [id]
    );

    res.json({ ...profesor.rows[0], cursos: cursos.rows });
  } catch (err) {
    console.error('[GET /profesores/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener profesor' });
  }
});

// =====================================================
// POST /profesores
// Crear un nuevo profesor
// Body: { rut, nombre, apellido_paterno, apellido_materno, email, telefono, especialidad }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { rut, nombre, apellido_paterno, apellido_materno, email, telefono, especialidad } = req.body;

  if (!rut || !nombre || !apellido_paterno) {
    return res.status(400).json({ error: 'Campos requeridos: rut, nombre, apellido_paterno' });
  }
  const errorDatos = validarPersona(req.body);
  if (errorDatos) return res.status(400).json({ error: errorDatos });

  try {
    const result = await pool.query(
      `INSERT INTO profesores (rut, nombre, apellido_paterno, apellido_materno, email, telefono, especialidad)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [rut, nombre, apellido_paterno, apellido_materno ?? null,
       email ?? null, telefono ?? null, especialidad ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un profesor con ese RUT' });
    }
    console.error('[POST /profesores]', err.message);
    res.status(500).json({ error: 'Error al crear profesor' });
  }
});

// =====================================================
// POST /profesores/importar
// Importación masiva. Body: { profesores: [{ rut, nombre, apellido_paterno,
//   apellido_materno?, email?, telefono?, especialidad? }] }
// Devuelve resumen: { importados, total, errores: [{ fila, rut, error }] }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/importar', verificarToken, soloAdmin, async (req, res) => {
  const { profesores } = req.body;
  if (!Array.isArray(profesores) || !profesores.length)
    return res.status(400).json({ error: 'Se requiere un array "profesores" con al menos una fila' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let importados = 0;
    const errores = [];

    for (let i = 0; i < profesores.length; i++) {
      const p = profesores[i];
      const fila = i + 1;
      const rut = (p.rut || '').trim();

      if (!rut || !p.nombre || !p.apellido_paterno) {
        errores.push({ fila, rut, error: 'Faltan campos requeridos (rut, nombre, apellido_paterno)' });
        continue;
      }
      const errorFila = validarPersona(p);
      if (errorFila) { errores.push({ fila, rut, error: errorFila }); continue; }
      try {
        await client.query(
          `INSERT INTO profesores (rut, nombre, apellido_paterno, apellido_materno, email, telefono, especialidad)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [rut, p.nombre.trim(), p.apellido_paterno.trim(),
           p.apellido_materno?.trim() || null, p.email?.trim() || null,
           p.telefono?.trim() || null, p.especialidad?.trim() || null]
        );
        importados++;
      } catch (e) {
        errores.push({ fila, rut, error: e.code === '23505' ? 'RUT ya existe' : 'Error al insertar' });
      }
    }

    await client.query('COMMIT');
    res.json({ importados, total: profesores.length, errores });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /profesores/importar]', err.message);
    res.status(500).json({ error: 'Error al importar profesores' });
  } finally {
    client.release();
  }
});

// =====================================================
// PUT /profesores/:id
// Actualizar datos de un profesor
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre, apellido_paterno, apellido_materno, email, telefono, especialidad } = req.body;
  const errorDatos = validarPersona(req.body);
  if (errorDatos) return res.status(400).json({ error: errorDatos });

  try {
    const result = await pool.query(
      `UPDATE profesores SET
        nombre           = COALESCE($1, nombre),
        apellido_paterno = COALESCE($2, apellido_paterno),
        apellido_materno = COALESCE($3, apellido_materno),
        email            = COALESCE($4, email),
        telefono         = COALESCE($5, telefono),
        especialidad     = COALESCE($6, especialidad)
       WHERE id = $7
       RETURNING *`,
      [nombre, apellido_paterno, apellido_materno, email, telefono, especialidad, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /profesores/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar profesor' });
  }
});

// =====================================================
// PATCH /profesores/:id/reactivar
// Reactiva un profesor desactivado
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/reactivar', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE profesores SET activo = TRUE WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profesor no encontrado' });
    const p = result.rows[0];
    res.json({ mensaje: `Profesor ${p.nombre} ${p.apellido_paterno} reactivado correctamente` });
  } catch (err) {
    console.error('[PATCH /profesores/:id/reactivar]', err.message);
    res.status(500).json({ error: 'Error al reactivar profesor' });
  }
});

// =====================================================
// DELETE /profesores/:id
// Elimina permanentemente al profesor de la BD.
// Las FK con CASCADE borran automáticamente: horarios
// Las FK con SET NULL dejan NULL en:
//   cursos.id_profesor_jefe, asistencia_cabecera.id_profesor,
//   usuarios.id_profesor (el usuario queda huérfano pero no se borra)
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Sus horarios se borran en CASCADE, y con ellos toda la asistencia de esas clases
    const chk = await pool.query(
      `SELECT COUNT(DISTINCT h.id)::int AS horarios, COUNT(ac.id)::int AS asistencias
       FROM horarios h
       LEFT JOIN asistencia_cabecera ac ON ac.id_horario = h.id
       WHERE h.id_profesor = $1`, [id]
    );
    if (chk.rows[0].asistencias > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: sus ${chk.rows[0].horarios} horario(s) tienen ${chk.rows[0].asistencias} registro(s) de asistencia ` +
               'que se perderían. Reasigna esos horarios a otro profesor (editando cada horario) antes de eliminarlo.'
      });
    }

    const result = await pool.query(
      'DELETE FROM profesores WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }
    const p = result.rows[0];
    res.json({ mensaje: `Profesor ${p.nombre} ${p.apellido_paterno} eliminado correctamente` });
  } catch (err) {
    console.error('[DELETE /profesores/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar profesor' });
  }
});

module.exports = router;
