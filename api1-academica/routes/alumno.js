const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// =====================================================
// GET /alumnos
// Listar todos los alumnos activos
// Query params opcionales: ?id_curso=N
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { id_curso } = req.query;

  if (id_curso && isNaN(id_curso)) {
    return res.status(400).json({ error: 'id_curso debe ser un número' });
  }

  try {
    let query = `
      SELECT
        a.id, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
        a.email, a.telefono, a.fecha_nacimiento, a.activo,
        c.nombre AS curso
      FROM alumnos a
      LEFT JOIN cursos c ON a.id_curso = c.id
      WHERE a.activo = TRUE
    `;
    const params = [];

    if (id_curso) {
      params.push(id_curso);
      query += ` AND a.id_curso = $${params.length}`;
    }

    query += ' ORDER BY a.apellido_paterno, a.apellido_materno, a.nombre';

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
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /alumnos/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar alumno' });
  }
});

// =====================================================
// DELETE /alumnos/:id
// Desactivar un alumno (soft delete — no se borra de la BD)
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE alumnos SET activo = FALSE WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    res.json({ mensaje: 'Alumno desactivado correctamente', alumno: result.rows[0] });
  } catch (err) {
    console.error('[DELETE /alumnos/:id]', err.message);
    res.status(500).json({ error: 'Error al desactivar alumno' });
  }
});

module.exports = router;
