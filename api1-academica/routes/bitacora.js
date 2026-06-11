const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin } = require('../middleware/auth');

// GET /bitacora  — últimas operaciones del sistema
// Query: ?limite=100  ?id_usuario=N  ?tabla=alumnos  ?desde=YYYY-MM-DD  ?hasta=YYYY-MM-DD
router.get('/', verificarToken, soloAdmin, async (req, res) => {
  const { id_usuario, tabla, desde, hasta } = req.query;
  const limite = Math.min(parseInt(req.query.limite) || 100, 500);
  const params = [];
  let where = 'WHERE 1=1';
  if (id_usuario) { params.push(id_usuario); where += ` AND b.id_usuario = $${params.length}`; }
  if (tabla)      { params.push(tabla);       where += ` AND b.tabla_afectada ILIKE $${params.length}`; }
  if (desde)      { params.push(desde);       where += ` AND b.fecha_hora >= $${params.length}::date`; }
  if (hasta)      { params.push(hasta + ' 23:59:59'); where += ` AND b.fecha_hora <= $${params.length}::timestamp`; }
  try {
    const r = await pool.query(
      `SELECT b.id, b.accion, b.tabla_afectada, b.registro_id, b.fecha_hora,
              u.nombre_usuario, u.tipo_persona
       FROM bitacora_operaciones b
       LEFT JOIN usuarios u ON b.id_usuario = u.id
       ${where}
       ORDER BY b.fecha_hora DESC
       LIMIT $${params.length + 1}`,
      [...params, limite]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /bitacora]', err.message);
    res.status(500).json({ error: 'Error al obtener bitácora' });
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
    // No interrumpir la operación principal si el log falla
    console.error('[bitacora]', err.message);
  }
}

module.exports = router;
module.exports.registrarOperacion = registrarOperacion;
