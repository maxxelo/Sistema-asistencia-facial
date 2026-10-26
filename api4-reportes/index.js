const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const reportesRoutes = require('./routes/reportes');

const app = express();

app.use(helmet());
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
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
});
app.use(limiter);

app.use('/reportes', reportesRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', api: 'api4-reportes', puerto: 3004 });
});

app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error('[Error global]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`API Reportes corriendo en http://localhost:${PORT}`);
});
