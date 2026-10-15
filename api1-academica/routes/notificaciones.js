const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, adminOProfesor } = require('../middleware/auth');

// Cada usuario solo ve y modifica SUS notificaciones (id_usuario del token).

// =====================================================
// GET /notificaciones
// Lista las notificaciones del usuario, las más recientes primero.
// Query: ?solo_no_leidas=true  ·  ?limite=N (por defecto 30)
// Responde { no_leidas, notificaciones: [...] }
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  const limite = Math.min(parseInt(req.query.limite) || 30, 100);
  const soloNoLeidas = req.query.solo_no_leidas === 'true';
  try {
    const lista = await pool.query(
      `SELECT id, titulo, mensaje, leida, fecha_envio
         FROM notificaciones
        WHERE id_usuario = $1 ${soloNoLeidas ? 'AND leida = FALSE' : ''}
        ORDER BY fecha_envio DESC, id DESC
        LIMIT $2`,
      [req.usuario.id, limite]
    );
    const cuenta = await pool.query(
      'SELECT COUNT(*)::int AS n FROM notificaciones WHERE id_usuario = $1 AND leida = FALSE',
      [req.usuario.id]
    );
    res.json({ no_leidas: cuenta.rows[0].n, notificaciones: lista.rows });
  } catch (err) {
    console.error('[GET /notificaciones]', err.message);
    res.status(500).json({ error: 'Error al obtener notificaciones' });
  }
});

// PATCH /notificaciones/leer-todas — marca todas como leídas
router.patch('/leer-todas', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE notificaciones SET leida = TRUE WHERE id_usuario = $1 AND leida = FALSE',
      [req.usuario.id]
    );
    res.json({ mensaje: 'Notificaciones marcadas como leídas', marcadas: r.rowCount });
  } catch (err) {
    console.error('[PATCH /notificaciones/leer-todas]', err.message);
    res.status(500).json({ error: 'Error al actualizar notificaciones' });
  }
});

// PATCH /notificaciones/:id/leida — marca una como leída
router.patch('/:id/leida', verificarToken, adminOProfesor, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const r = await pool.query(
      'UPDATE notificaciones SET leida = TRUE WHERE id = $1 AND id_usuario = $2 RETURNING id',
      [id, req.usuario.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Notificación no encontrada' });
    res.json({ mensaje: 'Notificación marcada como leída' });
  } catch (err) {
    console.error('[PATCH /notificaciones/:id/leida]', err.message);
    res.status(500).json({ error: 'Error al actualizar la notificación' });
  }
});

module.exports = router;
