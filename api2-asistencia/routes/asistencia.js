const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

const NOMBRE_DIA = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };

// Día de la semana de una fecha YYYY-MM-DD con la misma convención
// que horarios.dia_semana (1=lunes ... 7=domingo)
function diaSemanaDeFecha(fechaStr) {
  const dow = new Date(fechaStr + 'T12:00:00Z').getUTCDay(); // 0=domingo
  return dow === 0 ? 7 : dow;
}

function fechaValida(fechaStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fechaStr) && !isNaN(Date.parse(fechaStr + 'T12:00:00Z'));
}

// =====================================================
// POST /asistencia/marcar
// Marca asistencia manual para un curso completo
// Body: { id_curso, id_horario, fecha, alumnos: [{id_alumno, presente, hora_marcada, tipo_asistencia}] }
// Auth: JWT (Admin o Profesor)
// =====================================================
router.post('/marcar', verificarToken, adminOProfesor, async (req, res) => {
  const { id_curso, id_horario, fecha, alumnos } = req.body;
  const id_profesor = req.usuario.id_profesor || null;

  if (!id_curso || !id_horario || !fecha || !Array.isArray(alumnos) || alumnos.length === 0) {
    return res.status(400).json({ error: 'Faltan campos requeridos: id_curso, id_horario, fecha, alumnos[]' });
  }
  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida, formato esperado: YYYY-MM-DD' });
  }

  // El horario debe existir, pertenecer al curso indicado y
  // su día de la semana debe coincidir con la fecha
  try {
    const hRes = await pool.query('SELECT id_curso, dia_semana FROM horarios WHERE id = $1', [id_horario]);
    if (hRes.rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado' });
    }
    const horario = hRes.rows[0];
    if (horario.id_curso !== parseInt(id_curso)) {
      return res.status(400).json({ error: 'El horario seleccionado no pertenece a ese curso' });
    }
    const diaFecha = diaSemanaDeFecha(fecha);
    if (horario.dia_semana && diaFecha !== horario.dia_semana) {
      return res.status(400).json({
        error: `La fecha ${fecha} cae en ${NOMBRE_DIA[diaFecha]}, pero esta clase es del día ${NOMBRE_DIA[horario.dia_semana]}`
      });
    }
  } catch (err) {
    console.error('[POST /marcar - validación]', err.message);
    return res.status(500).json({ error: 'Error al validar el horario' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear la cabecera de asistencia o actualizar si ya existe
    const resultCabecera = await client.query(
      `INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario, id_profesor)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fecha, id_horario)
       DO UPDATE SET id_profesor = EXCLUDED.id_profesor
       RETURNING id`,
      [fecha, id_curso, id_horario, id_profesor]
    );
    const id_cabecera = resultCabecera.rows[0].id;

    // Insertar o actualizar el registro de cada alumno
    for (const alumno of alumnos) {
      await client.query(
        `INSERT INTO asistencia_detalle
           (id_asistencia_cabecera, id_alumno, presente, hora_marcada, tipo_asistencia)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_asistencia_cabecera, id_alumno)
         DO UPDATE SET presente       = EXCLUDED.presente,
                       hora_marcada   = EXCLUDED.hora_marcada,
                       tipo_asistencia = EXCLUDED.tipo_asistencia`,
        [
          id_cabecera,
          alumno.id_alumno,
          alumno.presente ?? false,
          alumno.hora_marcada ?? null,
          alumno.tipo_asistencia ?? 'normal'
        ]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Asistencia registrada correctamente', id_cabecera });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /marcar]', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia' });
  } finally {
    client.release();
  }
});

// =====================================================
// POST /asistencia/marcar-facial
// Llamado por API 3 cuando reconoce un rostro exitosamente
// Body: { id_alumno, id_horario, fecha, confianza }
// Auth: JWT (cualquier rol — API 3 usa su propio token de servicio)
// =====================================================
router.post('/marcar-facial', verificarToken, async (req, res) => {
  const { id_alumno, id_horario, fecha, confianza } = req.body;

  if (!id_alumno || !id_horario || !fecha) {
    return res.status(400).json({ error: 'Faltan campos requeridos: id_alumno, id_horario, fecha' });
  }
  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida, formato esperado: YYYY-MM-DD' });
  }

  // ── Validaciones de contexto (antes de escribir nada) ──
  let id_curso;
  try {
    // 1. El horario debe existir y su día coincidir con la fecha
    const hRes = await pool.query(
      'SELECT id_curso, dia_semana FROM horarios WHERE id = $1',
      [id_horario]
    );
    if (hRes.rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado' });
    }
    const horario = hRes.rows[0];
    id_curso = horario.id_curso;

    const diaFecha = diaSemanaDeFecha(fecha);
    if (horario.dia_semana && diaFecha !== horario.dia_semana) {
      return res.status(400).json({
        error: `La fecha ${fecha} cae en ${NOMBRE_DIA[diaFecha]}, pero esta clase es del día ${NOMBRE_DIA[horario.dia_semana]}`
      });
    }

    // 2. El alumno debe existir, estar activo y pertenecer al curso del horario
    const aRes = await pool.query(
      'SELECT nombre, apellido_paterno, id_curso, activo FROM alumnos WHERE id = $1',
      [id_alumno]
    );
    if (aRes.rows.length === 0) {
      return res.status(404).json({ error: 'Alumno no encontrado' });
    }
    const alumno = aRes.rows[0];
    if (!alumno.activo) {
      return res.status(409).json({ error: `${alumno.nombre} ${alumno.apellido_paterno} está inactivo en el sistema` });
    }
    if (alumno.id_curso !== id_curso) {
      return res.status(409).json({
        error: `${alumno.nombre} ${alumno.apellido_paterno} no pertenece al curso de esta clase`
      });
    }
  } catch (err) {
    console.error('[POST /marcar-facial - validación]', err.message);
    return res.status(500).json({ error: 'Error al validar la marca facial' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear cabecera si no existe
    const resultCabecera = await client.query(
      `INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario)
       VALUES ($1, $2, $3)
       ON CONFLICT (fecha, id_horario) DO UPDATE SET fecha = EXCLUDED.fecha
       RETURNING id`,
      [fecha, id_curso, id_horario]
    );
    const id_cabecera = resultCabecera.rows[0].id;

    // Marcar alumno como presente con tipo 'facial'
    const resultDetalle = await client.query(
      `INSERT INTO asistencia_detalle
         (id_asistencia_cabecera, id_alumno, presente, hora_marcada, tipo_asistencia)
       VALUES ($1, $2, TRUE, CURRENT_TIME, 'facial')
       ON CONFLICT (id_asistencia_cabecera, id_alumno)
       DO UPDATE SET presente        = TRUE,
                     hora_marcada    = CURRENT_TIME,
                     tipo_asistencia = 'facial'
       RETURNING id`,
      [id_cabecera, id_alumno]
    );
    const id_detalle = resultDetalle.rows[0].id;

    // Registrar en el log de asistencia facial
    await client.query(
      `INSERT INTO asistencia_facial_log (id_alumno, id_asistencia_detalle, exito, confianza)
       VALUES ($1, $2, TRUE, $3)`,
      [id_alumno, id_detalle, confianza ?? null]
    );

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Asistencia registrada por reconocimiento facial',
      id_detalle
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /marcar-facial]', err.message);
    res.status(500).json({ error: 'Error al registrar asistencia facial' });
  } finally {
    client.release();
  }
});

// =====================================================
// GET /asistencia/alumno/:id
// Historial de asistencia de un alumno específico
// Query params opcionales: ?fecha_inicio=YYYY-MM-DD&fecha_fin=YYYY-MM-DD
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  const { fecha_inicio, fecha_fin } = req.query;

  if (isNaN(id)) return res.status(400).json({ error: 'ID de alumno inválido' });

  try {
    let query = `
      SELECT
        ac.fecha,
        asig.nombre     AS asignatura,
        c.nombre        AS curso,
        h.hora_inicio,
        h.hora_fin,
        ad.presente,
        ad.hora_marcada,
        ad.tipo_asistencia,
        ad.observacion,
        j.motivo        AS justificacion,
        j.estado        AS estado_justificacion
      FROM asistencia_detalle ad
      JOIN asistencia_cabecera ac  ON ad.id_asistencia_cabecera = ac.id
      JOIN horarios h              ON ac.id_horario = h.id
      JOIN asignaturas asig        ON h.id_asignatura = asig.id
      JOIN cursos c                ON ac.id_curso = c.id
      LEFT JOIN justificaciones j  ON j.id_asistencia_detalle = ad.id
      WHERE ad.id_alumno = $1
    `;
    const params = [id];

    if (fecha_inicio) {
      params.push(fecha_inicio);
      query += ` AND ac.fecha >= $${params.length}`;
    }
    if (fecha_fin) {
      params.push(fecha_fin);
      query += ` AND ac.fecha <= $${params.length}`;
    }

    query += ' ORDER BY ac.fecha DESC, h.hora_inicio ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /alumno/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener asistencia del alumno' });
  }
});

