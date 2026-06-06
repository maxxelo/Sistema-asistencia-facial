const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// =====================================================
// GET /asignaturas
// Listar todas las asignaturas
// Auth: JWT (Admin o Profesor)
// =====================================================
router.get('/', verificarToken, adminOProfesor, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, codigo, horas_semanales, activo
       FROM asignaturas
       ORDER BY activo DESC, nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /asignaturas]', err.message);
    res.status(500).json({ error: 'Error al obtener asignaturas' });
  }
});

// =====================================================
// POST /asignaturas
// Crear una nueva asignatura
// Body: { nombre, codigo?, horas_semanales? }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, codigo, horas_semanales } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre de la asignatura es obligatorio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO asignaturas (nombre, codigo, horas_semanales)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nombre.trim(),
       codigo ? codigo.trim().toUpperCase() : null,
       horas_semanales ? parseInt(horas_semanales) : 4]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe una asignatura con el código "${req.body.codigo}"` });
    }
    console.error('[POST /asignaturas]', err.message);
    res.status(500).json({ error: 'Error al crear asignatura' });
  }
});

// =====================================================
// PUT /asignaturas/:id
// Actualizar una asignatura
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre, codigo, horas_semanales, activo } = req.body;

  try {
    const result = await pool.query(
      `UPDATE asignaturas SET
        nombre          = COALESCE($1, nombre),
        codigo          = COALESCE($2, codigo),
        horas_semanales = COALESCE($3, horas_semanales),
        activo          = COALESCE($4, activo)
       WHERE id = $5
       RETURNING *`,
      [nombre ?? null,
       codigo ? codigo.trim().toUpperCase() : null,
       horas_semanales ? parseInt(horas_semanales) : null,
       activo ?? null, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Asignatura no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una asignatura con ese código' });
    }
    console.error('[PUT /asignaturas/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar asignatura' });
  }
});

// =====================================================
// DELETE /asignaturas/:id
// Eliminar una asignatura.
// Bloquea si tiene horarios asignados.
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const chk = await pool.query(
      'SELECT COUNT(*) AS total FROM horarios WHERE id_asignatura = $1', [id]
    );
    if (parseInt(chk.rows[0].total) > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: tiene ${chk.rows[0].total} horario(s) asignado(s). Elimina esos horarios primero.`
      });
    }

    const result = await pool.query(
      'DELETE FROM asignaturas WHERE id = $1 RETURNING id, nombre', [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Asignatura no encontrada' });
    res.json({ mensaje: `Asignatura "${result.rows[0].nombre}" eliminada correctamente` });
  } catch (err) {
    console.error('[DELETE /asignaturas/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar asignatura' });
  }
});

module.exports = router;
