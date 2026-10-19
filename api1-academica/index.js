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
const usuariosRoutes     = require('./routes/usuarios');
const asignaturasRoutes  = require('./routes/asignaturas');
const aulasRoutes        = require('./routes/aulas');
const periodosRoutes     = require('./routes/periodos');
const feriadosRoutes     = require('./routes/feriados');
const evaluacionesRoutes = require('./routes/evaluaciones');
const apoderadosRoutes   = require('./routes/apoderados');
const fichaMedicaRoutes  = require('./routes/ficha_medica');
const comunicadosRoutes  = require('./routes/comunicados');
const parametrosRoutes   = require('./routes/parametros');
const bitacoraRoutes     = require('./routes/bitacora');
const notificacionesRoutes = require('./routes/notificaciones');
const auditoria          = require('./middleware/auditoria');
const sinHtml = require('./middleware/sinHtml');

const app = express();

// ── Seguridad ──────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: ['http://localhost', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(sinHtml);   // sin etiquetas HTML en los datos (XSS guardado)

// Rate limiting: 1000 peticiones por minuto (API académica recibe más tráfico)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
});
app.use(limiter);

// Fuerza bruta: 10 intentos fallidos por usuario y equipo cada 15 minutos.
// Los ingresos correctos no cuentan.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.nombre_usuario || '').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.' }
});

// Auditoría: registra toda escritura exitosa en bitacora_operaciones
app.use(auditoria);

// ── Rutas ──────────────────────────────────────────────
app.use('/login',       limiteLogin, authRoutes);
app.use('/alumnos',     alumnosRoutes);
app.use('/cursos',      cursosRoutes);
app.use('/profesores',  profesoresRoutes);
app.use('/horarios',    horariosRoutes);
app.use('/usuarios',     usuariosRoutes);
app.use('/asignaturas',  asignaturasRoutes);
app.use('/aulas',        aulasRoutes);
app.use('/periodos',     periodosRoutes);
app.use('/feriados',     feriadosRoutes);
app.use('/evaluaciones', evaluacionesRoutes);
app.use('/apoderados',   apoderadosRoutes);
app.use('/ficha-medica', fichaMedicaRoutes);
app.use('/comunicados',  comunicadosRoutes);
app.use('/parametros',   parametrosRoutes);
app.use('/bitacora',     bitacoraRoutes);
app.use('/notificaciones', notificacionesRoutes);

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