// =====================================================
// GET /asistencia/curso/:id
// Lista de asistencia de los alumnos de un curso en una fecha
// Query params obligatorio : ?fecha=YYYY-MM-DD
// Query param  opcional    : ?id_horario=N
//   - Con id_horario → una fila por alumno para esa clase específica
//   - Sin id_horario → una fila por alumno por cada clase registrada ese día
//     (útil para ver el resumen completo del día por curso)
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/curso/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  const { fecha, id_horario } = req.query;

  if (isNaN(id)) return res.status(400).json({ error: 'ID de curso inválido' });
  if (!fecha) {
    return res.status(400).json({ error: 'Se requiere el parámetro: ?fecha=YYYY-MM-DD' });
  }

  try {
    const params = [id, fecha];
    let filtroHorario = '';

    if (id_horario) {
      params.push(id_horario);
      filtroHorario = `AND ac.id_horario = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
        al.id                        AS id_alumno,
        al.nombre,
        al.apellido_paterno,
        al.apellido_materno,
        ac.id                        AS id_cabecera,
        asig.nombre                  AS asignatura,
        h.id                         AS id_horario,
        h.hora_inicio,
        h.hora_fin,
        COALESCE(ad.presente, FALSE)  AS presente,
        ad.hora_marcada,
        ad.tipo_asistencia
      FROM alumnos al
      LEFT JOIN asistencia_cabecera ac
             ON ac.id_curso = $1 AND ac.fecha = $2 ${filtroHorario}
      LEFT JOIN horarios h
             ON ac.id_horario = h.id
      LEFT JOIN asignaturas asig
             ON h.id_asignatura = asig.id
      LEFT JOIN asistencia_detalle ad
             ON ad.id_asistencia_cabecera = ac.id AND ad.id_alumno = al.id
      WHERE al.id_curso = $1
        AND al.activo = TRUE
      ORDER BY h.hora_inicio, al.apellido_paterno, al.apellido_materno`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /curso/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener asistencia del curso' });
  }
});

