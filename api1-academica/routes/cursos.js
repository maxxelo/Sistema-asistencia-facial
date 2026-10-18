const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// Un profesor solo puede ser profesor jefe de UN curso activo, y debe estar activo.
// Devuelve el mensaje de error o null si se puede asignar.
async function validarProfesorJefe(idProfesor, idCursoExcluir = null) {
  if (!idProfesor) return null;
  const r = await pool.query(
    `SELECT p.activo,
            (SELECT c.nombre FROM cursos c
              WHERE c.id_profesor_jefe = p.id AND c.activo = TRUE
                AND c.id <> COALESCE($2::int, 0)
              LIMIT 1) AS curso_jefe
     FROM profesores p WHERE p.id = $1`,
    [idProfesor, idCursoExcluir]
  );
  if (!r.rows.length)        return 'El profesor seleccionado no existe';
  if (!r.rows[0].activo)     return 'El profesor seleccionado está desactivado';
  if (r.rows[0].curso_jefe)  return `Ese profesor ya es profesor jefe del curso ${r.rows[0].curso_jefe}`;
  return null;
}

// =====================================================
// GET /cursos
// Listar todos los cursos activos
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const esAdmin = req.usuario.tipo_persona === 'admin';
  try {
    // Admin ve TODOS los cursos. Profesor solo los activos.
    const filtro = esAdmin ? '' : 'WHERE c.activo = TRUE';
    const result = await pool.query(
      `SELECT
        c.id, c.nombre, c.nivel, c.letra, c.anio, c.activo,
        p.id   AS id_profesor_jefe,
        p.nombre || ' ' || p.apellido_paterno AS profesor_jefe,
        COUNT(a.id) AS total_alumnos
       FROM cursos c
       LEFT JOIN profesores p ON c.id_profesor_jefe = p.id
       LEFT JOIN alumnos a ON a.id_curso = c.id AND a.activo = TRUE
       ${filtro}
       GROUP BY c.id, p.id, p.nombre, p.apellido_paterno
       ORDER BY c.activo DESC, c.anio DESC, c.nivel, c.letra`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /cursos]', err.message);
    res.status(500).json({ error: 'Error al obtener cursos' });
  }
});

// =====================================================
// GET /cursos/:id
// Obtener un curso con sus alumnos
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const curso = await pool.query(
      `SELECT
        c.id, c.nombre, c.nivel, c.letra, c.anio, c.activo,
        p.id AS id_profesor_jefe,
        p.nombre || ' ' || p.apellido_paterno AS profesor_jefe
       FROM cursos c
       LEFT JOIN profesores p ON c.id_profesor_jefe = p.id
       WHERE c.id = $1`,
      [id]
    );

    if (curso.rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }

    const alumnos = await pool.query(
      `SELECT id, rut, nombre, apellido_paterno, apellido_materno
       FROM alumnos
       WHERE id_curso = $1 AND activo = TRUE
       ORDER BY apellido_paterno, apellido_materno`,
      [id]
    );

    res.json({ ...curso.rows[0], alumnos: alumnos.rows });
  } catch (err) {
    console.error('[GET /cursos/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener curso' });
  }
});

