// Servidor de reconocimiento facial: HTTP (registro de rostros) + WebSocket (reconocimiento)
const express   = require('express')
const { WebSocketServer } = require('ws')
const helmet    = require('helmet')
const cors      = require('cors')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

// http para llamar a API 2 internamente; jwt para el token de servicio y la auth del WS
const http = require('http')
const jwt  = require('jsonwebtoken')

const { verificarToken, adminOProfesor } = require('./middleware/auth')
const { buscarAlumno, registrarRostro, registrarIntento } = require('./routes/reconocimiento')

// ── Llama a API 2 para registrar la asistencia ─────────
// Se ejecuta después de reconocer exitosamente a un alumno.
// Si API 2 rechaza la marca (alumno de otro curso, fecha que no
// coincide con el día de la clase, etc.) rechaza con ese mensaje.
function registrarAsistenciaEnAPI2(id_alumno, id_horario, fecha, confianza) {
  return new Promise((resolve, reject) => {
    // Token de servicio de corta duración, con claim que identifica a esta API
    const token = jwt.sign(
      { id: 0, tipo_persona: 'admin', servicio: 'api3', nombre_usuario: 'api3-servicio' },
      process.env.JWT_SECRET,
      { expiresIn: '1m' }
    )

    const body = JSON.stringify({ id_alumno, id_horario, fecha, confianza })

    const opciones = {
      hostname: process.env.API2_HOST || 'api2',   // nombre del contenedor en la red Docker
      port: 3002,
      path: '/asistencia/marcar-facial',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${token}`
      }
    }

    const req = http.request(opciones, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        let json = {}
        try { json = JSON.parse(data) } catch { /* respuesta no-JSON */ }
        if (res.statusCode >= 400) {
          const err = new Error(json.error || `API 2 respondió ${res.statusCode}`)
          err.statusCode = res.statusCode
          return reject(err)
        }
        resolve(json)
      })
    })

    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('Timeout al llamar a API 2')))
    req.write(body)
    req.end()
  })
}

// ── Aplicación Express ──────────────────────────────────
const app = express()

// Seguridad: misma capa que las demás APIs
app.use(helmet())
app.use(cors({
  origin: ['http://localhost', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
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
// Auth: JWT (Admin o Profesor)
// =====================================================
app.post('/rostros', verificarToken, adminOProfesor, async (req, res) => {
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
    res.status(400).json({ error: err.message })
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
const COOLDOWN_MS = 60 * 1000
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

      // Buscar al alumno comparando contra los rostros registrados
      const { alumno, distancia } = await buscarAlumno(datos.descriptor)
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

      // Si ya se marcó hace menos de 60 s, no repetir la llamada a API 2
      const claveCooldown = `${alumno.id_alumno}|${datos.id_horario}|${datos.fecha}`
      if (enCooldown(claveCooldown)) {
        ws.send(JSON.stringify({
          exito: true,
          ya_registrado: true,
          mensaje: 'Asistencia ya registrada',
          alumno: datosAlumno
        }))
        return
      }

      // Llamar a API 2 para registrar la asistencia en la BD
      try {
        await registrarAsistenciaEnAPI2(alumno.id_alumno, datos.id_horario, datos.fecha, confianza)
        ultimasMarcas.set(claveCooldown, Date.now())
        ws.send(JSON.stringify({
          exito: true,
          mensaje: 'Alumno identificado y asistencia registrada',
          alumno: datosAlumno
        }))
      } catch (errAPI2) {
        console.error('[API3] API 2 rechazó la marca:', errAPI2.message)
        // Rechazos de validación (alumno de otro curso, día incorrecto...) también
        // entran en cooldown para no insistir cada 2 segundos con el mismo alumno
        if (errAPI2.statusCode && errAPI2.statusCode < 500) {
          ultimasMarcas.set(claveCooldown, Date.now())
        }
        ws.send(JSON.stringify({
          exito: false,
          reconocido: true,
          mensaje: errAPI2.message,
          alumno: datosAlumno
        }))
      }

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
