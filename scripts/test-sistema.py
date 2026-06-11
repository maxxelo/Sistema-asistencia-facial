# -*- coding: utf-8 -*-
"""Prueba de extremo a extremo del sistema (APIs 1-4).
   Uso: python scripts/test-sistema.py"""
import json
import urllib.request
import urllib.error
import sys

sys.stdout.reconfigure(encoding="utf-8")
BASE1 = "http://localhost:3001"
BASE2 = "http://localhost:3002"
BASE3 = "http://localhost:3003"
BASE4 = "http://localhost:3004"

def llamar(metodo, url, body=None, token=None, raw=False):
    datos = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            cuerpo = r.read()
            return r.status, cuerpo if raw else json.loads(cuerpo.decode("utf-8"))
    except urllib.error.HTTPError as e:
        cuerpo = e.read()
        try:
            return e.code, json.loads(cuerpo.decode("utf-8"))
        except Exception:
            return e.code, cuerpo[:120]

ok, fallos = 0, 0
def check(nombre, cond, detalle=""):
    global ok, fallos
    if cond:
        ok += 1
        print(f"  ✅ {nombre}")
    else:
        fallos += 1
        print(f"  ❌ {nombre} — {detalle}")

print("══ LOGIN ══")
st, r = llamar("POST", BASE1 + "/login", {"nombre_usuario": "admin", "password": "admin123"})
check("login admin", st == 200 and "token" in r, str(r)[:100])
TOKEN = r.get("token", "")

st, r = llamar("POST", BASE1 + "/login", {"nombre_usuario": "admin", "password": "incorrecta"})
check("login con clave mala → 401", st == 401, f"status {st}")

print("══ PARÁMETROS ══")
st, r = llamar("POST", BASE1 + "/parametros/bulk",
               [{"clave": "nombre_colegio", "valor": "Colegio San Martín"}], token=TOKEN)
check("bulk upsert con acentos", st == 200, str(r)[:100])
st, r = llamar("GET", BASE1 + "/parametros", token=TOKEN)
nombre = next((p["valor"] for p in r if p["clave"] == "nombre_colegio"), "")
check("acento guardado bien (Martín)", nombre == "Colegio San Martín", repr(nombre))
st, r = llamar("GET", BASE1 + "/parametros")  # sin token
check("parametros sin token → 401", st == 401, f"status {st}")
st, r = llamar("POST", BASE1 + "/parametros/bulk",
               [{"clave": "biometria_umbral", "valor": "2.5"}], token=TOKEN)
check("umbral biométrico inválido → 400", st == 400, f"status {st}")

print("══ BITÁCORA ══")
st, r = llamar("GET", BASE1 + "/bitacora?limite=50", token=TOKEN)
check("GET /bitacora responde lista", st == 200 and isinstance(r, list), str(r)[:80])
acciones = [b.get("accion", "") for b in r] if isinstance(r, list) else []
check("registra LOGIN", any(a.startswith("LOGIN") for a in acciones), str(acciones[:5]))
check("registra EDITAR parametros", any("parametros" in a for a in acciones), str(acciones[:5]))

print("══ API 2: VALIDACIONES DE FLUJO ══")
# 2026-06-11 es jueves → horario 4 (curso 1, jueves 10:00 Historia)
FECHA_JUE = "2026-06-11"
st, r = llamar("POST", BASE2 + "/asistencia/marcar-facial",
               {"id_alumno": 1, "id_horario": 4, "fecha": FECHA_JUE, "confianza": 0.9}, token=TOKEN)
check("marca facial válida (alumno 1, jueves)", st == 201, f"status {st}: {r}")
st, r = llamar("POST", BASE2 + "/asistencia/marcar-facial",
               {"id_alumno": 4, "id_horario": 4, "fecha": FECHA_JUE, "confianza": 0.9}, token=TOKEN)
check("alumno de otro curso → 409", st == 409 and "no pertenece" in str(r.get("error", "")),
      f"status {st}: {r}")
st, r = llamar("POST", BASE2 + "/asistencia/marcar-facial",
               {"id_alumno": 1, "id_horario": 1, "fecha": FECHA_JUE, "confianza": 0.9}, token=TOKEN)
check("fecha que no es el día de la clase → 400", st == 400 and "cae en" in str(r.get("error", "")),
      f"status {st}: {r}")
st, r = llamar("POST", BASE2 + "/asistencia/marcar",
               {"id_curso": 1, "id_horario": 1, "fecha": FECHA_JUE,
                "alumnos": [{"id_alumno": 1, "presente": True}]}, token=TOKEN)
check("marcar manual día equivocado → 400", st == 400, f"status {st}: {r}")
st, r = llamar("POST", BASE2 + "/asistencia/marcar",
               {"id_curso": 1, "id_horario": 4, "fecha": FECHA_JUE,
                "alumnos": [{"id_alumno": 1, "presente": True}, {"id_alumno": 2, "presente": False}]},
               token=TOKEN)
check("marcar manual válido", st == 201, f"status {st}: {r}")

print("══ API 3: SEGURIDAD ══")
descriptor_falso = [0.1] * 128
st, r = llamar("POST", BASE3 + "/rostros", {"id_alumno": 1, "descriptor": descriptor_falso})
check("POST /rostros sin token → 401", st == 401, f"status {st}: {r}")
st, r = llamar("POST", BASE3 + "/rostros",
               {"id_alumno": 1, "descriptores": [descriptor_falso, [0.11] * 128, [0.12] * 128]},
               token=TOKEN)
check("registro multi-rostro (3 capturas) con token", st == 200 and "3 capturas" in str(r),
      f"status {st}: {r}")
st, r = llamar("POST", BASE3 + "/rostros",
               {"id_alumno": 1, "descriptor": [0.1] * 64}, token=TOKEN)
check("descriptor de tamaño inválido → 400", st == 400, f"status {st}: {r}")
st, r = llamar("POST", BASE3 + "/rostros",
               {"id_alumno": 9999, "descriptor": descriptor_falso}, token=TOKEN)
check("alumno inexistente → 400", st == 400, f"status {st}: {r}")

print("══ API 4: REPORTES ══")
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/1", token=TOKEN, raw=True)
check("PDF de curso se genera", st == 200 and r[:4] == b"%PDF", f"status {st}, inicio: {r[:10]}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/alumno/1", token=TOKEN, raw=True)
check("PDF de alumno se genera", st == 200 and r[:4] == b"%PDF", f"status {st}, inicio: {r[:10]}")
st, r = llamar("GET", BASE4 + "/reportes/csv/curso/1", token=TOKEN, raw=True)
check("CSV de curso sigue funcionando", st == 200 and b"RUT" in r[:50], f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/asistencia/riesgo", token=TOKEN)
check("reporte de riesgo JSON", st == 200 and "alumnos" in r, str(r)[:80])
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/1")  # sin token
check("PDF sin token → 401", st == 401, f"status {st}")

print()
print(f"RESULTADO: {ok} pruebas OK, {fallos} fallos")
sys.exit(1 if fallos else 0)
