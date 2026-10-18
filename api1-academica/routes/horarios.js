const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

const DIAS_VALIDOS = { 1:'Lunes', 2:'Martes', 3:'Miércoles', 4:'Jueves', 5:'Viernes', 6:'Sábado', 7:'Domingo' };

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const hhmm = t => String(t).slice(0, 5);

// =====================================================
// Valida un bloque horario completo antes de guardarlo.
// - Horas válidas y fin > inicio
// - Curso, asignatura y profesor existen y están activos
// - La sala (si viene) existe en aulas
// - No hay choque de horario el mismo día con:
//     · el mismo PROFESOR (no puede estar en 2 lados a la vez)
//     · el mismo CURSO   (un curso no tiene 2 clases a la vez)
//     · la misma SALA    (una sala no se usa 2 veces a la vez)
//   Bloques contiguos (uno termina 09:30 y otro empieza 09:30) sí se permiten.
// idExcluir: id del horario que se está editando (para no chocar consigo mismo)
// Devuelve { status, error, conflictos? } o null si todo está OK.
// Debe llamarse dentro de una transacción que ya tomó el lock de horarios.
// =====================================================
async function validarHorario(client, h, idExcluir = null) {
  if (!DIAS_VALIDOS[h.dia_semana]) {
    return { status: 400, error: 'dia_semana debe estar entre 1 (Lunes) y 7 (Domingo)' };
  }
  if (!HORA_RE.test(h.hora_inicio) || !HORA_RE.test(h.hora_fin)) {
    return { status: 400, error: 'Formato de hora inválido (usa HH:MM)' };
  }
  if (hhmm(h.hora_inicio) >= hhmm(h.hora_fin)) {
    return { status: 400, error: 'La hora de fin debe ser mayor que la hora de inicio' };
  }

  const ref = await client.query(
    `SELECT
       (SELECT activo FROM cursos      WHERE id = $1) AS curso_activo,
       (SELECT activo FROM asignaturas WHERE id = $2) AS asignatura_activa,
       (SELECT activo FROM profesores  WHERE id = $3) AS profesor_activo,
       ($4::text IS NULL OR EXISTS (SELECT 1 FROM aulas WHERE codigo = $4)) AS sala_existe`,
    [h.id_curso, h.id_asignatura, h.id_profesor, h.sala]
  );
  const r = ref.rows[0];
  if (r.curso_activo === null)      return { status: 400, error: 'El curso seleccionado no existe' };
  if (!r.curso_activo)              return { status: 400, error: 'El curso seleccionado está desactivado' };
  if (r.asignatura_activa === null) return { status: 400, error: 'La asignatura seleccionada no existe' };
  if (!r.asignatura_activa)         return { status: 400, error: 'La asignatura seleccionada está desactivada' };
  if (r.profesor_activo === null)   return { status: 400, error: 'El profesor seleccionado no existe' };
  if (!r.profesor_activo)           return { status: 400, error: 'El profesor seleccionado está desactivado' };
  if (!r.sala_existe)               return { status: 400, error: `La sala "${h.sala}" no existe en Aulas` };

  // Solo se consideran horarios de cursos activos (los de cursos desactivados no se dictan)
  const choques = await client.query(
    `SELECT h.id, h.hora_inicio, h.hora_fin, h.sala,
            c.nombre    AS curso,
            asig.nombre AS asignatura,
            p.nombre || ' ' || p.apellido_paterno AS profesor,
            (h.id_profesor = $4)                    AS choque_profesor,
            (h.id_curso    = $5)                    AS choque_curso,
            ($6::text IS NOT NULL AND h.sala = $6)  AS choque_sala
     FROM horarios h
     JOIN cursos      c    ON h.id_curso      = c.id
     JOIN asignaturas asig ON h.id_asignatura = asig.id
     JOIN profesores  p    ON h.id_profesor   = p.id
     WHERE h.dia_semana = $1
       AND h.hora_inicio < $3::time
       AND h.hora_fin    > $2::time
       AND h.id <> COALESCE($7::int, 0)
       AND c.activo = TRUE
       AND (h.id_profesor = $4 OR h.id_curso = $5 OR ($6::text IS NOT NULL AND h.sala = $6))
     ORDER BY h.hora_inicio`,
    [h.dia_semana, h.hora_inicio, h.hora_fin, h.id_profesor, h.id_curso, h.sala, idExcluir]
  );

  if (choques.rows.length) {
    const dia = DIAS_VALIDOS[h.dia_semana];
    const mensajes = choques.rows.map(c => {
      const bloque = `${dia} ${hhmm(c.hora_inicio)}–${hhmm(c.hora_fin)} (${c.asignatura}, ${c.curso})`;
      if (c.choque_profesor) return `El profesor ${c.profesor} ya tiene clase el ${bloque}`;
      if (c.choque_curso)    return `El curso ${c.curso} ya tiene clase el ${bloque}`;
      return `La sala ${c.sala} ya está ocupada el ${bloque}`;
    });
    return {
      status: 409,
      error: 'Choque de horario: ' + mensajes.join(' · '),
      conflictos: choques.rows.map(c => ({ ...c, hora_inicio: hhmm(c.hora_inicio), hora_fin: hhmm(c.hora_fin) }))
    };
  }
  return null;
}

