const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const asistenciaRoutes = require('./routes/asistencia');
const auditoria        = require('./middleware/auditoria');
const sinHtml = require('./middleware/sinHtml');

const app = express();

// ── Seguridad ──────────────────────────────────────────
app.use(helmet());

// CORS: solo acepta peticiones desde localhost (frontend y otras APIs)
// CORS: solo orígenes locales autorizados (R.36): este equipo y la red privada del colegio
// (10.x, 172.16-31.x, 192.168.x). Así el sistema funciona desde cualquier computador, tablet o celular de la red
// local, pero nunca desde un sitio de internet. CORS_ORIGENES permite agregar otros (separados por coma).
const ORIGEN_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const ORIGENES_EXTRA = (process.env.CORS_ORIGENES || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origen, listo) => listo(null, !origen || ORIGEN_LOCAL.test(origen) || ORIGENES_EXTRA.includes(origen)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());
app.use(sinHtml);   // sin etiquetas HTML en los datos (XSS guardado)

// Rate limiting: 100 peticiones por minuto (según arquitectura definida)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
});
app.use(limiter);

// Auditoría: registra las escrituras exitosas en bitacora_operaciones
app.use(auditoria);

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
