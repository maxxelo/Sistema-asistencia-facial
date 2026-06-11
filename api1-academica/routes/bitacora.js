const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin } = require('../middleware/auth');

// GET /bitacora — registro de operaciones, con filtros
// Query params: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tabla=alumnos&id_usuario=N&limite=100
router.get('/', verificarToken, soloAdmin, async (req, res) => {
  const { desde, hasta, tabla, id_usuario } = req.query;
  let limite = parseInt(req.query.limite) || 100;
  limite = Math.min(Math.max(limite, 1), 500);

  try {
    let query = `
      SELECT b.id, b.fecha_hora, b.accion, b.tabla_afectada, b.registro_id,
             u.nombre_usuario, u.tipo_persona
      FROM bitacora_operaciones b
      LEFT JOIN usuarios u ON b.id_usuario = u.id
      WHERE 1=1`;
    const params = [];

    if (id_usuario) { params.push(id_usuario); query += ` AND b.id_usuario = $${params.length}`; }
    if (tabla)      { params.push(tabla);       query += ` AND b.tabla_afectada = $${params.length}`; }
    if (desde)      { params.push(desde);       query += ` AND b.fecha_hora >= $${params.length}`; }
    if (hasta) {
      params.push(hasta);
      query += ` AND b.fecha_hora < ($${params.length}::date + INTERVAL '1 day')`;
    }

    params.push(limite);
    query += ` ORDER BY b.fecha_hora DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /bitacora]', err.message);
    res.status(500).json({ error: 'Error al obtener la bitácora' });
  }
});

// Helper exportable para registrar operaciones desde otras rutas
async function registrarOperacion(id_usuario, accion, tabla_afectada, registro_id = null) {
  try {
    await pool.query(
      `INSERT INTO bitacora_operaciones (id_usuario, accion, tabla_afectada, registro_id)
       VALUES ($1, $2, $3, $4)`,
      [id_usuario || null, accion, tabla_afectada, registro_id || null]
    );
  } catch (err) {
    console.error('[bitacora]', err.message);
  }
}

module.exports = router;
module.exports.registrarOperacion = registrarOperacion;