// Serializa las escrituras de horarios para que dos admins guardando a la vez
// no puedan crear un choque entre ellos (el lock se libera con COMMIT/ROLLBACK)
const lockHorarios = client => client.query("SELECT pg_advisory_xact_lock(hashtext('horarios'))");

// =====================================================
// GET /horarios
// Listar horarios, filtrable por dia_semana y/o id_curso
// Query params opcionales: ?dia_semana=N  ?id_curso=N
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { dia_semana, id_curso, id_profesor } = req.query;

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
    if (id_profesor) {
      params.push(id_profesor);
      where += ` AND h.id_profesor = $${params.length}`;
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

  const nuevo = {
    id_curso:      parseInt(id_curso),
    id_asignatura: parseInt(id_asignatura),
    id_profesor:   parseInt(id_profesor),
    dia_semana:    parseInt(dia_semana),
    hora_inicio:   String(hora_inicio),
    hora_fin:      String(hora_fin),
    sala:          sala ? String(sala).trim().toUpperCase() : null
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockHorarios(client);

    const invalido = await validarHorario(client, nuevo);
    if (invalido) {
      await client.query('ROLLBACK');
      const { status, ...body } = invalido;
      return res.status(status).json(body);
    }

    const result = await client.query(
      `INSERT INTO horarios (id_curso, id_asignatura, id_profesor, dia_semana, hora_inicio, hora_fin, sala)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [nuevo.id_curso, nuevo.id_asignatura, nuevo.id_profesor, nuevo.dia_semana,
       nuevo.hora_inicio, nuevo.hora_fin, nuevo.sala]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Ya existe un horario para ese curso, asignatura, día y hora de inicio'
      });
    }
    console.error('[POST /horarios]', err.message);
    res.status(500).json({ error: 'Error al crear horario' });
  } finally { client.release(); }
});

// =====================================================
// PUT /horarios/:id
// Actualizar un bloque horario (los campos omitidos conservan su valor;
// "sala": null o "" deja el bloque sin sala)
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const b = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockHorarios(client);

    const actual = await client.query('SELECT * FROM horarios WHERE id = $1', [id]);
    if (!actual.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Horario no encontrado' });
    }
    const a = actual.rows[0];

    // Se valida el bloque tal como quedaría después de editar
    const final = {
      id_curso:      b.id_curso      ? parseInt(b.id_curso)      : a.id_curso,
      id_asignatura: b.id_asignatura ? parseInt(b.id_asignatura) : a.id_asignatura,
      id_profesor:   b.id_profesor   ? parseInt(b.id_profesor)   : a.id_profesor,
      dia_semana:    b.dia_semana    ? parseInt(b.dia_semana)    : a.dia_semana,
      hora_inicio:   b.hora_inicio   ? String(b.hora_inicio)     : String(a.hora_inicio),
      hora_fin:      b.hora_fin      ? String(b.hora_fin)        : String(a.hora_fin),
      sala: 'sala' in b ? (b.sala ? String(b.sala).trim().toUpperCase() : null) : a.sala
    };

    const invalido = await validarHorario(client, final, parseInt(id));
    if (invalido) {
      await client.query('ROLLBACK');
      const { status, ...body } = invalido;
      return res.status(status).json(body);
    }

    const result = await client.query(
      `UPDATE horarios SET
        id_curso = $1, id_asignatura = $2, id_profesor = $3, dia_semana = $4,
        hora_inicio = $5, hora_fin = $6, sala = $7
       WHERE id = $8
       RETURNING *`,
      [final.id_curso, final.id_asignatura, final.id_profesor, final.dia_semana,
       final.hora_inicio, final.hora_fin, final.sala, id]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un horario con esos datos' });
    }
    console.error('[PUT /horarios/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar horario' });
  } finally { client.release(); }
});

// =====================================================
// DELETE /horarios/:id
// Eliminar un bloque horario.
// Se bloquea si la clase ya tiene asistencia registrada: la FK con CASCADE
// borraría todo ese historial de asistencia.
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const chk = await pool.query(
      'SELECT COUNT(*)::int AS total FROM asistencia_cabecera WHERE id_horario = $1', [id]
    );
    if (chk.rows[0].total > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: esta clase tiene ${chk.rows[0].total} registro(s) de asistencia. ` +
               'Eliminarla borraría ese historial. Si cambió el profesor, la hora o la sala, edita el horario.'
      });
    }

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
