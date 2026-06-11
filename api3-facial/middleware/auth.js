const jwt = require('jsonwebtoken');
require('dotenv').config();

const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

const soloAdmin = (req, res, next) => {
  if (req.usuario.tipo_persona !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
};

const adminOProfesor = (req, res, next) => {
  if (!['admin', 'profesor'].includes(req.usuario.tipo_persona)) {
    return res.status(403).json({ error: 'Acceso no autorizado' });
  }
  next();
};

module.exports = { verificarToken, soloAdmin, adminOProfesor };
