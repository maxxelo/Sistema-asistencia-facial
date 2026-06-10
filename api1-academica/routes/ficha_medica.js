const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { verificarToken, soloAdmin, adminOProfesor } = require('../middleware/auth');

// GET /ficha-medica/:id_alumno
router.get('/:id_alumno', verificarToken, adminOProfesor, async (req, res) => {
  const { id_alumno } = req.params;
  try {
    const r = await pool.query(
      `SELECT fm.*,
              a.nombre || ' ' || a.apellido_paterno AS alumno,
              a.rut
       FROM ficha_medica fm
       JOIN alumnos a ON fm.id_alumno = a.id
       WHERE fm.id_alumno = $1`, [id_alumno]
    );
    if (!r.rows.length) return res.json(null);  // sin ficha aún
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[GET /ficha-medica/:id]', err.message);
    res.status(500).json({ error: 'Error al obtener ficha médica' });
  }
});

// POST /ficha-medica  — crear ficha (solo si no existe)
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const {
    id_alumno, tipo_sangre, alergias, condiciones_cronicas,
    medicamentos, contacto_emergencia_nombre, contacto_emergencia_telefono,
    seguro_medico, observaciones
  } = req.body;
  if (!id_alumno) return res.status(400).json({ error: 'id_alumno es requerido' });
  try {
    const r = await pool.query(
      `INSERT INTO ficha_medica
         (id_alumno, tipo_sangre, alergias, condiciones_cronicas, medicamentos,
          contacto_emergencia_nombre, contacto_emergencia_telefono, seguro_medico, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [id_alumno, tipo_sangre||null, alergias||null, condiciones_cronicas||null,
       medicamentos||null, contacto_emergencia_nombre||null,
       contacto_emergencia_telefono||null, seguro_medico||null, observaciones||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Este alumno ya tiene ficha médica. Usa PUT para actualizar.' });
    console.error('[POST /ficha-medica]', err.message);
    res.status(500).json({ error: 'Error al crear ficha médica' });
  }
});

// PUT /ficha-medica/:id_alumno  — actualizar o crear (upsert)
router.put('/:id_alumno', verificarToken, soloAdmin, async (req, res) => {
  const { id_alumno } = req.params;
  const {
    tipo_sangre, alergias, condiciones_cronicas, medicamentos,
    contacto_emergencia_nombre, contacto_emergencia_telefono,
    seguro_medico, observaciones
  } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO ficha_medica
         (id_alumno, tipo_sangre, alergias, condiciones_cronicas, medicamentos,
          contacto_emergencia_nombre, contacto_emergencia_telefono, seguro_medico, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id_alumno) DO UPDATE SET
         tipo_sangre                  = EXCLUDED.tipo_sangre,
         alergias                     = EXCLUDED.alergias,
         condiciones_cronicas         = EXCLUDED.condiciones_cronicas,
         medicamentos                 = EXCLUDED.medicamentos,
         contacto_emergencia_nombre   = EXCLUDED.contacto_emergencia_nombre,
         contacto_emergencia_telefono = EXCLUDED.contacto_emergencia_telefono,
         seguro_medico                = EXCLUDED.seguro_medico,
         observaciones                = EXCLUDED.observaciones
       RETURNING *`,
      [id_alumno, tipo_sangre||null, alergias||null, condiciones_cronicas||null,
       medicamentos||null, contacto_emergencia_nombre||null,
       contacto_emergencia_telefono||null, seguro_medico||null, observaciones||null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /ficha-medica/:id_alumno]', err.message);
    res.status(500).json({ error: 'Error al guardar ficha médica' });
  }
});

module.exports = router;
