# -*- coding: utf-8 -*-
"""Separa frontend/index.html (monolito) en:
   css/styles.css (se escribe aparte), js/api.js, js/app.js, js/facial.js
   y regenera un index.html limpio que los enlaza.
   Corta por marcadores de contenido exactos para no alterar el codigo."""
import io, sys

RUTA = r"C:\Users\UsuarioCompuElite\Desktop\Sistema-asistencia-facial\frontend"

with io.open(RUTA + r"\index.html", encoding="utf-8") as f:
    lineas = f.read().split("\n")

def idx(marcador, desde=0):
    for i in range(desde, len(lineas)):
        if marcador in lineas[i]:
            return i
    raise SystemExit("MARCADOR NO ENCONTRADO: " + marcador)

# ── Limites principales ──
i_body_abre   = idx("<body>")
i_script_abre = next(i for i, l in enumerate(lineas) if l.strip() == "<script>")
i_script_cierra = next(i for i, l in enumerate(lineas) if l.strip() == "</script>")

cuerpo_html = lineas[i_body_abre + 1 : i_script_abre]
js = lineas[i_script_abre + 1 : i_script_cierra]

def jidx(marcador, desde=0):
    for i in range(desde, len(js)):
        if marcador in js[i]:
            return i
    raise SystemExit("MARCADOR JS NO ENCONTRADO: " + marcador)

# ── Marcadores dentro del JS ──
m_jwt       = jidx("/* ── JWT: decodificar")
m_inicio    = jidx("/* ── INICIO")
m_helpers   = jidx("/* ── HELPERS API")
m_busqueda  = jidx("/* ── BÚSQUEDA UNIVERSAL")
m_descarga  = jidx("/* ── DESCARGA CSV")
m_reportes  = jidx("/* ── REPORTES ──")
m_camara    = jidx("/* ── CÁMARA ──")
m_domloaded = jidx("document.addEventListener('DOMContentLoaded'")

def dedent(bloque):
    out = []
    for l in bloque:
        out.append(l[2:] if l.startswith("  ") else l)
    return "\n".join(out)

# ════ js/api.js ════
api_head = """/* ════════════════════════════════════════════════════════════════
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
"""
api_js = (api_head + "\n"
          + dedent(js[m_jwt:m_inicio]).rstrip() + "\n\n"
          + dedent(js[m_helpers:m_busqueda]).rstrip() + "\n\n"
          + dedent(js[m_descarga:m_reportes]).rstrip() + "\n")

# ════ js/facial.js ════
facial_head = """/* ════════════════════════════════════════════════════════════════
   FACIAL.JS — Cámara, Face-api.js y reconocimiento por WebSocket
════════════════════════════════════════════════════════════════ */
const OPCIONES_DETECTOR = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 })

let ws = null, intervaloReconocimiento = null, intervaloPreview = null
let modoIP = false
"""
facial_js = facial_head + "\n" + dedent(js[m_camara:m_domloaded]).rstrip() + "\n"

# ════ js/app.js ════
app_head = """/* ════════════════════════════════════════════════════════════════
   APP.JS — Lógica general: login, tabs, CRUD, reportes, notas,
   configuración y bitácora.
════════════════════════════════════════════════════════════════ */
let intervaloAutoRefresh = null   // auto-refresh de tablas
let tabActual  = 'panel'          // pestaña visible en este momento
let modalTipo  = null   // 'alumno' | 'curso' | 'profesor' | 'horario' | ...
let modalId    = null   // null = crear, número = editar
let listaCursos = [], listaProfesores = [], listaAsignaturas = [], listaAulas = [], listaAlumnos = []

const DIAS_SEMANA = { 1:'Lunes', 2:'Martes', 3:'Miércoles', 4:'Jueves', 5:'Viernes', 6:'Sábado', 7:'Domingo' }
"""
app_js = (app_head + "\n"
          + dedent(js[m_inicio:m_helpers]).rstrip() + "\n\n"
          + dedent(js[m_busqueda:m_descarga]).rstrip() + "\n\n"
          + dedent(js[m_reportes:m_camara]).rstrip() + "\n\n"
          + dedent(js[m_domloaded:]).rstrip() + "\n")

# ════ index.html nuevo ════
head = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1d4ed8">
  <title>Sistema de Asistencia Facial</title>
  <link rel="stylesheet" href="css/styles.css">
  <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
</head>
<body>
"""
pie = """
<!-- ═══ SCRIPTS DE LA APLICACIÓN ════════════════════════════════════ -->
<script src="js/api.js"></script>
<script src="js/app.js"></script>
<script src="js/facial.js"></script>

</body>
</html>
"""
index_html = head + "\n".join(cuerpo_html).rstrip() + "\n" + pie

with io.open(RUTA + r"\js\api.js", "w", encoding="utf-8", newline="\n") as f:
    f.write(api_js)
with io.open(RUTA + r"\js\app.js", "w", encoding="utf-8", newline="\n") as f:
    f.write(app_js)
with io.open(RUTA + r"\js\facial.js", "w", encoding="utf-8", newline="\n") as f:
    f.write(facial_js)
with io.open(RUTA + r"\index.html", "w", encoding="utf-8", newline="\n") as f:
    f.write(index_html)

print("api.js   :", api_js.count("\n") + 1, "lineas")
print("app.js   :", app_js.count("\n") + 1, "lineas")
print("facial.js:", facial_js.count("\n") + 1, "lineas")
print("index.html:", index_html.count("\n") + 1, "lineas")
print("OK")
