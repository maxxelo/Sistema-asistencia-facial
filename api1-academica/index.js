const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes        = require('./routes/auth');
const alumnosRoutes     = require('./routes/alumno');
const cursosRoutes      = require('./routes/cursos');
const profesoresRoutes  = require('./routes/profesores');
const horariosRoutes    = require('./routes/horarios');
const usuariosRoutes    = require('./routes/usuarios');
const asignaturasRoutes = require('./routes/asignaturas');
const aulasRoutes       = require('./routes/aulas');

const app = express();

// ── Seguridad ──────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: ['http://localhost', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rate limiting: 1000 peticiones por minuto (API académica recibe más tráfico)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
});
app.use(limiter);

// ── Rutas ──────────────────────────────────────────────
app.use('/login',       authRoutes);
app.use('/alumnos',     alumnosRoutes);
app.use('/cursos',      cursosRoutes);
app.use('/profesores',  profesoresRoutes);
app.use('/horarios',    horariosRoutes);
app.use('/usuarios',    usuariosRoutes);
app.use('/asignaturas', asignaturasRoutes);
app.use('/aulas',       aulasRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', api: 'api1-academica', puerto: 3001 });
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
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API Académica corriendo en http://localhost:${PORT}`);
});
