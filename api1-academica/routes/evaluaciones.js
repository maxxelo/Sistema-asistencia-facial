const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// ─── EVALUACIONES ────────────────────────────────────────────────

// GET /evaluaciones  (filtrables por ?id_asignatura=N &id_periodo=N &id_profesor=N)
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { id_asignatura, id_periodo, id_profesor } = req.query;
  try {
    let where = 'WHERE 1=1'; const params = [];
    if (id_asignatura) { params.push(id_asignatura); where += ` AND e.id_asignatura=$${params.length}`; }
    if (id_periodo)    { params.push(id_periodo);    where += ` AND e.id_periodo=$${params.length}`; }
    if (id_profesor)   { params.push(id_profesor);   where += ` AND e.id_asignatura IN (SELECT DISTINCT id_asignatura FROM horarios WHERE id_profesor=$${params.length})`; }
    const r = await pool.query(
      `SELECT e.*, asig.nombre AS asignatura, asig.codigo AS codigo_asig,
              p.nombre AS periodo
       FROM evaluaciones e
       JOIN asignaturas asig ON e.id_asignatura = asig.id
       JOIN periodos_academicos p ON e.id_periodo = p.id
       ${where} ORDER BY e.fecha DESC`, params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /evaluaciones]', err.message);
    res.status(500).json({ error: 'Error al obtener evaluaciones' });
  }
});

