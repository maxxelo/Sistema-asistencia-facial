const jwt = require('jsonwebtoken');
require('dotenv').config();

// Verifica que el token JWT sea válido
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded; // { id, nombre_usuario, tipo_persona, id_profesor, id_rol }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

// Solo administradores
const soloAdmin = (req, res, next) => {
  if (req.usuario.tipo_persona !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
};

// Administradores o profesores
const adminOProfesor = (req, res, next) => {
  if (!['admin', 'profesor'].includes(req.usuario.tipo_persona)) {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  next();
};

module.exports = { verificarToken, soloAdmin, adminOProfesor };
