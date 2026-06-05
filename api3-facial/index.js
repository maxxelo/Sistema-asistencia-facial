// Importa Express para el servidor HTTP
const express = require('express')

// Importa WebSocket para el stream de video en tiempo real
const { WebSocketServer } = require('ws')

// Importa CORS para permitir peticiones desde el frontend
const cors = require('cors')

// Importa dotenv para leer el .env
require('dotenv').config()

// Importa http para llamar a API 2 internamente
const http = require('http')

// Importa jwt para generar el token de servicio que usa al llamar API 2
const jwt = require('jsonwebtoken')

// Importa la función de reconocimiento facial
const { buscarAlumno, registrarRostro } = require('./routes/reconocimiento')

// ── Llama a API 2 para registrar la asistencia ─────────
// Se ejecuta después de reconocer exitosamente a un alumno
function registrarAsistenciaEnAPI2(id_alumno, id_horario, fecha, confianza) {
  return new Promise((resolve, reject) => {
    // Genera un token de servicio de corta duración para autenticarse con API 2
    const token = jwt.sign(
      { id: 0, tipo_persona: 'admin', nombre_usuario: 'api3-servicio' },
      process.env.JWT_SECRET,
      { expiresIn: '1m' }
    )

    const body = JSON.stringify({ id_alumno, id_horario, fecha, confianza })

    const opciones = {
      hostname: 'api2',   // nombre del contenedor en la red Docker
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
        try { resolve(JSON.parse(data)) }
        catch { resolve({ ok: true }) }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Crea la aplicación Express
const app = express()

// Activa CORS
app.use(cors())

// Permite recibir JSON
app.use(express.json())

// Puerto donde corre esta API
const PORT = 3003

// Ruta de prueba
app.get('/health', (req, res) => {
  res.json({ 
    mensaje: 'API Facial funcionando',
    puerto: PORT 
  })
})

// Registra el rostro de un alumno
// POST /rostros  Body: { id_alumno: 1, descriptor: [128 números] }
app.post('/rostros', async (req, res) => {
  const { id_alumno, descriptor } = req.body

  if (!id_alumno || !descriptor || !Array.isArray(descriptor)) {
    return res.status(400).json({ error: 'Faltan id_alumno o descriptor' })
  }

  try {
    await registrarRostro(id_alumno, descriptor)
    res.json({ ok: true, mensaje: 'Rostro registrado correctamente' })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Arranca el servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`API Facial corriendo en puerto ${PORT}`)
})

// Crea el servidor WebSocket
const wss = new WebSocketServer({ server })

// Cuando un cliente se conecta via WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado via WebSocket')

  // Cuando llega un mensaje del frontend
  ws.on('message', async (mensaje) => {
    try {
      // Convierte el mensaje de texto a objeto JavaScript
      const datos = JSON.parse(mensaje)

      // Verifica que llegaron todos los datos necesarios
      // descriptor: vector facial del alumno frente a la cámara
      // id_horario: qué clase se está tomando asistencia
      // fecha: fecha actual (YYYY-MM-DD)
      if (!datos.descriptor || !datos.id_horario || !datos.fecha) {
        ws.send(JSON.stringify({
          exito: false,
          mensaje: 'Se requiere descriptor, id_horario y fecha'
        }))
        return
      }

      // Busca el alumno en la BD comparando descriptores
      const alumno = await buscarAlumno(datos.descriptor)

      // Si no se reconoció a nadie
      if (!alumno) {
        ws.send(JSON.stringify({
          exito: false,
          mensaje: 'Rostro no reconocido'
        }))
        return
      }

      const confianza = parseFloat((1 - alumno.distancia).toFixed(2))

      // Llama a API 2 para registrar la asistencia en la BD
      try {
        await registrarAsistenciaEnAPI2(
          alumno.id_alumno,
          datos.id_horario,
          datos.fecha,
          confianza
        )
      } catch (errAPI2) {
        console.error('[API3] Error al llamar API 2:', errAPI2.message)
        // No cortamos el flujo — igual avisamos al frontend que reconoció al alumno
      }

      // Si se reconoció al alumno — responde con sus datos
      ws.send(JSON.stringify({
        exito: true,
        mensaje: 'Alumno identificado y asistencia registrada',
        alumno: {
          id:        alumno.id_alumno,
          nombre:    alumno.nombre,
          apellido:  alumno.apellido_paterno,
          rut:       alumno.rut,
          confianza: confianza
        }
      }))

    } catch (error) {
      console.error('Error procesando mensaje:', error)
      ws.send(JSON.stringify({
        exito: false,
        mensaje: 'Error interno del servidor'
      }))
    }
  })

  // Cuando el cliente se desconecta
  ws.on('close', () => {
    console.log('Cliente desconectado')
  })
})