// =====================================================
// GET /asistencia/fecha
// Resumen de todas las clases registradas en una fecha
// Query params: ?fecha=YYYY-MM-DD
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/fecha', verificarToken, adminOProfesor, async (req, res) => {
  const { fecha } = req.query;

  if (!fecha) {
    return res.status(400).json({ error: 'Se requiere el parámetro: ?fecha=YYYY-MM-DD' });
  }

  try {
    const result = await pool.query(
      `SELECT
        ac.id               AS id_cabecera,
        ac.fecha,
        c.nombre            AS curso,
        asig.nombre         AS asignatura,
        h.hora_inicio,
        h.hora_fin,
        h.sala,
        p.nombre            AS profesor_nombre,
        p.apellido_paterno  AS profesor_apellido,
        COUNT(ad.id)        AS total_alumnos,
        SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN NOT ad.presente THEN 1 ELSE 0 END) AS ausentes
      FROM asistencia_cabecera ac
      JOIN cursos c       ON ac.id_curso = c.id
      JOIN horarios h     ON ac.id_horario = h.id
      JOIN asignaturas asig ON h.id_asignatura = asig.id
      LEFT JOIN profesores p ON ac.id_profesor = p.id
      LEFT JOIN asistencia_detalle ad ON ad.id_asistencia_cabecera = ac.id
      WHERE ac.fecha = $1
      GROUP BY ac.id, c.nombre, asig.nombre, h.hora_inicio, h.hora_fin, h.sala,
               p.nombre, p.apellido_paterno
      ORDER BY h.hora_inicio`,
      [fecha]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /fecha]', err.message);
    res.status(500).json({ error: 'Error al obtener asistencia por fecha' });
  }
});

// =====================================================
// GET /asistencia/resumen/alumno/:id
// Porcentaje de asistencia por asignatura de un alumno
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/resumen/alumno/:id', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;

  if (isNaN(id)) return res.status(400).json({ error: 'ID de alumno inválido' });

  try {
    const result = await pool.query(
      `SELECT
        asig.nombre         AS asignatura,
        COUNT(ad.id)        AS total_clases,
        SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS clases_presentes,
        ROUND(
          100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END)
          / NULLIF(COUNT(ad.id), 0), 1
        )                   AS porcentaje_asistencia
      FROM asistencia_detalle ad
      JOIN asistencia_cabecera ac ON ad.id_asistencia_cabecera = ac.id
      JOIN horarios h             ON ac.id_horario = h.id
      JOIN asignaturas asig       ON h.id_asignatura = asig.id
      WHERE ad.id_alumno = $1
      GROUP BY asig.id, asig.nombre
      ORDER BY asig.nombre`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /resumen/alumno/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener resumen de asistencia' });
  }
});

// =====================================================
// POST /asistencia/justificar
// Registrar una justificación de inasistencia
// Body: { id_asistencia_detalle, motivo }
// Auth: JWT (Admin o Profesor)
// =====================================================
router.post('/justificar', verificarToken, adminOProfesor, async (req, res) => {
  const { id_asistencia_detalle, motivo } = req.body;

  if (!id_asistencia_detalle || !motivo) {
    return res.status(400).json({ error: 'Faltan campos: id_asistencia_detalle, motivo' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO justificaciones (id_asistencia_detalle, motivo)
       VALUES ($1, $2)
       RETURNING *`,
      [id_asistencia_detalle, motivo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /justificar]', err.message);
    res.status(500).json({ error: 'Error al registrar justificación' });
  }
});

// =====================================================
// PUT /asistencia/justificacion/:id
// Aprobar o rechazar una justificación
// Body: { estado } → 'pendiente' | 'aprobada' | 'rechazada'
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/justificacion/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (isNaN(id)) return res.status(400).json({ error: 'ID de justificación inválido' });

  const estadosValidos = ['pendiente', 'aprobada', 'rechazada'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Valores aceptados: ${estadosValidos.join(', ')}` });
  }

  try {
    const result = await pool.query(
      'UPDATE justificaciones SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Justificación no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PUT /justificacion/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar justificación' });
  }
});

module.exports = router;
