const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');
const { generarAlertas } = require('../lib/alertas');

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

// Ventana para pasar asistencia: desde 15 min antes del inicio hasta 30 min después del término.
// Es la misma regla que muestra el frontend; aquí se hace cumplir.
const VENTANA_ANTES_MIN   = 15;
const VENTANA_DESPUES_MIN = 30;
const ZONA_COLEGIO = 'America/Santiago';   // los contenedores corren en UTC

const aMinutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const aHora    = (min)  => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Fecha y hora actuales en Chile, calculadas por PostgreSQL
async function ahoraEnChile() {
  const r = await pool.query(
    `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS fecha,
            to_char(now() AT TIME ZONE $1, 'HH24:MI')    AS hora`, [ZONA_COLEGIO]);
  return r.rows[0];
}

// Valida que la clase se pueda registrar en esa fecha, por ese usuario y en este momento.
// Devuelve { horario } si está todo bien, o { status, error } para responder.
//   · el horario existe y su día coincide con la fecha
//   · no es una fecha futura ni un feriado
//   · un profesor solo registra SUS clases, el mismo día y dentro de la ventana horaria
//     (el administrador puede corregir días anteriores)
async function validarClase(usuario, id_horario, fecha) {
  const hRes = await pool.query(
    `SELECT id_curso, id_profesor, dia_semana,
            to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
            to_char(hora_fin,    'HH24:MI') AS hora_fin
       FROM horarios WHERE id = $1`, [id_horario]);
  if (hRes.rows.length === 0) return { status: 404, error: 'Horario no encontrado' };
  const horario = hRes.rows[0];

  const diaFecha = diaSemanaDeFecha(fecha);
  if (horario.dia_semana && diaFecha !== horario.dia_semana) {
    return { status: 400, error: `La fecha ${fecha} cae en ${NOMBRE_DIA[diaFecha]}, pero esta clase es del día ${NOMBRE_DIA[horario.dia_semana]}` };
  }

  const esAdmin = usuario.tipo_persona === 'admin';
  if (!esAdmin && horario.id_profesor !== usuario.id_profesor) {
    return { status: 403, error: 'Esta clase no está asignada a tu perfil de profesor' };
  }

  const ahora = await ahoraEnChile();
  if (fecha > ahora.fecha) {
    return { status: 400, error: 'No se puede registrar asistencia de una fecha futura' };
  }
  const feriado = await pool.query('SELECT descripcion FROM feriados WHERE fecha = $1', [fecha]);
  if (feriado.rows.length) {
    return { status: 400, error: `El ${fecha} es feriado (${feriado.rows[0].descripcion}): no hay clases` };
  }

  if (!esAdmin) {
    if (fecha !== ahora.fecha) {
      return { status: 403, error: 'Solo se puede pasar asistencia el día que corresponde a la clase. Para corregir un día anterior, contacta al administrador.' };
    }
    const actual = aMinutos(ahora.hora);
    const desde  = aMinutos(horario.hora_inicio) - VENTANA_ANTES_MIN;
    const hasta  = aMinutos(horario.hora_fin) + VENTANA_DESPUES_MIN;
    if (actual < desde) {
      return { status: 403, error: `La clase comienza a las ${horario.hora_inicio}. Podrás pasar asistencia desde las ${aHora(desde)}.` };
    }
    if (actual > hasta) {
      return { status: 403, error: `Fuera del rango permitido: la asistencia de esta clase se podía registrar hasta las ${aHora(hasta)}. Contacta al administrador.` };
    }
  }
  return { horario };
}

const MSG_DEFINITIVA = 'La asistencia de esta clase ya fue registrada definitivamente y no puede modificarse';

