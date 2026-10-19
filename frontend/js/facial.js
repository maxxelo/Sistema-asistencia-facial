/* ════════════════════════════════════════════════════════════════
   FACIAL.JS — Cámara, Face-api.js y reconocimiento por WebSocket
════════════════════════════════════════════════════════════════ */
const OPCIONES_DETECTOR = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })

let ws = null, intervaloReconocimiento = null, intervaloPreview = null
let modoIP = false

/* ── VISOR: estados, recuadros y tarjeta de reconocido ─────────── */
// Estados del visor (atributo data-estado de #as-visor, los pinta css/sicaf-tema.css):
//   apagada · buscando · detectado · capturando · reconocido · desconocido
let _retencionVisor = null      // mientras se muestra un reconocido, la vista previa no cambia el estado
let _timerDesconocido = null

function _estadoVisor(estado, texto) {
  const visor = document.getElementById('as-visor')
  if (!visor) return
  const fuerte = ['apagada', 'reconocido', 'capturando'].includes(estado)
  if (_retencionVisor && !fuerte) return
  visor.dataset.estado = estado
  const chip = document.getElementById('as-chip-txt')
  if (chip && texto) chip.textContent = texto
}

function _textoEnVivo(hayRostro) {
  if (intervaloReconocimiento) return hayRostro ? 'En vivo · rostro detectado' : 'En vivo · buscando rostros'
  return hayRostro ? 'Rostro detectado' : 'Cámara activa'
}

// La webcam se muestra en espejo, como un espejo real; la cámara del celular no
function _espejo(activo) {
  const c = document.getElementById('contenedor-camara')
  if (c) c.classList.toggle('espejo', !!activo)
}

// Recuadro propio sobre cada rostro: esquinas redondeadas, sin los números de face-api
function _dibujarRostros(canvas, detecciones, limpiar = true) {
  const ctx = canvas.getContext('2d')
  if (limpiar) ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#b794ff'
  ctx.lineWidth = Math.max(3, canvas.width / 170)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(59,26,94,.55)'; ctx.shadowBlur = 6
  detecciones.forEach(d => {
    const b = (d.detection || d).box
    const l = Math.min(b.width, b.height) * 0.24
    ;[[b.x, b.y, 1, 1], [b.x + b.width, b.y, -1, 1], [b.x, b.y + b.height, 1, -1], [b.x + b.width, b.y + b.height, -1, -1]]
      .forEach(([x, y, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(x, y + sy * l); ctx.lineTo(x, y); ctx.lineTo(x + sx * l, y); ctx.stroke()
      })
  })
  ctx.shadowBlur = 0
}

function _destello() {
  const v = document.getElementById('as-visor')
  if (!v) return
  v.classList.remove('destello'); void v.offsetWidth; v.classList.add('destello')
}

// Tarjeta grande con el alumno reconocido (se muestra unos segundos sobre la imagen)
function _mostrarReconocido(alumno, yaPresente) {
  const tarjeta = document.getElementById('as-tarjeta')
  const visor   = document.getElementById('as-visor')
  if (!tarjeta || !visor) return
  const esc   = typeof _escHtml === 'function' ? _escHtml : (t => String(t ?? ''))
  const nom   = `${alumno.nombre || ''} ${alumno.apellido || ''}`.trim()
  const ini   = ((alumno.nombre || '?')[0] + (alumno.apellido || '')[0] || '').toUpperCase()
  const hora  = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
  const conf  = alumno.confianza ? ` · ${Math.round(alumno.confianza * 100)} % de coincidencia` : ''
  tarjeta.innerHTML = `
    <span class="as-t-ava" aria-hidden="true">${esc(ini)}</span>
    <div class="as-t-txt"><b>${esc(nom)}</b><span>${yaPresente ? 'Ya estaba presente' : 'Presente'} · ${hora}${conf}</span></div>
    <i class="im im-ok as-t-ok" aria-hidden="true"></i>`
  tarjeta.classList.remove('visible'); void tarjeta.offsetWidth; tarjeta.classList.add('visible')
  clearTimeout(_retencionVisor)
  visor.dataset.estado = 'reconocido'
  const chip = document.getElementById('as-chip-txt')
  if (chip) chip.textContent = 'Alumno reconocido'
  _retencionVisor = setTimeout(() => {
    _retencionVisor = null
    tarjeta.classList.remove('visible')
    _estadoVisor(intervaloReconocimiento ? 'buscando' : 'apagada', intervaloReconocimiento ? _textoEnVivo(false) : 'Cámara apagada')
  }, 3200)
}

// Rostro visible pero no registrado: aviso breve, el docente puede marcarlo a mano
function _avisoDesconocido() {
  if (_retencionVisor) return
  _estadoVisor('desconocido', 'Rostro no reconocido')
  clearTimeout(_timerDesconocido)
  _timerDesconocido = setTimeout(() => _estadoVisor('buscando', _textoEnVivo(false)), 1800)
}

/* ── CÁMARA ────────────────────────────────────────────────────── */
function cambiarModo(modo) {
  modoIP = (modo === 'ip')
  document.getElementById('config-ip').style.display = modoIP ? 'block' : 'none'
  detener()
}

async function conectarIP() {
  const url = getUrlIP()
  if (!url) return sicafAviso('Ingresa la URL de IP Webcam', 'aviso')
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
  _espejo(true)
  _estadoVisor('buscando', _textoEnVivo(false))
  iniciarPreviewWebcam()
}

function iniciarPreviewWebcam() {
  detenerPreview()
  const video = document.getElementById('video'), canvas = document.getElementById('canvas')
  intervaloPreview = setInterval(async () => {
    if (video.readyState < 2) return
    const det = await faceapi.detectAllFaces(video, OPCIONES_DETECTOR).withFaceLandmarks()
    faceapi.matchDimensions(canvas, { width: video.videoWidth, height: video.videoHeight })
    _dibujarRostros(canvas, faceapi.resizeResults(det, { width: video.videoWidth, height: video.videoHeight }))
    _estadoVisor(det.length ? 'detectado' : 'buscando', _textoEnVivo(det.length > 0))
  }, 300)
}

function iniciarPreviewIP(url) {
  detenerPreview()
  _espejo(false)
  const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d')
  intervaloPreview = setInterval(async () => {
    try {
      const img = await cargarSnapshot(url)
      canvas.width = 560; canvas.height = 420
      ctx.drawImage(img, 0, 0, 560, 420)
      const det = await faceapi.detectAllFaces(canvas, OPCIONES_DETECTOR).withFaceLandmarks()
      _dibujarRostros(canvas, det, false)          // sobre la imagen recién dibujada
      _estadoVisor(det.length ? 'detectado' : 'buscando', _textoEnVivo(det.length > 0))
      document.getElementById('estadoCamara').innerHTML =
        det.length > 0 ? '<i class="im im-ok" aria-hidden="true"></i> Rostro detectado' : '<i class="im im-lupa" aria-hidden="true"></i> Buscando rostro...'
    } catch (err) { console.warn(err.message) }
  }, 500)
}

function detenerPreview() {
  if (intervaloPreview) { clearInterval(intervaloPreview); intervaloPreview = null }
}

// Libera la cámara: detener los tracks es lo que apaga la luz de la webcam.
// Solo limpiar intervalos o el WebSocket NO suelta el dispositivo.
function apagarWebcam() {
  const video = document.getElementById('video')
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop())
    video.srcObject = null
  }
  const canvas = document.getElementById('canvas')
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  clearTimeout(_retencionVisor); _retencionVisor = null
  document.getElementById('as-tarjeta')?.classList.remove('visible')
  _estadoVisor('apagada', 'Cámara apagada')
}

