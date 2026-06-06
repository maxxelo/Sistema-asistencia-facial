const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

const DIAS_VALIDOS = { 1:'Lunes', 2:'Martes', 3:'Miércoles', 4:'Jueves', 5:'Viernes', 6:'Sábado', 7:'Domingo' };

// =====================================================
// GET /horarios
// Listar horarios, filtrable por dia_semana y/o id_curso
// Query params opcionales: ?dia_semana=N  ?id_curso=N
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { dia_semana, id_curso } = req.query;

  try {
    const params = [];
    let where = 'WHERE c.activo = TRUE';

    if (dia_semana) {
      params.push(dia_semana);
      where += ` AND h.dia_semana = $${params.length}`;
    }
    if (id_curso) {
      params.push(id_curso);
      where += ` AND h.id_curso = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
        h.id,
        h.dia_semana,
        h.hora_inicio,
        h.hora_fin,
        h.sala,
        h.id_curso,
        h.id_asignatura,
        h.id_profesor,
        c.nombre   AS curso,
        asig.nombre AS asignatura,
        p.nombre || ' ' || p.apellido_paterno AS profesor
       FROM horarios h
       JOIN cursos      c    ON h.id_curso      = c.id
       JOIN asignaturas asig ON h.id_asignatura = asig.id
       JOIN profesores  p    ON h.id_profesor   = p.id
       ${where}
       ORDER BY h.dia_semana, h.hora_inicio`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /horarios]', err.message);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
});

// =====================================================
// POST /horarios
// Crear un bloque horario
// Body: { id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala? }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala } = req.body;

  if (!id_curso || !id_asignatura || !id_profesor || !dia_semana || !hora_inicio || !hora_fin) {
    return res.status(400).json({
      error: 'Campos requeridos: id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin'
    });
  }

  const diaNum = parseInt(dia_semana);
  if (!DIAS_VALIDOS[diaNum]) {
    return res.status(400).json({ error: 'dia_semana debe estar entre 1 (Lunes) y 7 (Domingo)' });
  }

  if (hora_inicio >= hora_fin) {
    return res.status(400).json({ error: 'hora_fin debe ser mayor que hora_inicio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO horarios (id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id_curso, id_asignatura, id_profesor, diaNum, hora_inicio, hora_fin,
       sala ? sala.trim().toUpperCase() : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Ya existe un horario para ese curso, asignatura, día y hora de inicio'
      });
    }
    console.error('[POST /horarios]', err.message);
    res.status(500).json({ error: 'Error al crear horario' });
  }
});

// =====================================================
// PUT /horarios/:id
// Actualizar un bloque horario
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala } = req.body;

  const diaNum = dia_semana ? parseInt(dia_semana) : null;
  if (diaNum && !DIAS_VALIDOS[diaNum]) {
    return res.status(400).json({ error: 'dia_semana debe estar entre 1 y 7' });
  }

  try {
    const result = await pool.query(
      `UPDATE horarios SET
        id_curso      = COALESCE($1, id_curso),
        id_asignatura = COALESCE($2, id_asignatura),
        id_profesor   = COALESCE($3, id_profesor),
        dia_semana    = COALESCE($4, dia_semana),
        hora_inicio   = COALESCE($5, hora_inicio),
        hora_fin      = COALESCE($6, hora_fin),
        sala          = COALESCE($7, sala)
       WHERE id = $8
       RETURNING *`,
      [id_curso ?? null, id_asignatura ?? null, id_profesor ?? null,
       diaNum, hora_inicio ?? null, hora_fin ?? null,
       sala ? sala.trim().toUpperCase() : null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Horario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un horario con esos datos' });
    }
    console.error('[PUT /horarios/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar horario' });
  }
});

// =====================================================
// DELETE /horarios/:id
// Eliminar un bloque horario
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM horarios WHERE id = $1 RETURNING id', [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Horario no encontrado' });
    res.json({ mensaje: 'Horario eliminado correctamente' });
  } catch (err) {
    console.error('[DELETE /horarios/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar horario' });
  }
});

module.exports = router;
