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
check("PDF de curso se genera", st == 200 and isinstance(r, bytes) and r[:4] == b"%PDF", f"status {st}: {str(r)[:60]}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/alumno/1", token=TOKEN, raw=True)
check("PDF de alumno se genera", st == 200 and isinstance(r, bytes) and r[:4] == b"%PDF", f"status {st}: {str(r)[:60]}")
st, r = llamar("GET", BASE4 + "/reportes/csv/curso/1", token=TOKEN, raw=True)
check("CSV de curso sigue funcionando", st == 200 and b"RUT" in r[:50], f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/asistencia/riesgo", token=TOKEN)
check("reporte de riesgo JSON", st == 200 and "alumnos" in r, str(r)[:80])
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/1")  # sin token
check("PDF sin token → 401", st == 401, f"status {st}")

print("══ R.40: CONSENTIMIENTO BIOMÉTRICO ══")
st, r = llamar("GET", BASE1 + "/alumnos/5", token=TOKEN)
check("el seed deja consentimiento en alumno 5", r.get("consentimiento_biometrico") is True, str(r)[:90])
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento", {"otorgado": False}, token=TOKEN)
check("revocar consentimiento", st == 200 and r.get("consentimiento_biometrico") is False, f"status {st}: {r}")
st, r = llamar("POST", BASE3 + "/rostros", {"id_alumno": 5, "descriptor": descriptor_falso}, token=TOKEN)
check("registrar rostro SIN consentimiento → 403", st == 403 and "consentimiento" in str(r.get("error", "")),
      f"status {st}: {r}")
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento", {"otorgado": True}, token=TOKEN)
check("otorgar sin apoderado → 400", st == 400, f"status {st}: {r}")
st, ap = llamar("POST", BASE1 + "/apoderados",
                {"rut": "10101010-1", "nombre": "Rosa Herrera", "telefono": "+56911112222",
                 "email": "rherrera@correo.cl", "parentesco": "Madre"}, token=TOKEN)
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento",
               {"otorgado": True, "id_apoderado": ap.get("id")}, token=TOKEN)
check("otorgar con apoderado NO vinculado → 400", st == 400 and "vinculado" in str(r.get("error", "")),
      f"status {st}: {r}")
llamar("POST", BASE1 + f"/apoderados/{ap.get('id')}/vincular", {"id_alumno": 5}, token=TOKEN)
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento",
               {"otorgado": True, "id_apoderado": ap.get("id")}, token=TOKEN)
check("otorgar con apoderado vinculado", st == 200 and r.get("consentimiento_biometrico") is True,
      f"status {st}: {r}")
st, r = llamar("POST", BASE3 + "/rostros", {"id_alumno": 5, "descriptor": descriptor_falso}, token=TOKEN)
check("registrar rostro CON consentimiento", st == 200, f"status {st}: {r}")
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento", {"otorgado": False}, token=TOKEN)
check("revocar elimina el rostro (derecho de cancelación)", st == 200 and r.get("rostro_eliminado") is True,
      f"status {st}: {r}")
st, r = llamar("GET", BASE3 + "/rostros/5", token=TOKEN)
check("el rostro ya no existe tras revocar", st == 404, f"status {st}: {r}")
st, r = llamar("POST", BASE1 + "/login", {"nombre_usuario": "profesor1", "password": "profesor123"})
TOKEN_PROF = r.get("token", "")
st, r = llamar("PUT", BASE1 + "/alumnos/5/consentimiento", {"otorgado": False}, token=TOKEN_PROF)
check("un profesor no puede gestionar consentimientos → 403", st == 403, f"status {st}")

print("══ R.23: PROFESOR SOLO VE SUS CURSOS ══")
check("login profesor1", bool(TOKEN_PROF))
# Asistencia en el curso 2 (4°B) para que el filtro por curso tenga datos que ocultar.
# 2026-06-09 es martes → horario 5 (4°B, martes). El alumno 5 tiene apoderado (creado arriba).
st, r = llamar("POST", BASE2 + "/asistencia/marcar",
               {"id_curso": 2, "id_horario": 5, "fecha": "2026-06-09", "definitivo": True,
                "alumnos": [{"id_alumno": 4, "presente": True}, {"id_alumno": 5, "presente": False}]},
               token=TOKEN)
