const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, adminOProfesor } = require('../middleware/auth');

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
        c.id   AS id_curso,
        c.nombre AS curso,
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

module.exports = router;
