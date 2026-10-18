/* ════════════════════════════════════════════════════════════════
   API.JS — URLs de las APIs, sesión y helpers HTTP
   Las URLs se derivan del host actual: funciona en localhost y
   tambien al acceder desde otro equipo de la red local.
════════════════════════════════════════════════════════════════ */
const HOST   = window.location.hostname || 'localhost'
const API1   = `http://${HOST}:3001`
const API2   = `http://${HOST}:3002`
const API3   = `http://${HOST}:3003`
const API4   = `http://${HOST}:3004`
const WS_URL = `ws://${HOST}:3003`

/* ── Sesión (JWT en localStorage) ─────────────────────────────── */
let token      = localStorage.getItem('token')      || null
let rolUsuario = localStorage.getItem('rolUsuario') || null

/* ── JWT: decodificar sin verificar (solo para mostrar datos) ── */
function decodificarToken(jwt) {
  // El JWT tiene 3 partes separadas por '.'; la segunda es el payload en base64
  try { return JSON.parse(atob(jwt.split('.')[1])) }
  catch { return null }
}

function tokenExpirado(jwt) {
  const p = decodificarToken(jwt)
  // p.exp es Unix timestamp en segundos
  return !p || !p.exp || (Date.now() / 1000 > p.exp)
}

/* ── HELPERS API ───────────────────────────────────────────────── */
function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
}

async function apiGet(url) {
  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
  return r.json()
}

async function apiPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json() }
}

async function apiPut(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json() }
}

async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE', headers: authHeaders() })
  return { ok: r.ok, data: await r.json() }
}

async function apiPatch(url, body) {
  // Para reactivar registros (PATCH /entidad/:id/reactivar)
  const r = await fetch(url, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) })
  return { ok: r.ok, data: await r.json() }
}

/* ── DESCARGA AUTENTICADA DE ARCHIVOS (CSV, PDF) ──────────────── */
async function descargarArchivo(url, nombreArchivo) {
  try {
    const token = localStorage.getItem('token')
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!resp.ok) {
      // Mostrar el motivo que entrega el servidor (p. ej. "Período no encontrado" o falta de permiso)
      let detalle = ''
      try { detalle = (await resp.json()).error || '' } catch (e) { /* respuesta sin JSON */ }
      sicafAviso('No se pudo generar el archivo' + (detalle ? ': ' + detalle : ''), 'error')
      return
    }
    const blob   = await resp.blob()
    const link   = document.createElement('a')
    link.href    = URL.createObjectURL(blob)
    link.download = nombreArchivo
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (err) {
    sicafAviso('Error al descargar: ' + err.message, 'error')
  }
}

// Alias con el nombre anterior (lo usan los botones generados dinámicamente)
const descargarCSV = descargarArchivo