// =====================================================
// POST /cursos
// Crear un nuevo curso
// Body: { nombre, nivel, letra, anio, id_profesor_jefe }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, nivel, letra, anio, id_profesor_jefe } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El campo nombre es requerido' });
  }

  try {
    const anioFinal = anio ?? new Date().getFullYear();

    // Evitar cursos duplicados (mismo nombre y año)
    const dup = await pool.query(
      'SELECT id FROM cursos WHERE LOWER(nombre) = LOWER($1) AND anio = $2',
      [nombre, anioFinal]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `Ya existe el curso "${nombre}" para el año ${anioFinal}` });
    }

    const errJefe = await validarProfesorJefe(id_profesor_jefe);
    if (errJefe) return res.status(409).json({ error: errJefe });

    const result = await pool.query(
      `INSERT INTO cursos (nombre, nivel, letra, anio, id_profesor_jefe)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, nivel ?? null, letra ?? null,
       anioFinal, id_profesor_jefe ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /cursos]', err.message);
    res.status(500).json({ error: 'Error al crear curso' });
  }
});

// =====================================================
// PUT /cursos/:id
// Actualizar un curso
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre, nivel, letra, anio, id_profesor_jefe } = req.body;

  try {
    // Evitar que la edición genere un curso duplicado (mismo nombre y año)
    const actual = await pool.query('SELECT nombre, anio FROM cursos WHERE id = $1', [id]);
    if (actual.rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    const nombreFinal = nombre ?? actual.rows[0].nombre;
    const anioFinal   = anio   ?? actual.rows[0].anio;
    const dup = await pool.query(
      'SELECT id FROM cursos WHERE LOWER(nombre) = LOWER($1) AND anio = $2 AND id <> $3',
      [nombreFinal, anioFinal, id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: `Ya existe el curso "${nombreFinal}" para el año ${anioFinal}` });
    }

    const errJefe = await validarProfesorJefe(id_profesor_jefe, id);
    if (errJefe) return res.status(409).json({ error: errJefe });

    const result = await pool.query(
      `UPDATE cursos SET
        nombre           = COALESCE($1, nombre),
        nivel            = COALESCE($2, nivel),
        letra            = COALESCE($3, letra),
        anio             = COALESCE($4, anio),
        id_profesor_jefe = COALESCE($5, id_profesor_jefe)
       WHERE id = $6
       RETURNING *`,
      [nombre, nivel, letra, anio, id_profesor_jefe, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /cursos/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar curso' });
  }
});

// =====================================================
// PATCH /cursos/:id/jefe
// Asigna o quita el profesor jefe de un curso.
// Body: { id_profesor_jefe: number | null }
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/jefe', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  // Aceptar null explícito para quitar el profesor jefe
  const id_profesor_jefe = req.body.id_profesor_jefe ?? null;

  try {
    const errJefe = await validarProfesorJefe(id_profesor_jefe, id);
    if (errJefe) return res.status(409).json({ error: errJefe });

    const result = await pool.query(
      'UPDATE cursos SET id_profesor_jefe = $1 WHERE id = $2 RETURNING id, nombre',
      [id_profesor_jefe, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Curso no encontrado' });
    const msg = id_profesor_jefe
      ? `Profesor jefe asignado al curso ${result.rows[0].nombre}`
      : `Profesor jefe removido del curso ${result.rows[0].nombre}`;
    res.json({ mensaje: msg });
  } catch (err) {
    console.error('[PATCH /cursos/:id/jefe]', err.message);
    res.status(500).json({ error: 'Error al actualizar profesor jefe' });
  }
});

// =====================================================
// PATCH /cursos/:id/reactivar
// Reactiva un curso desactivado
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/reactivar', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE cursos SET activo = TRUE WHERE id = $1 RETURNING id, nombre',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Curso no encontrado' });
    res.json({ mensaje: `Curso ${result.rows[0].nombre} reactivado correctamente` });
  } catch (err) {
    console.error('[PATCH /cursos/:id/reactivar]', err.message);
    res.status(500).json({ error: 'Error al reactivar curso' });
  }
});

// =====================================================
// DELETE /cursos/:id
// Elimina permanentemente el curso de la BD.
// Antes verifica que no tenga alumnos activos (para no
// dejarlos sin curso sin querer).
// Las FK con CASCADE borran automáticamente: horarios,
//   asistencia_cabecera (y en cascada asistencia_detalle).
// La FK de alumnos.id_curso → ON DELETE SET NULL deja
//   los alumnos sin curso (id_curso = NULL).
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Bloquear si hay alumnos activos asignados a este curso
    const chk = await pool.query(
      'SELECT COUNT(*) AS total FROM alumnos WHERE id_curso = $1 AND activo = TRUE',
      [id]
    );
    if (parseInt(chk.rows[0].total) > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: el curso tiene ${chk.rows[0].total} alumno(s) activo(s). Reasígnalos a otro curso primero.`
      });
    }

    const result = await pool.query(
      'DELETE FROM cursos WHERE id = $1 RETURNING id, nombre',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    res.json({ mensaje: `Curso ${result.rows[0].nombre} eliminado correctamente` });
  } catch (err) {
    console.error('[DELETE /cursos/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar curso' });
  }
});

module.exports = router;
