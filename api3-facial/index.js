// Servidor de reconocimiento facial: HTTP (registro de rostros) + WebSocket (reconocimiento)
const express   = require('express')
const { WebSocketServer } = require('ws')
const helmet    = require('helmet')
const cors      = require('cors')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const jwt  = require('jsonwebtoken')

const { verificarToken, adminOProfesor, soloAdmin } = require('./middleware/auth')
const { buscarAlumno, registrarRostro, registrarIntento } = require('./routes/reconocimiento')
const pool = require('./db/connection')

// ── Aplicación Express ──────────────────────────────────
const app = express()

// Seguridad: misma capa que las demás APIs
app.use(helmet())
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
app.use(express.json({ limit: '1mb' }))   // hasta 5 descriptores por registro

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta en un minuto' }
})
app.use(limiter)

const PORT = process.env.PORT || 3003

// Health check
app.get('/health', (req, res) => {
  res.json({ mensaje: 'API Facial funcionando', puerto: PORT })
})

// =====================================================
// POST /rostros
// Registra el rostro de un alumno (1 a 5 capturas)
// Body: { id_alumno, descriptor: [128 floats] }
//   o   { id_alumno, descriptores: [[128 floats], ...] }
// Auth: JWT (solo Admin)
// =====================================================
app.post('/rostros', verificarToken, soloAdmin, async (req, res) => {
  const { id_alumno, descriptor, descriptores } = req.body

  // Acepta el formato nuevo (varias capturas) y el antiguo (una sola)
  const lista = Array.isArray(descriptores) && descriptores.length
    ? descriptores
    : (Array.isArray(descriptor) ? [descriptor] : null)

  if (!id_alumno || !lista) {
    return res.status(400).json({ error: 'Se requiere id_alumno y descriptor(es)' })
  }

  try {
    const capturas = await registrarRostro(parseInt(id_alumno), lista)
    res.json({
      ok: true,
      mensaje: `Rostro registrado correctamente (${capturas} captura${capturas > 1 ? 's' : ''})`
    })
  } catch (err) {
    // 403: la solicitud es válida pero falta el consentimiento del apoderado
    res.status(err.codigo === 'SIN_CONSENTIMIENTO' ? 403 : 400).json({ error: err.message })
  }
})

