const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// Normaliza id_alumnos (array) / id_alumno (legacy) a un array de enteros sin repetidos.
// Devuelve null si no se envió ninguno de los dos (= no tocar los vínculos).
function leerIdsAlumnos(body) {
  let ids = body.id_alumnos;
  if (ids === undefined && body.id_alumno !== undefined) ids = body.id_alumno ? [body.id_alumno] : [];
  if (ids === undefined) return null;
  if (!Array.isArray(ids)) ids = [ids];
  return [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

// GET /apoderados  (todos, o ?id_alumno=N para los de un alumno)
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { id_alumno } = req.query;
  try {
    if (id_alumno) {
      const r = await pool.query(
        `SELECT ap.*, aa.id_alumno
         FROM apoderados ap
         JOIN alumnos_apoderados aa ON ap.id = aa.id_apoderado
         WHERE aa.id_alumno = $1 AND ap.activo = TRUE
         ORDER BY ap.nombre`, [id_alumno]
      );
      return res.json(r.rows);
    }
    const r = await pool.query(
      `SELECT ap.*,
              STRING_AGG(a.nombre || ' ' || a.apellido_paterno, ', ') AS alumnos_vinculados,
              COALESCE(
                JSON_AGG(JSON_BUILD_OBJECT(
                  'id', a.id, 'rut', a.rut, 'curso', c.nombre,
                  'nombre', a.nombre || ' ' || a.apellido_paterno
                ) ORDER BY a.nombre) FILTER (WHERE a.id IS NOT NULL),
                '[]'
              ) AS alumnos
       FROM apoderados ap
       LEFT JOIN alumnos_apoderados aa ON ap.id = aa.id_apoderado
       LEFT JOIN alumnos a ON aa.id_alumno = a.id
       LEFT JOIN cursos c ON a.id_curso = c.id
       GROUP BY ap.id
       ORDER BY ap.activo DESC, ap.nombre`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /apoderados]', err.message);
    res.status(500).json({ error: 'Error al obtener apoderados' });
  }
});

// POST /apoderados
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { rut, nombre, telefono, email, parentesco, direccion } = req.body;
  const idsAlumnos = leerIdsAlumnos(req.body) || [];
  if (!rut || !nombre)
    return res.status(400).json({ error: 'Campos requeridos: rut, nombre' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO apoderados (rut, nombre, telefono, email, parentesco, direccion)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rut.trim(), nombre.trim(), telefono||null, email||null, parentesco||null, direccion||null]
    );
    const apoderado = r.rows[0];
    for (const idAl of idsAlumnos) {
      await client.query(
        'INSERT INTO alumnos_apoderados (id_alumno, id_apoderado) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [idAl, apoderado.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(apoderado);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') return res.status(400).json({ error: 'Uno de los alumnos seleccionados no existe' });
    if (err.code === '23505') return res.status(409).json({ error: `Ya existe un apoderado con el RUT "${rut}"` });
    console.error('[POST /apoderados]', err.message);
    res.status(500).json({ error: 'Error al crear apoderado' });
  } finally { client.release(); }
});

// PUT /apoderados/:id
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { rut, nombre, telefono, email, parentesco, direccion, activo } = req.body;
  const idsAlumnos = leerIdsAlumnos(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE apoderados SET
         rut=COALESCE($1,rut), nombre=COALESCE($2,nombre), telefono=COALESCE($3,telefono),
         email=COALESCE($4,email), parentesco=COALESCE($5,parentesco),
         direccion=COALESCE($6,direccion), activo=COALESCE($7,activo)
       WHERE id=$8 RETURNING *`,
      [rut,nombre,telefono,email,parentesco,direccion,activo,id]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Apoderado no encontrado' });
    }
    // Si viene la lista de alumnos, se sincronizan los vínculos (quita los que no estén, agrega los nuevos)
    if (idsAlumnos) {
      await client.query(
        'DELETE FROM alumnos_apoderados WHERE id_apoderado = $1 AND NOT (id_alumno = ANY($2::int[]))',
        [id, idsAlumnos]
      );
      for (const idAl of idsAlumnos) {
        await client.query(
          'INSERT INTO alumnos_apoderados (id_alumno, id_apoderado) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [idAl, id]
        );
      }
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23503') return res.status(400).json({ error: 'Uno de los alumnos seleccionados no existe' });
    if (err.code === '23505') return res.status(409).json({ error: 'RUT duplicado' });
    console.error('[PUT /apoderados/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar apoderado' });
  } finally { client.release(); }
});

// POST /apoderados/:id/vincular  — vincular apoderado a alumno
router.post('/:id/vincular', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { id_alumno } = req.body;
  if (!id_alumno) return res.status(400).json({ error: 'Se requiere id_alumno' });
  try {
    await pool.query(
      'INSERT INTO alumnos_apoderados (id_alumno, id_apoderado) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id_alumno, id]
    );
    res.json({ mensaje: 'Apoderado vinculado al alumno' });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Alumno o apoderado no existe' });
    console.error('[POST /apoderados/:id/vincular]', err.message);
    res.status(500).json({ error: 'Error al vincular apoderado' });
  }
});

// DELETE /apoderados/:id/desvincular/:id_alumno
router.delete('/:id/desvincular/:id_alumno', verificarToken, soloAdmin, async (req, res) => {
  const { id, id_alumno } = req.params;
  try {
    await pool.query(
      'DELETE FROM alumnos_apoderados WHERE id_apoderado=$1 AND id_alumno=$2', [id, id_alumno]
    );
    res.json({ mensaje: 'Apoderado desvinculado del alumno' });
  } catch (err) {
    console.error('[DELETE /apoderados/:id/desvincular/:id_alumno]', err.message);
    res.status(500).json({ error: 'Error al desvincular apoderado' });
  }
});

// DELETE /apoderados/:id
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query('DELETE FROM apoderados WHERE id=$1 RETURNING nombre', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Apoderado no encontrado' });
    res.json({ mensaje: `Apoderado "${r.rows[0].nombre}" eliminado` });
  } catch (err) {
    console.error('[DELETE /apoderados/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar apoderado' });
  }
});

module.exports = router;
