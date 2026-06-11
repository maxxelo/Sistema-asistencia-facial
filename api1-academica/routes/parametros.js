const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin } = require('../middleware/auth');

// Devuelve parametros_sistema + el umbral biométrico como clave virtual
async function listarParametros() {
  const params = await pool.query(
    'SELECT clave, valor, descripcion FROM parametros_sistema ORDER BY clave'
  );
  const lista = params.rows;
  const bio = await pool.query(
    'SELECT umbral_confianza FROM configuracion_biometrica WHERE id = 1'
  );
  if (bio.rows.length) {
    lista.push({
      clave: 'biometria_umbral',
      valor: String(bio.rows[0].umbral_confianza),
      descripcion: 'Umbral de distancia del reconocimiento facial (0.3–0.9). Menor = más estricto.'
    });
  }
  return lista;
}

// GET /parametros — lista todos los parámetros del sistema
router.get('/', verificarToken, soloAdmin, async (req, res) => {
  try {
    res.json(await listarParametros());
  } catch (err) {
    console.error('[GET /parametros]', err.message);
    res.status(500).json({ error: 'Error al obtener parámetros' });
  }
});

// PUT /parametros/:clave — actualizar (o crear) un parámetro individual
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

// POST /parametros/bulk — guarda varios parámetros de una vez (upsert por clave)
// Body: [{ clave, valor }, ...]  — devuelve la lista completa actualizada
router.post('/bulk', verificarToken, soloAdmin, async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Se espera un arreglo de { clave, valor }' });
  }

  for (const item of items) {
    if (!item || typeof item.clave !== 'string' || !/^[a-z0-9_]{2,50}$/i.test(item.clave.trim())) {
      return res.status(400).json({ error: `Clave de parámetro inválida: "${item?.clave ?? ''}"` });
    }
    if (item.clave === 'umbral_asistencia') {
      const v = parseInt(item.valor);
      if (isNaN(v) || v < 50 || v > 100)
        return res.status(400).json({ error: 'El umbral de asistencia debe estar entre 50 y 100' });
    }
    if (item.clave === 'biometria_umbral') {
      const v = parseFloat(item.valor);
      if (isNaN(v) || v < 0.3 || v > 0.9)
        return res.status(400).json({ error: 'El umbral biométrico debe estar entre 0.3 y 0.9' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const clave = item.clave.trim();
      const valor = item.valor == null ? '' : String(item.valor).trim();
      if (clave === 'biometria_umbral') {
        await client.query(
          `INSERT INTO configuracion_biometrica (id, umbral_confianza)
           VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET umbral_confianza = EXCLUDED.umbral_confianza`,
          [parseFloat(valor)]
        );
      } else {
        await client.query(
          `INSERT INTO parametros_sistema (clave, valor) VALUES ($1, $2)
           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
          [clave, valor]
        );
      }
    }
    await client.query('COMMIT');
    res.json(await listarParametros());
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /parametros/bulk]', err.message);
    res.status(500).json({ error: 'Error al guardar parámetros' });
  } finally {
    client.release();
  }
});

module.exports = router;
