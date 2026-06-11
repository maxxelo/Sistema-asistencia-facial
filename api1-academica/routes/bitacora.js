const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin } = require('../middleware/auth');

// =====================================================
// GET /bitacora
// Registro de operaciones del sistema, con filtros
// Query params opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&tabla=alumnos&limite=100
// Auth: JWT (Solo Admin)
// =====================================================
router.get('/', verificarToken, soloAdmin, async (req, res) => {
  const { desde, hasta, tabla } = req.query;
  let limite = parseInt(req.query.limite) || 100;
  limite = Math.min(Math.max(limite, 1), 500);

  try {
    let query = `
      SELECT
        b.id,
        b.fecha_hora,
        b.accion,
        b.tabla_afectada,
        b.registro_id,
        u.nombre_usuario,
        u.tipo_persona
      FROM bitacora_operaciones b
      LEFT JOIN usuarios u ON b.id_usuario = u.id
      WHERE 1=1`;
    const params = [];

    if (desde) {
      params.push(desde);
      query += ` AND b.fecha_hora >= $${params.length}`;
    }
    if (hasta) {
      // Incluir el día "hasta" completo
      params.push(hasta);
      query += ` AND b.fecha_hora < ($${params.length}::date + INTERVAL '1 day')`;
    }
    if (tabla) {
      params.push(tabla);
      query += ` AND b.tabla_afectada = $${params.length}`;
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

module.exports = router;