// GET /rostros/:id_alumno — consultar si un alumno tiene rostro registrado (admin)
app.get('/rostros/:id_alumno', verificarToken, soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id_alumno)
  if (isNaN(id)) return res.status(400).json({ error: 'id_alumno inválido' })
  try {
    const r = await pool.query(
      'SELECT id, id_alumno, fecha_captura, activo FROM rostros WHERE id_alumno = $1 AND activo = TRUE',
      [id]
    )
    if (!r.rows.length) return res.status(404).json({ tiene_rostro: false })
    res.json({ tiene_rostro: true, fecha_captura: r.rows[0].fecha_captura })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /rostros/:id_alumno — eliminar rostro de un alumno (solo admin)
app.delete('/rostros/:id_alumno', verificarToken, soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id_alumno)
  if (isNaN(id)) return res.status(400).json({ error: 'id_alumno inválido' })
  try {
    const r = await pool.query(
      'UPDATE rostros SET activo = FALSE WHERE id_alumno = $1 AND activo = TRUE RETURNING id',
      [id]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'No se encontró rostro activo para este alumno' })
    res.json({ ok: true, mensaje: 'Rostro eliminado correctamente' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` })
})

// Arranca el servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`API Facial corriendo en puerto ${PORT}`)
})

// ── WebSocket de reconocimiento ─────────────────────────
const wss = new WebSocketServer({ server })

// Cooldown: una vez marcado un alumno en una clase, se ignoran
// nuevas detecciones suyas por 60 s (evita llamadas y logs repetidos
// mientras sigue frente a la cámara).
const COOLDOWN_MS = 5 * 1000
const ultimasMarcas = new Map()   // clave "alumno|horario|fecha" → timestamp

function enCooldown(clave) {
  const ts = ultimasMarcas.get(clave)
  return ts !== undefined && (Date.now() - ts) < COOLDOWN_MS
}

// Limpieza periódica del mapa para que no crezca sin límite
setInterval(() => {
  const ahora = Date.now()
  for (const [clave, ts] of ultimasMarcas) {
    if (ahora - ts > COOLDOWN_MS) ultimasMarcas.delete(clave)
  }
}, 5 * 60 * 1000)

wss.on('connection', (ws, req) => {
  // El cliente debe conectarse con su JWT: ws://host:3003?token=...
  let usuario = null
  try {
    const url   = new URL(req.url, 'http://localhost')
    const token = url.searchParams.get('token') || ''
    usuario = jwt.verify(token, process.env.JWT_SECRET)
  } catch { /* token ausente o inválido */ }

  if (!usuario || !['admin', 'profesor'].includes(usuario.tipo_persona)) {
    ws.send(JSON.stringify({ exito: false, mensaje: 'No autorizado: inicia sesión nuevamente' }))
    ws.close(4401, 'No autorizado')
    return
  }

  console.log(`Cliente WebSocket conectado: ${usuario.nombre_usuario || usuario.id}`)

  // Datos de la clase que se está pasando (se consultan una vez por horario)
  const clases = new Map()
  async function datosClase(idHorario) {
    if (!clases.has(idHorario)) {
      const r = await pool.query('SELECT id_curso, id_profesor FROM horarios WHERE id = $1', [idHorario])
      clases.set(idHorario, r.rows[0] || null)
    }
    return clases.get(idHorario)
  }

  ws.on('message', async (mensaje) => {
    try {
      const datos = JSON.parse(mensaje)

      // descriptor: vector facial capturado | id_horario: clase activa | fecha: YYYY-MM-DD
      if (!datos.descriptor || !datos.id_horario || !datos.fecha) {
        ws.send(JSON.stringify({
          exito: false,
          mensaje: 'Se requiere descriptor, id_horario y fecha'
        }))
        return
      }

      if (!Array.isArray(datos.descriptor) || datos.descriptor.length !== 128) {
        ws.send(JSON.stringify({ exito: false, mensaje: 'Descriptor facial inválido' }))
        return
      }
      const clase = await datosClase(parseInt(datos.id_horario))
      if (!clase) {
        ws.send(JSON.stringify({ exito: false, mensaje: 'La clase seleccionada no existe' }))
        return
      }
      // Un profesor solo reconoce en sus propias clases
      if (usuario.tipo_persona !== 'admin' && clase.id_profesor !== usuario.id_profesor) {
        ws.send(JSON.stringify({ exito: false, mensaje: 'Esta clase no está asignada a tu perfil de profesor' }))
        return
      }

      // Buscar al alumno solo entre los rostros del curso de la clase
      const { alumno, distancia } = await buscarAlumno(datos.descriptor, clase.id_curso)
      const confianza = distancia !== null ? parseFloat((1 - distancia).toFixed(2)) : null

      if (!alumno) {
        // Registrar el fallo para depuración (tabla intentos_reconocimiento)
        registrarIntento(null, false, confianza)
        ws.send(JSON.stringify({ exito: false, mensaje: 'Rostro no reconocido' }))
        return
      }

      // Reconocido — registrar el éxito técnico
      registrarIntento(alumno.id_alumno, true, confianza)

      const datosAlumno = {
        id:        alumno.id_alumno,
        nombre:    alumno.nombre,
        apellido:  alumno.apellido_paterno,
        rut:       alumno.rut,
        confianza
      }

      // Cooldown de 5 s: evita enviar el mismo alumno repetidamente al frontend
      const claveCooldown = `${alumno.id_alumno}|${datos.id_horario}|${datos.fecha}`
      if (enCooldown(claveCooldown)) {
        ws.send(JSON.stringify({
          exito: true,
          ya_enviado: true,
          alumno: datosAlumno
        }))
        return
      }

      ultimasMarcas.set(claveCooldown, Date.now())
      ws.send(JSON.stringify({
        exito: true,
        mensaje: 'Alumno identificado',
        alumno: datosAlumno
      }))

    } catch (error) {
      console.error('Error procesando mensaje:', error)
      ws.send(JSON.stringify({
        exito: false,
        mensaje: 'Error interno del servidor'
      }))
    }
  })

  ws.on('close', () => {
    console.log('Cliente desconectado')
  })
})