// El navegador también la libera al cerrar la pestaña, pero así queda explícito
window.addEventListener('pagehide', apagarWebcam)

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
  if (!idAlumno) { divReg.innerHTML = '<i class="im im-alerta" aria-hidden="true"></i> Ingresa el ID del alumno'; return }
  try { await _registrarRostro(idAlumno, divReg) }
  finally {
    // La cámara se prendió solo para las capturas: apagarla si no se está pasando asistencia
    if (!intervaloReconocimiento) { detenerPreview(); apagarWebcam() }
  }
}

async function _registrarRostro(idAlumno, divReg) {
  divReg.innerHTML = 'Cargando modelos...'
  if (!faceapi.nets.tinyFaceDetector.isLoaded) await cargarModelos()
  if (!modoIP) await activarWebcam()

  const TOTAL_CAPTURAS = 3
  const descriptores = []
  for (let i = 0; i < TOTAL_CAPTURAS; i++) {
    divReg.innerHTML = `<i class="im im-camara" aria-hidden="true"></i> Captura ${i + 1} de ${TOTAL_CAPTURAS}... mira a la cámara`
    _estadoVisor('capturando', `Captura ${i + 1} de ${TOTAL_CAPTURAS} · mira a la cámara`)
    let elemento
    try { elemento = await getFrame(); _destello() }
    catch (err) { divReg.innerHTML = `<i class="im im-error" aria-hidden="true"></i> Error cámara: ${err.message}`; return }
    const deteccion = await faceapi.detectSingleFace(elemento, OPCIONES_DETECTOR)
      .withFaceLandmarks().withFaceDescriptor()
    if (deteccion) descriptores.push(Array.from(deteccion.descriptor))
    if (i < TOTAL_CAPTURAS - 1) await new Promise(r => setTimeout(r, 700))
  }

  if (!descriptores.length) {
    divReg.innerHTML = '<i class="im im-error" aria-hidden="true"></i> No se detectó ningún rostro. Acércate a la cámara e intenta de nuevo.'
    return
  }

  divReg.innerHTML = `Guardando ${descriptores.length} captura(s)...`
  try {
    const r = await fetch(`${API3}/rostros`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ id_alumno: parseInt(idAlumno), descriptores })
    })
    const d = await r.json()
    divReg.innerHTML = r.ok ? `<span class="mensaje-ok">${d.mensaje}</span>`
                             : `<span class="mensaje-err">${d.error}</span>`
    if (r.ok) {
      _alumnoTieneRostro[parseInt(idAlumno)] = true
      await cargarSelectAlumnos()
      const sel = document.getElementById('selectAlumnoRostro')
      if (sel) { sel.value = idAlumno; seleccionarAlumnoRostro(sel) }
      if (typeof tabActual !== 'undefined' && tabActual === 'alumnos') cargarTablaAlumnos()
    }
  } catch (err) { divReg.innerHTML = `<i class="im im-error" aria-hidden="true"></i> Error de red: ${err.message}` }
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
        '<span class="mensaje-err">Sesión no autorizada. Vuelve a iniciar sesión.</span>'
      detener()
    }
  }
  ws.onmessage = (evento) => {
    const r   = JSON.parse(evento.data)
    const div = document.getElementById('resultado')
    if (r.exito && r.alumno) {
      const conf = r.alumno.confianza ? ` — ${Math.round(r.alumno.confianza * 100)}%` : ''
      const esc  = typeof _escHtml === 'function' ? _escHtml : (t => t)
      div.innerHTML = `<i class="im im-ok" aria-hidden="true"></i> <strong>${esc(r.alumno.nombre)} ${esc(r.alumno.apellido)}</strong> presente${conf}`
      _mostrarReconocido(r.alumno, r.ya_enviado)
      if (!r.ya_enviado && typeof marcarPresente === 'function') {
        marcarPresente(r.alumno.id, 'facial')
      }
    } else {
      if (r.mensaje === 'Rostro no reconocido') {
        div.innerHTML = '<i class="im im-lupa" aria-hidden="true"></i> Rostro no reconocido: si es un alumno del curso, márcalo en la lista.'
        _avisoDesconocido()
      } else {
        div.innerHTML = `<span class="mensaje-aviso">${r.mensaje || 'Sin resultado'}</span>`
      }
    }
  }
}

