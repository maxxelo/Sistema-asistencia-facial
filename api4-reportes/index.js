const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const reportesRoutes = require('./routes/reportes');

const app = express();

app.use(helmet());
app.use(cors({
  origin: ['http://localhost', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
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
