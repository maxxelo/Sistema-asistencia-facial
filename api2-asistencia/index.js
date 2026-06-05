const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const asistenciaRoutes = require('./routes/asistencia');

const app = express();

// ── Seguridad ──────────────────────────────────────────
app.use(helmet());

// CORS: solo acepta peticiones desde localhost (frontend y otras APIs)
app.use(cors({
  origin: ['http://localhost', 'http://localhost:3000', 'http://localhost:3001'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());

// Rate limiting: 100 peticiones por minuto (según arquitectura definida)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
});
app.use(limiter);

// ── Rutas ──────────────────────────────────────────────
app.use('/asistencia', asistenciaRoutes);

// Health check — para verificar que el contenedor está vivo
app.get('/health', (req, res) => {
  res.json({ status: 'ok', api: 'api2-asistencia', puerto: 3002 });
});

// Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Manejador global de errores
app.use((err, req, res, next) => {
  console.error('[Error global]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Inicio ─────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`API Asistencia corriendo en http://localhost:${PORT}`);
});
