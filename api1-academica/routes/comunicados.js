const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// GET /comunicados  — todos los comunicados, los más recientes primero
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cm.*, u.nombre_usuario AS autor_usuario
       FROM comunicados cm
       LEFT JOIN usuarios u ON cm.id_autor = u.id
       ORDER BY cm.fecha_publicacion DESC
       LIMIT 100`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /comunicados]', err.message);
    res.status(500).json({ error: 'Error al obtener comunicados' });
  }
});

// POST /comunicados
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { titulo, contenido } = req.body;
  if (!titulo || !contenido)
    return res.status(400).json({ error: 'Campos requeridos: titulo, contenido' });
  try {
    const r = await pool.query(
      'INSERT INTO comunicados (titulo, contenido, id_autor) VALUES ($1,$2,$3) RETURNING *',
      [titulo.trim(), contenido.trim(), req.usuario.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[POST /comunicados]', err.message);
    res.status(500).json({ error: 'Error al crear comunicado' });
  }
});

// PUT /comunicados/:id
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { titulo, contenido } = req.body;
  try {
    const r = await pool.query(
      `UPDATE comunicados SET titulo=COALESCE($1,titulo), contenido=COALESCE($2,contenido)
       WHERE id=$3 RETURNING *`,
      [titulo, contenido, id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Comunicado no encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /comunicados/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar comunicado' });
  }
});

// DELETE /comunicados/:id
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query('DELETE FROM comunicados WHERE id=$1 RETURNING titulo', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Comunicado no encontrado' });
    res.json({ mensaje: `Comunicado eliminado` });
  } catch (err) {
    console.error('[DELETE /comunicados/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar comunicado' });
  }
});

module.exports = router;