check("preparación: asistencia en curso ajeno (4°B)", st == 201, f"status {st}: {r}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/1", token=TOKEN_PROF, raw=True)
check("profesor: PDF de su curso (3°A) → 200", st == 200 and isinstance(r, bytes) and r[:4] == b"%PDF", f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/2", token=TOKEN_PROF, raw=True)
check("profesor: PDF de curso ajeno (4°B) → 403", st == 403, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/csv/curso/2", token=TOKEN_PROF, raw=True)
check("profesor: CSV de curso ajeno → 403", st == 403, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/alumno/4", token=TOKEN_PROF, raw=True)
check("profesor: PDF de alumno de curso ajeno → 403", st == 403, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/alumno/1", token=TOKEN_PROF, raw=True)
check("profesor: PDF de alumno propio → 200", st == 200, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/asistencia/curso/2", token=TOKEN_PROF)
check("profesor: asistencia de curso ajeno → 403", st == 403, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/asignaturas", token=TOKEN_PROF)
check("profesor: estadística global de asignaturas → 403", st == 403, f"status {st}")
st, r = llamar("GET", BASE4 + "/reportes/asistencia/riesgo?umbral=101", token=TOKEN_PROF)
cursos_vistos = {a.get("curso") for a in r.get("alumnos", [])} if isinstance(r, dict) else {"?"}
check("profesor: riesgo ve su curso y NO el ajeno", st == 200 and cursos_vistos == {"3°A"}, f"{st} {cursos_vistos}")
st, r = llamar("GET", BASE4 + "/reportes/asistencia/riesgo?umbral=101", token=TOKEN)
cursos_admin = {a.get("curso") for a in r.get("alumnos", [])} if isinstance(r, dict) else set()
check("admin: riesgo ve ambos cursos", st == 200 and cursos_admin == {"3°A", "4°B"}, f"{st} {cursos_admin}")
st, r = llamar("GET", BASE4 + "/reportes/pdf/curso/2", token=TOKEN, raw=True)
check("admin: PDF de cualquier curso → 200", st == 200, f"status {st}")

print("══ R.26: ALERTA DE ASISTENCIA BAJO 85 % ══")
# alumno 2 queda ausente y definitivo → 0 % de asistencia → alerta para admin y profesor jefe
st, r = llamar("POST", BASE2 + "/asistencia/marcar",
               {"id_curso": 1, "id_horario": 4, "fecha": FECHA_JUE, "definitivo": True,
                "alumnos": [{"id_alumno": 1, "presente": True}, {"id_alumno": 2, "presente": False}]},
               token=TOKEN)
check("registro definitivo genera alertas", st == 201 and r.get("alertas_generadas", 0) >= 2, f"status {st}: {r}")
st, r = llamar("GET", BASE1 + "/notificaciones", token=TOKEN)
alertas = [n for n in r.get("notificaciones", []) if "Rojas" in n.get("titulo", "")] if isinstance(r, dict) else []
check("admin recibe la alerta del alumno", len(alertas) >= 1 and r.get("no_leidas", 0) >= 1, str(r)[:120])
st, rr = llamar("GET", BASE1 + "/notificaciones?limite=100", token=TOKEN)
con_apoderado = [n for n in rr.get("notificaciones", []) if "Herrera" in n.get("titulo", "")]
check("la alerta incluye nombre, teléfono y correo del apoderado",
      bool(con_apoderado) and all(x in con_apoderado[0]["mensaje"] for x in ("Rosa Herrera", "+56911112222", "rherrera@correo.cl")),
      con_apoderado[0]["mensaje"][:160] if con_apoderado else "sin alerta para alumno 5")
check("sin apoderado, la alerta lo indica",
      bool(alertas) and "no tiene apoderado registrado" in alertas[0].get("mensaje", ""),
      alertas[0].get("mensaje", "")[:120] if alertas else "")
st, r2 = llamar("GET", BASE1 + "/notificaciones", token=TOKEN_PROF)
check("el profesor jefe también la recibe", any("Rojas" in n.get("titulo", "") for n in r2.get("notificaciones", [])),
      str(r2)[:120])
st, r = llamar("POST", BASE2 + "/asistencia/marcar",
               {"id_curso": 1, "id_horario": 4, "fecha": FECHA_JUE, "definitivo": True,
                "alumnos": [{"id_alumno": 1, "presente": True}, {"id_alumno": 2, "presente": False}]},
               token=TOKEN)
check("no se repite la alerta el mismo día", st == 201 and r.get("alertas_generadas") == 0, f"status {st}: {r}")
if alertas:
    st, r = llamar("PATCH", BASE1 + f"/notificaciones/{alertas[0]['id']}/leida", token=TOKEN)
    check("marcar notificación como leída", st == 200, f"status {st}: {r}")
st, r = llamar("PATCH", BASE1 + "/notificaciones/leer-todas", token=TOKEN)
check("marcar todas como leídas", st == 200, f"status {st}: {r}")
st, r = llamar("GET", BASE1 + "/notificaciones", token=TOKEN)
check("sin notificaciones pendientes", r.get("no_leidas") == 0, str(r)[:80])
st, r = llamar("GET", BASE1 + "/notificaciones")
check("notificaciones sin token → 401", st == 401, f"status {st}")

print()
print(f"RESULTADO: {ok} pruebas OK, {fallos} fallos")
sys.exit(1 if fallos else 0)
