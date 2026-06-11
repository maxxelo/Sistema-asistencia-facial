const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../db/connection');
require('dotenv').config();

// =====================================================
// POST /login
// Recibe usuario + contraseña, devuelve JWT
// Body: { nombre_usuario, password }
// Auth: pública
// =====================================================
router.post('/', async (req, res) => {
  const { nombre_usuario, password } = req.body;

  if (!nombre_usuario || !password) {
    return res.status(400).json({ error: 'Se requiere nombre_usuario y password' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.nombre_usuario, u.password_hash, u.tipo_persona,
              u.id_rol, u.id_profesor, u.activo,
              r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON u.id_rol = r.id
       WHERE u.nombre_usuario = $1`,
      [nombre_usuario]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return res.status(401).json({ error: 'Usuario desactivado' });
    }

    // Comparar contraseña con bcrypt
    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Registrar último acceso
    await pool.query(
      'UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = $1',
      [usuario.id]
    );

    // Registrar el inicio de sesión en la bitácora (no bloquea el login si falla)
    pool.query(
      `INSERT INTO bitacora_operaciones (id_usuario, accion, tabla_afectada)
       VALUES ($1, 'LOGIN', 'usuarios')`,
      [usuario.id]
    ).catch(err => console.error('[bitacora login]', err.message));

    // Generar JWT
    const token = jwt.sign(
      {
        id:             usuario.id,
        nombre_usuario: usuario.nombre_usuario,
        tipo_persona:   usuario.tipo_persona,
        id_rol:         usuario.id_rol,
        id_profesor:    usuario.id_profesor,
        rol:            usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      usuario: {
        id:             usuario.id,
        nombre_usuario: usuario.nombre_usuario,
        tipo_persona:   usuario.tipo_persona,
        rol:            usuario.rol,
        id_profesor:    usuario.id_profesor
      }
    });

  } catch (err) {
    console.error('[POST /login]', err.message);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

module.exports = router;
