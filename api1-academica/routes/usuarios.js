const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const pool     = require('../db/connection');
const { verificarToken, soloAdmin } = require('../middleware/auth');
const { registrarOperacion } = require('./bitacora');

// =====================================================
// GET /usuarios
// Listar todos los usuarios del sistema
// Auth: JWT (Solo Admin)
// =====================================================
router.get('/', verificarToken, soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        u.id, u.nombre_usuario, u.tipo_persona, u.activo,
        u.ultimo_acceso, u.created_at,
        r.nombre AS rol,
        u.id_profesor,
        p.nombre || ' ' || p.apellido_paterno AS nombre_profesor
       FROM usuarios u
       JOIN roles r ON u.id_rol = r.id
       LEFT JOIN profesores p ON u.id_profesor = p.id
       ORDER BY u.tipo_persona DESC, u.nombre_usuario`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /usuarios]', err.message);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// =====================================================
// POST /usuarios
// Crear un nuevo usuario (admin crea cuentas de acceso)
// Body: { nombre_usuario, password, tipo_persona, id_profesor? }
// Auth: JWT (Solo Admin)
// =====================================================
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre_usuario, password, tipo_persona, id_profesor } = req.body;

  if (!nombre_usuario || !password || !tipo_persona) {
    return res.status(400).json({ error: 'Campos requeridos: nombre_usuario, password, tipo_persona' });
  }
  if (!['admin', 'profesor'].includes(tipo_persona)) {
    return res.status(400).json({ error: 'tipo_persona debe ser "admin" o "profesor"' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    // Obtener el id del rol
    const rolResult = await pool.query(
      'SELECT id FROM roles WHERE nombre = $1', [tipo_persona]
    );
    if (!rolResult.rows.length) {
      return res.status(400).json({ error: 'Rol no encontrado en la BD' });
    }
    const id_rol = rolResult.rows[0].id;

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (nombre_usuario, password_hash, id_rol, tipo_persona, id_profesor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre_usuario, tipo_persona, activo, created_at`,
      [nombre_usuario.trim(), password_hash, id_rol, tipo_persona,
       id_profesor ? parseInt(id_profesor) : null]
    );
    registrarOperacion(req.usuario.id, 'CREAR usuario', 'usuarios', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Ya existe un usuario con el nombre "${req.body.nombre_usuario}"` });
    }
    console.error('[POST /usuarios]', err.message);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// =====================================================
// PUT /usuarios/:id
// Actualizar datos del usuario (sin cambiar contraseña)
// Body: { nombre_usuario?, tipo_persona?, id_profesor?, activo? }
// Auth: JWT (Solo Admin)
// =====================================================
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nombre_usuario, tipo_persona, id_profesor, activo } = req.body;

  try {
    // Si cambia tipo_persona, actualizar también id_rol
    let id_rol = null;
    if (tipo_persona) {
      const rolResult = await pool.query(
        'SELECT id FROM roles WHERE nombre = $1', [tipo_persona]
      );
      if (rolResult.rows.length) id_rol = rolResult.rows[0].id;
    }

    const result = await pool.query(
      `UPDATE usuarios SET
        nombre_usuario = COALESCE($1, nombre_usuario),
        tipo_persona   = COALESCE($2, tipo_persona),
        id_rol         = COALESCE($3, id_rol),
        id_profesor    = COALESCE($4, id_profesor),
        activo         = COALESCE($5, activo)
       WHERE id = $6
       RETURNING id, nombre_usuario, tipo_persona, activo`,
      [nombre_usuario, tipo_persona, id_rol,
       id_profesor ? parseInt(id_profesor) : undefined,
       activo, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    }
    console.error('[PUT /usuarios/:id]', err.message);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// =====================================================
// PATCH /usuarios/:id/password
// Resetear contraseña (admin establece nueva contraseña)
// Body: { nueva_password }
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/password', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  const { nueva_password } = req.body;
  if (!nueva_password || nueva_password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const password_hash = await bcrypt.hash(nueva_password, 10);
    const result = await pool.query(
      'UPDATE usuarios SET password_hash = $1 WHERE id = $2 RETURNING id, nombre_usuario',
      [password_hash, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ mensaje: `Contraseña de "${result.rows[0].nombre_usuario}" actualizada correctamente` });
  } catch (err) {
    console.error('[PATCH /usuarios/:id/password]', err.message);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// =====================================================
// PATCH /usuarios/:id/toggle
// Activar / desactivar usuario
// Auth: JWT (Solo Admin)
// =====================================================
router.patch('/:id/toggle', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  // No puede desactivarse a sí mismo
  if (parseInt(id) === req.usuario.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }

  try {
    const result = await pool.query(
      'UPDATE usuarios SET activo = NOT activo WHERE id = $1 RETURNING id, nombre_usuario, activo',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = result.rows[0];
    res.json({
      mensaje: `Usuario "${u.nombre_usuario}" ${u.activo ? 'activado' : 'desactivado'} correctamente`
    });
  } catch (err) {
    console.error('[PATCH /usuarios/:id/toggle]', err.message);
    res.status(500).json({ error: 'Error al cambiar estado del usuario' });
  }
});

// =====================================================
// DELETE /usuarios/:id
// Eliminar permanentemente un usuario
// Auth: JWT (Solo Admin)
// =====================================================
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  if (parseInt(id) === req.usuario.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre_usuario',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    registrarOperacion(req.usuario.id, 'ELIMINAR usuario', 'usuarios', id);
    res.json({ mensaje: `Usuario "${result.rows[0].nombre_usuario}" eliminado correctamente` });
  } catch (err) {
    console.error('[DELETE /usuarios/:id]', err.message);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