/* ── RECONOCIMIENTO ────────────────────────────────────────────── */
async function enviarFrame() {
  const id_horario = parseInt(document.getElementById('selectorHorario').value)
  const fecha      = document.getElementById('fechaClase').value
  if (!id_horario || !fecha) {
    document.getElementById('resultado').innerHTML = '<i class="im im-alerta" aria-hidden="true"></i> Selecciona la clase activa'
    return
  }
  try {
    const elemento  = await getFrame()
    const deteccion = await faceapi.detectSingleFace(elemento, OPCIONES_DETECTOR)
      .withFaceLandmarks().withFaceDescriptor()
    if (!deteccion) { document.getElementById('resultado').innerHTML = '<i class="im im-lupa" aria-hidden="true"></i> Buscando rostro...'; return }
    const descriptor = Array.from(deteccion.descriptor)
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ descriptor, id_horario, fecha }))
  } catch (err) {
    document.getElementById('resultado').innerHTML = `<i class="im im-error" aria-hidden="true"></i> Error cámara: ${err.message}`
  }
}

function detener() {
  detenerPreview()
  if (intervaloReconocimiento) { clearInterval(intervaloReconocimiento); intervaloReconocimiento = null }
  if (ws) { ws.close(); ws = null }
  apagarWebcam()
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
  if (!id_horario || !fecha) { sicafAviso('Selecciona la clase activa primero', 'aviso'); return }
  const res = document.getElementById('resultado')
  if (res) res.innerHTML = 'Cargando modelos...'
  if (!faceapi.nets.tinyFaceDetector.isLoaded) await cargarModelos()
  if (!modoIP) {
    try { await activarWebcam() }
    catch (err) {
      if (res) res.innerHTML = `<span class="mensaje-err">No se pudo abrir la cámara: ${err.message}</span>`
      return
    }
  }
  if (ws) ws.close()
  conectarWebSocket()
  if (intervaloReconocimiento) clearInterval(intervaloReconocimiento)
  intervaloReconocimiento = setInterval(enviarFrame, 2000)
  _estadoVisor('buscando', _textoEnVivo(false))
  if (res) res.innerHTML = '<i class="im im-lupa" aria-hidden="true"></i> Buscando rostros...'
  const btnIni = document.getElementById('btn-iniciar-rec')
  const btnDet = document.getElementById('btn-detener-rec')
  if (btnIni) btnIni.disabled = true
  if (btnDet) btnDet.style.display = 'inline-block'
}
