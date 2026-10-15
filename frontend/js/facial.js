/* ════════════════════════════════════════════════════════════════
   FACIAL.JS — Cámara, Face-api.js y reconocimiento por WebSocket
════════════════════════════════════════════════════════════════ */
const OPCIONES_DETECTOR = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })

let ws = null, intervaloReconocimiento = null, intervaloPreview = null
let modoIP = false

/* ── CÁMARA ────────────────────────────────────────────────────── */
function cambiarModo(modo) {
  modoIP = (modo === 'ip')
  document.getElementById('config-ip').style.display = modoIP ? 'block' : 'none'
  detenerPreview()
}

async function conectarIP() {
  const url = getUrlIP()
  if (!url) return alert('Ingresa la URL de IP Webcam')
  if (!faceapi.nets.tinyFaceDetector.isLoaded) await cargarModelos()
  iniciarPreviewIP(url)
}

function getUrlIP() {
  return document.getElementById('urlIP').value.trim().replace(/\/$/, '')
}

async function cargarModelos() {
  const RUTA = './assets/models'
  await faceapi.nets.tinyFaceDetector.loadFromUri(RUTA)
  await faceapi.nets.faceLandmark68Net.loadFromUri(RUTA)
  await faceapi.nets.faceRecognitionNet.loadFromUri(RUTA)
}

async function activarWebcam() {
  const video = document.getElementById('video')
  if (video.srcObject) return
  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
  video.srcObject = stream
  iniciarPreviewWebcam()
}

function iniciarPreviewWebcam() {
  detenerPreview()
  const video = document.getElementById('video'), canvas = document.getElementById('canvas')
  intervaloPreview = setInterval(async () => {
    if (video.readyState < 2) return
    const det = await faceapi.detectAllFaces(video, OPCIONES_DETECTOR).withFaceLandmarks()
    faceapi.matchDimensions(canvas, { width: video.videoWidth, height: video.videoHeight })
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    faceapi.draw.drawDetections(canvas, faceapi.resizeResults(det, { width: video.videoWidth, height: video.videoHeight }))
  }, 300)
}

function iniciarPreviewIP(url) {
  detenerPreview()
  const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d')
  intervaloPreview = setInterval(async () => {
    try {
      const img = await cargarSnapshot(url)
      canvas.width = 560; canvas.height = 420
      ctx.drawImage(img, 0, 0, 560, 420)
      const det = await faceapi.detectAllFaces(canvas, OPCIONES_DETECTOR).withFaceLandmarks()
      faceapi.draw.drawDetections(canvas, det)
      document.getElementById('estadoCamara').innerHTML =
        det.length > 0 ? '✅ Rostro detectado' : '🔍 Buscando rostro...'
    } catch (err) { console.warn(err.message) }
  }, 500)
}

function detenerPreview() {
  if (intervaloPreview) { clearInterval(intervaloPreview); intervaloPreview = null }
}

function cargarSnapshot(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar snapshot'))
    img.src = `${url}/shot.jpg?t=${Date.now()}`
    setTimeout(() => reject(new Error('Timeout')), 5000)
  })
}

async function getFrame() {
  return modoIP ? await cargarSnapshot(getUrlIP()) : document.getElementById('video')
}

/* ── REGISTRAR ROSTRO ──────────────────────────────────────────── */
// Toma 3 capturas seguidas (≈0.7 s entre cada una) para que el
// reconocimiento sea robusto ante cambios de luz y ángulo.
async function registrarRostro() {
  const idAlumno = document.getElementById('idAlumno').value
  const divReg   = document.getElementById('resultadoRegistro')
  if (!idAlumno) { divReg.innerHTML = '⚠️ Ingresa el ID del alumno'; return }
  divReg.innerHTML = 'Cargando modelos...'
  if (!faceapi.nets.tinyFaceDetector.isLoaded) await cargarModelos()
  if (!modoIP) await activarWebcam()

  const TOTAL_CAPTURAS = 3
  const descriptores = []
  for (let i = 0; i < TOTAL_CAPTURAS; i++) {
    divReg.innerHTML = `📸 Captura ${i + 1} de ${TOTAL_CAPTURAS}... mira a la cámara`
    let elemento
    try { elemento = await getFrame() }
    catch (err) { divReg.innerHTML = `❌ Error cámara: ${err.message}`; return }
    const deteccion = await faceapi.detectSingleFace(elemento, OPCIONES_DETECTOR)
      .withFaceLandmarks().withFaceDescriptor()
    if (deteccion) descriptores.push(Array.from(deteccion.descriptor))
    if (i < TOTAL_CAPTURAS - 1) await new Promise(r => setTimeout(r, 700))
  }

  if (!descriptores.length) {
    divReg.innerHTML = '❌ No se detectó ningún rostro. Acércate a la cámara e intenta de nuevo.'
    return
  }

  divReg.innerHTML = `Guardando ${descriptores.length} captura(s)...`
  try {
    const r = await fetch(`${API3}/rostros`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ id_alumno: parseInt(idAlumno), descriptores })
    })
    const d = await r.json()
    divReg.innerHTML = r.ok ? `<span class="mensaje-ok">✅ ${d.mensaje}</span>`
                             : `<span class="mensaje-err">❌ ${d.error}</span>`
    if (r.ok) {
      _alumnoTieneRostro[parseInt(idAlumno)] = true
      await cargarSelectAlumnos()
      const sel = document.getElementById('selectAlumnoRostro')
      if (sel) { sel.value = idAlumno; seleccionarAlumnoRostro(sel) }
      if (typeof tabActual !== 'undefined' && tabActual === 'alumnos') cargarTablaAlumnos()
    }
  } catch (err) { divReg.innerHTML = `❌ Error de red: ${err.message}` }
}

