const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// =====================================================
// GET /cursos
// Listar todos los cursos activos
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id, c.nombre, c.nivel, c.letra, c.anio, c.activo,
        p.id   AS id_profesor_jefe,
        p.nombre || ' ' || p.apellido_paterno AS profesor_jefe,
        COUNT(a.id) AS total_alumnos
       FROM cursos c
       LEFT JOIN profesores p ON c.id_profesor_jefe = p.id
       LEFT JOIN alumnos a ON a.id_curso = c.id AND a.activo = TRUE
       WHERE c.activo = TRUE
       GROUP BY c.id, p.id, p.nombre, p.apellido_paterno
       ORDER BY c.anio DESC, c.nivel, c.letra`
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
    const result = await pool.query(
      `INSERT INTO cursos (nombre, nivel, letra, anio, id_profesor_jefe)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, nivel ?? null, letra ?? null,
       anio ?? new Date().getFullYear(), id_profesor_jefe ?? null]
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
// DELETE /cursos/:id
// Desactivar un curso (soft delete)
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE cursos SET activo = FALSE WHERE id = $1 RETURNING id, nombre',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Curso no encontrado' });
    }
    res.json({ mensaje: 'Curso desactivado correctamente', curso: result.rows[0] });
  } catch (err) {
    console.error('[DELETE /cursos/:id]', err.message);
    res.status(500).json({ error: 'Error al desactivar curso' });
  }
});

module.exports = router;