// POST /evaluaciones
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, fecha, id_asignatura, id_periodo, porcentaje, tipo_evaluacion } = req.body;
  if (!nombre || !fecha || !id_asignatura || !id_periodo)
    return res.status(400).json({ error: 'Campos requeridos: nombre, fecha, id_asignatura, id_periodo' });
  const tiposValidos = ['prueba','trabajo','control','examen'];
  if (tipo_evaluacion && !tiposValidos.includes(tipo_evaluacion))
    return res.status(400).json({ error: `tipo_evaluacion debe ser: ${tiposValidos.join(', ')}` });
  try {
    const r = await pool.query(
      `INSERT INTO evaluaciones (nombre, fecha, id_asignatura, id_periodo, porcentaje, tipo_evaluacion)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nombre.trim(), fecha, id_asignatura, id_periodo, porcentaje||null, tipo_evaluacion||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST /evaluaciones]', err.message);
    res.status(500).json({ error: 'Error al crear evaluación' });
  }
});

// PUT /evaluaciones/:id
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, fecha, id_asignatura, id_periodo, porcentaje, tipo_evaluacion } = req.body;
  try {
    const r = await pool.query(
      `UPDATE evaluaciones SET
         nombre=COALESCE($1,nombre), fecha=COALESCE($2,fecha),
         id_asignatura=COALESCE($3,id_asignatura), id_periodo=COALESCE($4,id_periodo),
         porcentaje=COALESCE($5,porcentaje), tipo_evaluacion=COALESCE($6,tipo_evaluacion)
       WHERE id=$7 RETURNING *`,
      [nombre,fecha,id_asignatura,id_periodo,porcentaje,tipo_evaluacion,id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Evaluación no encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /evaluaciones/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar evaluación' });
  }
});

// DELETE /evaluaciones/:id
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const chk = await pool.query('SELECT COUNT(*) FROM calificaciones WHERE id_evaluacion=$1', [id]);
    if (parseInt(chk.rows[0].count) > 0)
      return res.status(409).json({ error: `No se puede eliminar: tiene ${chk.rows[0].count} nota(s) ingresada(s)` });
    const r = await pool.query('DELETE FROM evaluaciones WHERE id=$1 RETURNING nombre', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Evaluación no encontrada' });
    res.json({ mensaje: `Evaluación "${r.rows[0].nombre}" eliminada` });
  } catch (err) {
    console.error('[DELETE /evaluaciones/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar evaluación' });
  }
});

// ─── CALIFICACIONES ──────────────────────────────────────────────

// GET /evaluaciones/:id/calificaciones  — notas de todos los alumnos para una evaluación
router.get('/:id/calificaciones', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  try {
    // Alumnos del curso al que corresponde esta evaluación (via asignatura y horarios)
    const evalRes = await pool.query(
      `SELECT e.*, asig.nombre AS asignatura, c.id AS id_curso, c.nombre AS curso
       FROM evaluaciones e
       JOIN asignaturas asig ON e.id_asignatura = asig.id
       LEFT JOIN horarios h ON h.id_asignatura = e.id_asignatura
       LEFT JOIN cursos c ON h.id_curso = c.id
       WHERE e.id = $1 LIMIT 1`, [id]
    );
    if (!evalRes.rows.length) return res.status(404).json({ error: 'Evaluación no encontrada' });
    const ev = evalRes.rows[0];

    const r = await pool.query(
      `SELECT a.id AS id_alumno, a.rut, a.nombre, a.apellido_paterno, a.apellido_materno,
              cal.id AS id_calificacion, cal.nota, cal.fecha_registro
       FROM alumnos a
       LEFT JOIN calificaciones cal ON cal.id_alumno = a.id AND cal.id_evaluacion = $1
       WHERE a.id_curso = $2 AND a.activo = TRUE
       ORDER BY a.apellido_paterno, a.nombre`, [id, ev.id_curso]
    );
    res.json({ evaluacion: ev, calificaciones: r.rows });
  } catch (err) {
    console.error('[GET /evaluaciones/:id/calificaciones]', err.message);
    res.status(500).json({ error: 'Error al obtener calificaciones' });
  }
});

// POST /evaluaciones/:id/calificaciones  — guardar/actualizar notas en bulk
// Body: { calificaciones: [ {id_alumno, nota} ] }
router.post('/:id/calificaciones', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  const { calificaciones } = req.body;
  if (!Array.isArray(calificaciones) || !calificaciones.length)
    return res.status(400).json({ error: 'Se requiere array calificaciones: [{id_alumno, nota}]' });

  // Escala chilena: 1.0 a 7.0 con un decimal. Una nota mal escrita se rechaza (no se ignora en silencio)
  const malas = calificaciones.filter(c => {
    if (c.nota === null || c.nota === '' || c.nota === undefined) return false;
    const n = Number(c.nota);
    return isNaN(n) || n < 1 || n > 7 || Math.round(n * 10) !== n * 10;
  });
  if (malas.length) {
    return res.status(400).json({ error: `Hay ${malas.length} nota(s) fuera de la escala 1.0 a 7.0 (con un decimal)` });
  }

  try {
    const ev = await pool.query('SELECT id_asignatura FROM evaluaciones WHERE id = $1', [id]);
    if (!ev.rows.length) return res.status(404).json({ error: 'Evaluación no encontrada' });
    // Un profesor solo califica a alumnos de cursos donde dicta esa asignatura
    if (req.usuario.tipo_persona !== 'admin') {
      const ids = calificaciones.map(c => parseInt(c.id_alumno)).filter(n => !isNaN(n));
      const permitidos = await pool.query(
        `SELECT COUNT(*)::int AS n FROM alumnos a
          WHERE a.id = ANY($1::int[])
            AND EXISTS (SELECT 1 FROM horarios h
                         WHERE h.id_curso = a.id_curso AND h.id_asignatura = $2 AND h.id_profesor = $3)`,
        [ids, ev.rows[0].id_asignatura, req.usuario.id_profesor]);
      if (permitidos.rows[0].n !== ids.length) {
        return res.status(403).json({ error: 'Solo puedes calificar a alumnos de cursos donde dictas esta asignatura' });
      }
    }
  } catch (err) {
    console.error('[POST calificaciones - permisos]', err.message);
    return res.status(500).json({ error: 'Error al validar las calificaciones' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let guardadas = 0;
    for (const c of calificaciones) {
      if (c.nota === null || c.nota === '' || c.nota === undefined) {
        // Sin nota: eliminar si existe
        await client.query(
          'DELETE FROM calificaciones WHERE id_alumno=$1 AND id_evaluacion=$2',
          [c.id_alumno, id]
        );
      } else {
        const nota = parseFloat(c.nota);
        await client.query(
          `INSERT INTO calificaciones (id_alumno, id_evaluacion, nota)
           VALUES ($1,$2,$3)
           ON CONFLICT (id_alumno, id_evaluacion)
           DO UPDATE SET nota = EXCLUDED.nota, fecha_registro = CURRENT_TIMESTAMP`,
          [c.id_alumno, id, nota]
        );
        guardadas++;
      }
    }
    // Recalcular promedios de los alumnos afectados
    const evalRes = await client.query(
      'SELECT id_asignatura, id_periodo FROM evaluaciones WHERE id=$1', [id]
    );
    if (evalRes.rows.length) {
      const { id_asignatura, id_periodo } = evalRes.rows[0];
      const ids = calificaciones.map(c => c.id_alumno).filter(Boolean);
      for (const id_alumno of ids) {
        await client.query(
          `INSERT INTO promedios (id_alumno, id_asignatura, id_periodo, promedio)
           SELECT $1, $2, $3, ROUND(AVG(c.nota)::numeric, 1)
           FROM calificaciones c
           JOIN evaluaciones e ON c.id_evaluacion = e.id
           WHERE c.id_alumno=$1 AND e.id_asignatura=$2 AND e.id_periodo=$3
           ON CONFLICT (id_alumno, id_asignatura, id_periodo)
           DO UPDATE SET promedio = EXCLUDED.promedio, updated_at = CURRENT_TIMESTAMP`,
          [id_alumno, id_asignatura, id_periodo]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ mensaje: `${guardadas} nota(s) guardadas correctamente` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /evaluaciones/:id/calificaciones]', err.message);
    res.status(500).json({ error: 'Error al guardar calificaciones' });
  } finally {
    client.release();
  }
});

// GET /evaluaciones/alumno/:id  — todas las notas de un alumno
router.get('/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query(
      `SELECT asig.nombre AS asignatura, e.nombre AS evaluacion, e.tipo_evaluacion,
              e.fecha, e.porcentaje, c.nota, p.nombre AS periodo
       FROM calificaciones c
       JOIN evaluaciones e  ON c.id_evaluacion = e.id
       JOIN asignaturas asig ON e.id_asignatura = asig.id
       JOIN periodos_academicos p ON e.id_periodo = p.id
       WHERE c.id_alumno = $1
       ORDER BY asig.nombre, e.fecha`, [id]
    );
    // Promedios por asignatura
    const prom = await pool.query(
      `SELECT asig.nombre AS asignatura, pr.promedio, p.nombre AS periodo
       FROM promedios pr
       JOIN asignaturas asig ON pr.id_asignatura = asig.id
       JOIN periodos_academicos p ON pr.id_periodo = p.id
       WHERE pr.id_alumno = $1
       ORDER BY asig.nombre`, [id]
    );
    res.json({ calificaciones: r.rows, promedios: prom.rows });
  } catch (err) {
    console.error('[GET /evaluaciones/alumno/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener notas del alumno' });
  }
});

module.exports = router;