/* ── WEBSOCKET ─────────────────────────────────────────────────── */
function conectarWebSocket() {
  // La API 3 exige el JWT de la sesión para aceptar la conexión
  ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token || '')}`)
  ws.onopen  = () => console.log('WebSocket conectado')
  ws.onerror = (e) => console.error('WS error', e)
  ws.onclose = (e) => {
    if (e.code === 4401) {
      document.getElementById('resultado').innerHTML =
        '<span class="mensaje-err">❌ Sesión no autorizada. Vuelve a iniciar sesión.</span>'
      detener()
    }
  }
  ws.onmessage = (evento) => {
    const r   = JSON.parse(evento.data)
    const div = document.getElementById('resultado')
    if (r.exito && r.alumno) {
      const conf = r.alumno.confianza ? ` — ${Math.round(r.alumno.confianza * 100)}%` : ''
      div.innerHTML = `📸 <strong>${r.alumno.nombre} ${r.alumno.apellido}</strong>${conf}`
      if (!r.ya_enviado && typeof marcarPresente === 'function') {
        marcarPresente(r.alumno.id, 'facial')
      }
    } else {
      div.innerHTML = r.mensaje === 'Rostro no reconocido'
        ? '🔍 Buscando...'
        : `<span class="mensaje-err">⚠️ ${r.mensaje || 'Sin resultado'}</span>`
    }
  }
}

/* ── RECONOCIMIENTO ────────────────────────────────────────────── */
async function enviarFrame() {
  const id_horario = parseInt(document.getElementById('selectorHorario').value)
  const fecha      = document.getElementById('fechaClase').value
  if (!id_horario || !fecha) {
    document.getElementById('resultado').innerHTML = '⚠️ Selecciona la clase activa'
    return
  }
  try {
    const elemento  = await getFrame()
    const deteccion = await faceapi.detectSingleFace(elemento, OPCIONES_DETECTOR)
      .withFaceLandmarks().withFaceDescriptor()
    if (!deteccion) { document.getElementById('resultado').innerHTML = '🔍 Buscando rostro...'; return }
    const descriptor = Array.from(deteccion.descriptor)
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ descriptor, id_horario, fecha }))
  } catch (err) {
    document.getElementById('resultado').innerHTML = `❌ Error cámara: ${err.message}`
  }
}

function detener() {
  detenerPreview()
  if (intervaloReconocimiento) { clearInterval(intervaloReconocimiento); intervaloReconocimiento = null }
  if (ws) { ws.close(); ws = null }
  const res = document.getElementById('resultado')
  if (res) res.innerHTML = 'Reconocimiento detenido.'
  const btnIni = document.getElementById('btn-iniciar-rec')
  const btnDet = document.getElementById('btn-detener-rec')
  if (btnIni && typeof _asistenciaGuardada !== 'undefined' && !_asistenciaGuardada) btnIni.disabled = false
  if (btnDet) btnDet.style.display = 'none'
}

async function iniciar() {
  const id_horario = document.getElementById('selectorHorario').value
  const fecha      = document.getElementById('fechaClase').value
  if (!id_horario || !fecha) { alert('Selecciona la clase activa primero'); return }
  const res = document.getElementById('resultado')
  if (res) res.innerHTML = 'Cargando modelos...'
  if (!faceapi.nets.tinyFaceDetector.isLoaded) await cargarModelos()
  if (!modoIP) await activarWebcam()
  conectarWebSocket()
  if (intervaloReconocimiento) clearInterval(intervaloReconocimiento)
  intervaloReconocimiento = setInterval(enviarFrame, 2000)
  if (res) res.innerHTML = '🔍 Buscando rostros...'
  const btnIni = document.getElementById('btn-iniciar-rec')
  const btnDet = document.getElementById('btn-detener-rec')
  if (btnIni) btnIni.disabled = true
  if (btnDet) btnDet.style.display = 'inline-block'
}
