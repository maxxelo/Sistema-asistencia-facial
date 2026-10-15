const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

const TIPOS_VALIDOS = ['nacional', 'institucional', 'vacaciones'];

// =====================================================
// GET /feriados  (filtrable por ?anio=YYYY)
// Lista los días no lectivos. Admin o Profesor (lectura).
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const { anio } = req.query;
  try {
    const params = [];
    let where = '';
    if (anio) {
      params.push(anio);
      where = `WHERE EXTRACT(YEAR FROM fecha) = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT * FROM feriados ${where} ORDER BY fecha`, params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /feriados]', err.message);
    res.status(500).json({ error: 'Error al obtener feriados' });
  }
});

// =====================================================
// POST /feriados   Body: { fecha, descripcion, tipo? }
// Solo Admin
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { fecha, descripcion, tipo } = req.body;
  if (!fecha || !descripcion)
    return res.status(400).json({ error: 'Campos requeridos: fecha, descripcion' });
  if (tipo && !TIPOS_VALIDOS.includes(tipo))
    return res.status(400).json({ error: `tipo debe ser: ${TIPOS_VALIDOS.join(', ')}` });
  try {
    const r = await pool.query(
      `INSERT INTO feriados (fecha, descripcion, tipo) VALUES ($1,$2,$3) RETURNING *`,
      [fecha, descripcion.trim(), tipo || 'nacional']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ya existe un feriado registrado en esa fecha' });
    console.error('[POST /feriados]', err.message);
    res.status(500).json({ error: 'Error al crear feriado' });
  }
});

// =====================================================
// POST /feriados/rango   Body: { fecha_inicio, fecha_fin, descripcion, tipo? }
// Inserta un rango de días (ej: vacaciones de invierno). Excluye fines de semana.
// Solo Admin
// =====================================================
router.post('/rango', verificarToken, soloAdmin, async (req, res) => {
  const { fecha_inicio, fecha_fin, descripcion, tipo } = req.body;
  if (!fecha_inicio || !fecha_fin || !descripcion)
    return res.status(400).json({ error: 'Campos requeridos: fecha_inicio, fecha_fin, descripcion' });
  if (fecha_inicio > fecha_fin)
    return res.status(400).json({ error: 'fecha_fin debe ser mayor o igual a fecha_inicio' });
  try {
    // generate_series crea una fila por día; se omiten sábados y domingos (ISODOW 6,7)
    const r = await pool.query(
      `INSERT INTO feriados (fecha, descripcion, tipo)
       SELECT d::date, $3, $4
       FROM generate_series($1::date, $2::date, '1 day'::interval) d
       WHERE EXTRACT(ISODOW FROM d) < 6
       ON CONFLICT (fecha) DO NOTHING
       RETURNING *`,
      [fecha_inicio, fecha_fin, descripcion.trim(), tipo || 'vacaciones']
    );
    res.status(201).json({ mensaje: `${r.rows.length} día(s) agregados`, dias: r.rows });
  } catch (err) {
    console.error('[POST /feriados/rango]', err.message);
    res.status(500).json({ error: 'Error al crear rango de feriados' });
  }
});

// =====================================================
// DELETE /feriados/:id   Solo Admin
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await pool.query('DELETE FROM feriados WHERE id=$1 RETURNING descripcion', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Feriado no encontrado' });
    res.json({ mensaje: `Feriado "${r.rows[0].descripcion}" eliminado` });
  } catch (err) {
    console.error('[DELETE /feriados/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar feriado' });
  }
});

module.exports = router;
