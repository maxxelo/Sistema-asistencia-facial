const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// GET /parametros  — todos los parámetros del sistema
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM parametros_sistema ORDER BY clave');
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /parametros]', err.message);
    res.status(500).json({ error: 'Error al obtener parámetros' });
  }
});

// PUT /parametros/:clave  — actualizar (o crear) un parámetro
router.put('/:clave', verificarToken, soloAdmin, async (req, res) => {
  const { clave } = req.params;
  const { valor, descripcion } = req.body;
  if (valor === undefined) return res.status(400).json({ error: 'Se requiere valor' });
  try {
    const r = await pool.query(
      `INSERT INTO parametros_sistema (clave, valor, descripcion)
       VALUES ($1, $2, $3)
       ON CONFLICT (clave) DO UPDATE
         SET valor = EXCLUDED.valor,
             descripcion = COALESCE(EXCLUDED.descripcion, parametros_sistema.descripcion)
       RETURNING *`,
      [clave, String(valor), descripcion || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /parametros/:clave]', err.message);
    res.status(500).json({ error: 'Error al guardar parámetro' });
  }
});

// POST /parametros  — guardar múltiples parámetros a la vez
// Body: [{ clave, valor, descripcion }, ...]
router.post('/bulk', verificarToken, soloAdmin, async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Se esperaba un array de parámetros' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { clave, valor, descripcion } of items) {
      if (!clave || valor === undefined) continue;
      await client.query(
        `INSERT INTO parametros_sistema (clave, valor, descripcion)
         VALUES ($1,$2,$3)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor,
           descripcion = COALESCE(EXCLUDED.descripcion, parametros_sistema.descripcion)`,
        [clave, String(valor), descripcion || null]
      );
    }
    await client.query('COMMIT');
    const r = await client.query('SELECT * FROM parametros_sistema ORDER BY clave');
    res.json(r.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /parametros/bulk]', err.message);
    res.status(500).json({ error: 'Error al guardar parámetros' });
  } finally { client.release(); }
});

module.exports = router;