// =====================================================
// POST /asistencia/marcar
// Marca asistencia manual para un curso completo
// Body: { id_curso, id_horario, fecha, alumnos: [{id_alumno, presente, hora_marcada, tipo_asistencia}] }
// Auth: JWT (Admin o Profesor)
// =====================================================
router.post('/marcar', verificarToken, adminOProfesor, async (req, res) => {
  const { id_curso, id_horario, fecha, alumnos, definitivo } = req.body;
  const id_profesor = req.usuario.id_profesor || null;

  if (!id_curso || !id_horario || !fecha || !Array.isArray(alumnos) || alumnos.length === 0) {
    return res.status(400).json({ error: 'Faltan campos requeridos: id_curso, id_horario, fecha, alumnos[]' });
  }
  if (!fechaValida(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida, formato esperado: YYYY-MM-DD' });
  }

  // Validaciones antes de escribir: clase, fecha, dueño, ventana horaria y alumnos del curso
  try {
    const v = await validarClase(req.usuario, id_horario, fecha);
    if (v.error) return res.status(v.status).json({ error: v.error });
    if (v.horario.id_curso !== parseInt(id_curso)) {
      return res.status(400).json({ error: 'El horario seleccionado no pertenece a ese curso' });
    }

    const ids = [...new Set(alumnos.map(a => parseInt(a.id_alumno)))];
    if (ids.some(isNaN) || ids.length !== alumnos.length) {
      return res.status(400).json({ error: 'La lista de alumnos tiene IDs inválidos o repetidos' });
    }
    const delCurso = await pool.query(
      'SELECT COUNT(*)::int AS n FROM alumnos WHERE id = ANY($1::int[]) AND id_curso = $2 AND activo = TRUE',
      [ids, id_curso]);
    if (delCurso.rows[0].n !== ids.length) {
      return res.status(400).json({ error: 'Hay alumnos en la lista que no pertenecen a este curso o están inactivos' });
    }
  } catch (err) {
    console.error('[POST /marcar - validación]', err.message);
    return res.status(500).json({ error: 'Error al validar el horario' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear la cabecera o actualizarla si sigue en borrador.
    // Si ya es definitiva, el WHERE impide tocarla y no se devuelve ninguna fila
    // (se resuelve en la misma sentencia: no hay carrera entre dos guardados).
    const resultCabecera = await client.query(
      `INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario, id_profesor)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fecha, id_horario)
       DO UPDATE SET id_profesor = COALESCE(EXCLUDED.id_profesor, asistencia_cabecera.id_profesor)
       WHERE asistencia_cabecera.guardada = FALSE
       RETURNING id`,
      [fecha, id_curso, id_horario, id_profesor]
    );
    if (resultCabecera.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: MSG_DEFINITIVA });
    }
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

    if (definitivo === true) {
      await client.query('UPDATE asistencia_cabecera SET guardada = TRUE WHERE id = $1', [id_cabecera]);
    }
    await client.query('COMMIT');

    // R.26: al dejar el registro definitivo se revisan los alumnos y se notifica a quienes
    // quedaron bajo el umbral de asistencia. Es complementario: si falla, no afecta el registro.
    const alertas = definitivo === true ? await generarAlertas(alumnos.map(a => a.id_alumno)) : 0;

    res.status(201).json({
      mensaje: definitivo ? 'Asistencia registrada definitivamente' : 'Borrador guardado',
      id_cabecera,
      guardada: definitivo === true,
      alertas_generadas: alertas
    });
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
router.post('/marcar-facial', verificarToken, adminOProfesor, async (req, res) => {
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
    // 1. Clase, fecha, dueño y ventana horaria (mismas reglas que el registro manual)
    const v = await validarClase(req.usuario, id_horario, fecha);
    if (v.error) return res.status(v.status).json({ error: v.error });
    id_curso = v.horario.id_curso;

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

    // Crear cabecera si no existe (una asistencia definitiva no se modifica)
    const resultCabecera = await client.query(
      `INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario)
       VALUES ($1, $2, $3)
       ON CONFLICT (fecha, id_horario) DO UPDATE SET fecha = EXCLUDED.fecha
       WHERE asistencia_cabecera.guardada = FALSE
       RETURNING id`,
      [fecha, id_curso, id_horario]
    );
    if (resultCabecera.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: MSG_DEFINITIVA });
    }
    const id_cabecera = resultCabecera.rows[0].id;

    // Marcar alumno como presente con tipo 'facial'
    const resultDetalle = await client.query(
      `INSERT INTO asistencia_detalle
         (id_asistencia_cabecera, id_alumno, presente, hora_marcada, tipo_asistencia)
       VALUES ($1, $2, TRUE, (now() AT TIME ZONE 'America/Santiago')::time, 'facial')
       ON CONFLICT (id_asistencia_cabecera, id_alumno)
       DO UPDATE SET presente        = TRUE,
                     hora_marcada    = (now() AT TIME ZONE 'America/Santiago')::time,
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
        ad.id           AS id_detalle,
        ac.fecha,
        asig.nombre     AS asignatura,
        c.nombre        AS curso,
        h.hora_inicio,
        h.hora_fin,
        ad.presente,
        ad.hora_marcada,
        ad.tipo_asistencia,
        ad.observacion,
        j.id            AS id_justificacion,
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
// GET /asistencia/vidas
// Para cada alumno del curso, calcula cuántas ausencias le quedan
// antes de reprobar (15 % máx según ley). Excluye la fecha actual
// para no contar el borrador/sesión activa de hoy.
// Query params: ?id_horario=N&id_curso=M&fecha=YYYY-MM-DD
// Returns: [{ id_alumno, total_clases, max_ausencias, ausencias_previas }]
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/vidas', verificarToken, adminOProfesor, async (req, res) => {
  const { id_horario, id_curso, fecha } = req.query;
  if (!id_horario || !id_curso) {
    return res.status(400).json({ error: 'Se requieren id_horario e id_curso' });
  }
  try {
    const r = await pool.query(`
      WITH periodo AS (
        SELECT fecha_inicio, fecha_fin
        FROM periodos_academicos
        WHERE activo = TRUE
        LIMIT 1
      ),
      total_clases_cte AS (
        SELECT COALESCE((
          SELECT COUNT(*)::int
          FROM generate_series(
            (SELECT fecha_inicio FROM periodo),
            (SELECT fecha_fin   FROM periodo),
            '1 day'::interval
          ) d
          WHERE EXTRACT(ISODOW FROM d) = (
            SELECT h.dia_semana FROM horarios h WHERE h.id = $1
          )
          -- Excluir feriados y días no lectivos: no cuentan como clases
          AND d::date NOT IN (SELECT fecha FROM feriados)
        ), 0) AS total
      ),
      ausencias_cte AS (
        SELECT ad.id_alumno, COUNT(*)::int AS n
        FROM asistencia_detalle ad
        JOIN asistencia_cabecera ac ON ac.id = ad.id_asistencia_cabecera
        WHERE ac.id_horario = $1
          AND ad.presente = FALSE
          AND ($3::date IS NULL OR ac.fecha != $3::date)
        GROUP BY ad.id_alumno
      )
      SELECT
        a.id                             AS id_alumno,
        tc.total                         AS total_clases,
        FLOOR(tc.total * 0.15)::int      AS max_ausencias,
        COALESCE(aus.n, 0)               AS ausencias_previas
      FROM alumnos a
      CROSS JOIN total_clases_cte tc
      LEFT JOIN ausencias_cte aus ON aus.id_alumno = a.id
      WHERE a.id_curso = $2 AND a.activo = TRUE
      ORDER BY a.apellido_paterno, a.nombre
    `, [id_horario, id_curso, fecha || null]);
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /asistencia/vidas]', err.message);
    res.status(500).json({ error: 'Error al calcular vidas' });
  }
});

// =====================================================
// GET /asistencia/estado
// Estado rápido de asistencia de un horario en una fecha
// Query params: ?fecha=YYYY-MM-DD&id_horario=N
// Returns: { estado: 'nueva'|'borrador'|'definitivo', presentes, total, id_cabecera }
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/estado', verificarToken, adminOProfesor, async (req, res) => {
  const { fecha, id_horario } = req.query;
  if (!fecha || !id_horario) {
    return res.status(400).json({ error: 'Se requieren fecha e id_horario' });
  }
  try {
    const r = await pool.query(
      `SELECT ac.id, ac.guardada,
              COUNT(asis.id) FILTER (WHERE asis.presente = TRUE) AS presentes,
              COUNT(asis.id) AS total
       FROM asistencia_cabecera ac
       LEFT JOIN asistencia_detalle asis ON asis.id_asistencia_cabecera = ac.id
       WHERE ac.id_horario = $1 AND ac.fecha = $2
       GROUP BY ac.id, ac.guardada`,
      [id_horario, fecha]
    );
    if (!r.rows.length) return res.json({ estado: 'nueva', presentes: 0, total: 0 });
    const row = r.rows[0];
    res.json({
      estado:       row.guardada ? 'definitivo' : 'borrador',
      presentes:    parseInt(row.presentes) || 0,
      total:        parseInt(row.total)     || 0,
      id_cabecera:  row.id
    });
  } catch (err) {
    console.error('[GET /asistencia/estado]', err.message);
    res.status(500).json({ error: 'Error al obtener estado de asistencia' });
  }
});

// =====================================================
// GET /asistencia/resumen-dia
// Dashboard: todas las clases programadas para una fecha con su estado de
// asistencia (pendiente / borrador / definitivo). Alimenta el panel del admin.
// Query obligatorio: ?fecha=YYYY-MM-DD   Opcional: ?id_profesor=N
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/resumen-dia', verificarToken, adminOProfesor, async (req, res) => {
  const { fecha, id_profesor } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Se requiere fecha' });
  try {
    const params = [fecha];
    let filtroProf = '';
    if (id_profesor) {
      params.push(id_profesor);
      filtroProf = ` AND h.id_profesor = $${params.length}`;
    }

    // ¿La fecha es feriado? Lo informamos para que el panel lo muestre.
    const feriadoRes = await pool.query('SELECT descripcion FROM feriados WHERE fecha = $1', [fecha]);

    const r = await pool.query(
      `SELECT
         h.id              AS id_horario,
         h.hora_inicio, h.hora_fin, h.sala,
         c.id              AS id_curso,
         c.nombre          AS curso,
         asig.nombre       AS asignatura,
         p.nombre || ' ' || p.apellido_paterno AS profesor,
         ac.id             AS id_cabecera,
         ac.guardada,
         COUNT(ad.id) FILTER (WHERE ad.presente = TRUE) AS presentes,
         COUNT(ad.id)      AS marcados,
         (SELECT COUNT(*) FROM alumnos al WHERE al.id_curso = c.id AND al.activo = TRUE) AS total_alumnos
       FROM horarios h
       JOIN cursos      c    ON h.id_curso = c.id AND c.activo = TRUE
       JOIN asignaturas asig ON h.id_asignatura = asig.id
       JOIN profesores  p    ON h.id_profesor = p.id
       LEFT JOIN asistencia_cabecera ac ON ac.id_horario = h.id AND ac.fecha = $1
       LEFT JOIN asistencia_detalle  ad ON ad.id_asistencia_cabecera = ac.id
       WHERE h.dia_semana = EXTRACT(ISODOW FROM $1::date)${filtroProf}
       GROUP BY h.id, c.id, c.nombre, asig.nombre, p.nombre, p.apellido_paterno, ac.id, ac.guardada
       ORDER BY h.hora_inicio, c.nombre`,
      params
    );

    const clases = r.rows.map(row => ({
      id_horario:    row.id_horario,
      id_curso:      row.id_curso,
      curso:         row.curso,
      asignatura:    row.asignatura,
      profesor:      row.profesor,
      hora_inicio:   row.hora_inicio,
      hora_fin:      row.hora_fin,
      sala:          row.sala,
      total_alumnos: parseInt(row.total_alumnos) || 0,
      presentes:     parseInt(row.presentes) || 0,
      marcados:      parseInt(row.marcados) || 0,
      estado: row.id_cabecera === null ? 'pendiente' : (row.guardada ? 'definitivo' : 'borrador')
    }));

    res.json({
      fecha,
      feriado: feriadoRes.rows.length ? feriadoRes.rows[0].descripcion : null,
      total_clases: clases.length,
      pendientes:   clases.filter(c => c.estado === 'pendiente').length,
      borradores:   clases.filter(c => c.estado === 'borrador').length,
      definitivos:  clases.filter(c => c.estado === 'definitivo').length,
      clases
    });
  } catch (err) {
    console.error('[GET /asistencia/resumen-dia]', err.message);
    res.status(500).json({ error: 'Error al obtener resumen del día' });
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
        al.rut,
        al.nombre,
        al.apellido_paterno,
        al.apellido_materno,
        ac.id                        AS id_cabecera,
        COALESCE(ac.guardada, FALSE)  AS guardada,
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
// GET /asistencia/justificaciones
// Lista todas las justificaciones con detalle del alumno
// Query: ?estado=pendiente|aprobada|rechazada  ?id_alumno=N
// Auth: Admin o Profesor
// =====================================================
router.get('/justificaciones', verificarToken, adminOProfesor, async (req, res) => {
  const { estado, id_alumno } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (estado)    { params.push(estado);     where += ` AND j.estado = $${params.length}`; }
  if (id_alumno) { params.push(id_alumno);  where += ` AND ad.id_alumno = $${params.length}`; }
  try {
    const r = await pool.query(
      `SELECT
         j.id, j.motivo, j.estado, j.fecha_justificacion,
         ad.id     AS id_asistencia_detalle,
         ad.presente,
         ac.fecha,
         a.id      AS id_alumno,
         a.nombre  || ' ' || a.apellido_paterno AS alumno,
         a.rut,
         c.nombre  AS curso,
         asig.nombre AS asignatura,
         h.hora_inicio, h.hora_fin
       FROM justificaciones j
       JOIN asistencia_detalle  ad   ON j.id_asistencia_detalle = ad.id
       JOIN asistencia_cabecera ac   ON ad.id_asistencia_cabecera = ac.id
       JOIN alumnos              a   ON ad.id_alumno = a.id
       LEFT JOIN cursos          c   ON a.id_curso = c.id
       JOIN horarios             h   ON ac.id_horario = h.id
       JOIN asignaturas          asig ON h.id_asignatura = asig.id
       ${where}
       ORDER BY j.fecha_justificacion DESC
       LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /justificaciones]', err.message);
    res.status(500).json({ error: 'Error al obtener justificaciones' });
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
  const texto = String(motivo).trim();
  if (texto.length < 5 || texto.length > 500) {
    return res.status(400).json({ error: 'El motivo debe tener entre 5 y 500 caracteres' });
  }

  try {
    const det = await pool.query(
      `SELECT ad.presente, EXISTS (SELECT 1 FROM justificaciones j WHERE j.id_asistencia_detalle = ad.id) AS ya_tiene
         FROM asistencia_detalle ad WHERE ad.id = $1`, [id_asistencia_detalle]);
    if (det.rows.length === 0) return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
    if (det.rows[0].presente) return res.status(400).json({ error: 'Solo se justifican inasistencias: el alumno figura presente' });
    if (det.rows[0].ya_tiene) return res.status(409).json({ error: 'Esta inasistencia ya tiene una justificación registrada' });

    const result = await pool.query(
      `INSERT INTO justificaciones (id_asistencia_detalle, motivo)
       VALUES ($1, $2)
       RETURNING *`,
      [id_asistencia_detalle, texto]
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
