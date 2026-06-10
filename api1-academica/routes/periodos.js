const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// GET /periodos
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM periodos_academicos ORDER BY fecha_inicio DESC');
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /periodos]', err.message);
    res.status(500).json({ error: 'Error al obtener períodos' });
  }
});

// POST /periodos
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, fecha_inicio, fecha_fin, activo } = req.body;
  if (!nombre || !fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: 'Campos requeridos: nombre, fecha_inicio, fecha_fin' });
  try {
    // Si este va a ser activo, desactivar los demás
    if (activo) await pool.query('UPDATE periodos_academicos SET activo = FALSE');
    const r = await pool.query(
      'INSERT INTO periodos_academicos (nombre, fecha_inicio, fecha_fin, activo) VALUES ($1,$2,$3,$4) RETURNING *',
      [nombre.trim(), fecha_inicio, fecha_fin, activo ?? false]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST /periodos]', err.message);
    res.status(500).json({ error: 'Error al crear período' });
  }
});

// PUT /periodos/:id
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, fecha_inicio, fecha_fin, activo } = req.body;
  try {
    if (activo) await pool.query('UPDATE periodos_academicos SET activo = FALSE WHERE id != $1', [id]);
    const r = await pool.query(
      `UPDATE periodos_academicos SET
         nombre = COALESCE($1,nombre), fecha_inicio = COALESCE($2,fecha_inicio),
         fecha_fin = COALESCE($3,fecha_fin), activo = COALESCE($4,activo)
       WHERE id = $5 RETURNING *`,
      [nombre, fecha_inicio, fecha_fin, activo ?? null, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /periodos/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar período' });
  }
});

// DELETE /periodos/:id
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const chk = await pool.query('SELECT COUNT(*) FROM evaluaciones WHERE id_periodo = $1', [id]);
    if (parseInt(chk.rows[0].count) > 0)
      return res.status(409).json({ error: `No se puede eliminar: tiene ${chk.rows[0].count} evaluación(es) asociada(s)` });
    const r = await pool.query('DELETE FROM periodos_academicos WHERE id=$1 RETURNING nombre', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Período no encontrado' });
    res.json({ mensaje: `Período "${r.rows[0].nombre}" eliminado` });
  } catch (err) {
    console.error('[DELETE /periodos/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar período' });
  }
});

module.exports = router;
