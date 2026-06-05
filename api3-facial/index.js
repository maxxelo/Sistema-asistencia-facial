// Importa Express para el servidor HTTP
const express = require('express')

// Importa WebSocket para el stream de video en tiempo real
const { WebSocketServer } = require('ws')

// Importa CORS para permitir peticiones desde el frontend
const cors = require('cors')

// Importa dotenv para leer el .env
require('dotenv').config()

// Importa la función de reconocimiento facial
const { buscarAlumno } = require('./routes/reconocimiento')

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

      // Verifica que llegó un descriptor facial
      if (!datos.descriptor) {
        ws.send(JSON.stringify({
          exito: false,
          mensaje: 'No se recibió descriptor facial'
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

      // Si se reconoció al alumno — responde con sus datos
      ws.send(JSON.stringify({
        exito: true,
        mensaje: 'Alumno identificado',
        alumno: {
          id: alumno.id_alumno,
          nombre: alumno.nombre,
          apellido: alumno.apellido_paterno,
          rut: alumno.rut,
          confianza: (1 - alumno.distancia).toFixed(2)
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