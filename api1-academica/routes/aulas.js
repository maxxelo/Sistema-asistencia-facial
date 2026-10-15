const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// =====================================================
// GET /aulas
// Listar todas las aulas/salas
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, codigo, nombre, capacidad FROM aulas ORDER BY codigo'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /aulas]', err.message);
    res.status(500).json({ error: 'Error al obtener aulas' });
  }
});

// =====================================================
// POST /aulas
// Crear un nueva aula
// Body: { codigo, nombre?, capacidad? }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { codigo, nombre, capacidad } = req.body;

  if (!codigo) {
    return res.status(400).json({ error: 'El código del aula es obligatorio (ej: A101, LAB1)' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO aulas (codigo, nombre, capacidad) VALUES ($1, $2, $3) RETURNING *',
      [codigo.trim().toUpperCase(),
       nombre ? nombre.trim() : null,
       capacidad ? parseInt(capacidad) : 30]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe un aula con el código "${req.body.codigo}"` });
    }
    console.error('[POST /aulas]', err.message);
    res.status(500).json({ error: 'Error al crear aula' });
  }
});

// =====================================================
// PUT /aulas/:id
// Actualizar un aula
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { codigo, nombre, capacidad } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const anterior = await client.query('SELECT codigo FROM aulas WHERE id = $1', [id]);
    const result = await client.query(
      `UPDATE aulas SET
        codigo    = COALESCE($1, codigo),
        nombre    = COALESCE($2, nombre),
        capacidad = COALESCE($3, capacidad)
       WHERE id = $4
       RETURNING *`,
      [codigo ? codigo.trim().toUpperCase() : null,
       nombre ?? null,
       capacidad ? parseInt(capacidad) : null,
       id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aula no encontrada' });
    }
    // Si cambió el código, los horarios que usaban esa sala se actualizan también
    if (anterior.rows[0].codigo !== result.rows[0].codigo) {
      await client.query('UPDATE horarios SET sala = $1 WHERE sala = $2',
        [result.rows[0].codigo, anterior.rows[0].codigo]);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un aula con ese código' });
    }
    console.error('[PUT /aulas/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar aula' });
  } finally { client.release(); }
});

// =====================================================
// DELETE /aulas/:id
// Eliminar un aula
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const chk = await pool.query(
      `SELECT COUNT(*)::int AS total FROM horarios h
       JOIN aulas a ON h.sala = a.codigo
       JOIN cursos c ON h.id_curso = c.id AND c.activo = TRUE
       WHERE a.id = $1`, [id]
    );
    if (chk.rows[0].total > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: el aula se usa en ${chk.rows[0].total} horario(s). Cámbiales la sala primero.`
      });
    }

    const result = await pool.query(
      'DELETE FROM aulas WHERE id = $1 RETURNING id, codigo', [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Aula no encontrada' });
    res.json({ mensaje: `Aula ${result.rows[0].codigo} eliminada correctamente` });
  } catch (err) {
    console.error('[DELETE /aulas/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar aula' });
  }
});

module.exports = router;
