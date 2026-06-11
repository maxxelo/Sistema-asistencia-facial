const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');
const { registrarOperacion } = require('./bitacora');

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
        c.nombre AS curso, c.id AS id_curso
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
