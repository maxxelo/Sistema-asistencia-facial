const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// =====================================================
// GET /profesores
// Listar todos los profesores activos
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id, rut, nombre, apellido_paterno, apellido_materno,
        email, telefono, especialidad, activo
       FROM profesores
       WHERE activo = TRUE
       ORDER BY apellido_paterno, apellido_materno, nombre`
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
// PUT /profesores/:id
// Actualizar datos de un profesor
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre, apellido_paterno, apellido_materno, email, telefono, especialidad } = req.body;

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
// DELETE /profesores/:id
// Desactivar un profesor (soft delete)
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'UPDATE profesores SET activo = FALSE WHERE id = $1 RETURNING id, nombre, apellido_paterno',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }
    res.json({ mensaje: 'Profesor desactivado correctamente', profesor: result.rows[0] });
  } catch (err) {
    console.error('[DELETE /profesores/:id]', err.message);
    res.status(500).json({ error: 'Error al desactivar profesor' });
  }
});

module.exports = router;
