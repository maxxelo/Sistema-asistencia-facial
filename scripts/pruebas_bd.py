# -*- coding: utf-8 -*-
"""Matriz de pruebas de base de datos de SICAF (20 pruebas).

Se ejecuta contra una base PostgreSQL AISLADA, nunca contra la del sistema:
    docker run -d --name sicaf_pruebas_db -e POSTGRES_USER=admin -e POSTGRES_PASSWORD=pruebas123 \
      -e POSTGRES_DB=colegio_db -p 55432:5432 \
      -v "<repo>/database/init.sql:/docker-entrypoint-initdb.d/01_init.sql:ro" \
      -v "<repo>/database/seed.sql:/docker-entrypoint-initdb.d/02_seed.sql:ro" postgres:16
    python scripts/pruebas_bd.py [salida.json]

Cada prueba registra sus verificaciones con el criterio que evalúan:
    D = Desempeño · I = Integridad · CS = Cargas del sistema · TF = Tolerancia a fallos
"""
import json, re, subprocess, sys, time, datetime, os, tempfile

sys.stdout.reconfigure(encoding='utf-8')
CONT, DB, USR = 'sicaf_pruebas_db', 'colegio_db', 'admin'
LIMITE_MS = 1000          # tiempo máximo aceptable para una operación interactiva del sistema


def sh(args, entrada=None, timeout=600):
    r = subprocess.run(args, input=entrada, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def psql(sql, db=DB, timing=False):
    """Ejecuta SQL dentro del contenedor. Devuelve (codigo, filas, ms_total, stderr)."""
    args = ['docker', 'exec', '-i', CONT, 'psql', '-U', USR, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tA', '-q']
    entrada = ('\\timing on\n' if timing else '') + sql
    cod, out, err = sh(args, entrada)
    ms = sum(float(x) for x in re.findall(r'Time: ([\d.]+) ms', out))
    filas = [l for l in out.splitlines() if l.strip() and not l.startswith('Time:')]
    return cod, filas, ms, err.strip()


def valor(sql, db=DB):
    cod, filas, _, err = psql(sql, db)
    if cod != 0:
        raise RuntimeError(err)
    return filas[0] if filas else None


def contar(tabla, where='TRUE', db=DB):
    return int(valor(f'SELECT count(*) FROM {tabla} WHERE {where};', db))


def esperar_bd(seg=60):
    for _ in range(seg):
        cod, _, _ = sh(['docker', 'exec', CONT, 'pg_isready', '-U', USR, '-d', DB])
        if cod == 0:
            try:
                valor('SELECT 1;')
                return True
            except Exception:
                pass
        time.sleep(1)
    return False


def dv(cuerpo):
    s, m = 0, 2
    for d in reversed(str(cuerpo)):
        s += int(d) * m
        m = 2 if m == 7 else m + 1
    r = 11 - s % 11
    return {11: '0', 10: 'K'}.get(r, str(r))


resultados = []


class Prueba:
    def __init__(self, cod, descripcion, objetivo):
        self.d = {'codigo': cod, 'descripcion': descripcion, 'objetivo': objetivo,
                  'procedimiento': '', 'checks': [], 'evidencia': [], 'tiempo_ms': None}
        print(f'\n── {cod}: {descripcion}')

    def proc(self, texto):
        self.d['procedimiento'] = texto

    def check(self, criterio, desc, ok, detalle=''):
        self.d['checks'].append({'criterio': criterio, 'desc': desc, 'ok': bool(ok), 'detalle': str(detalle)})
        print(f"   [{'OK' if ok else 'FALLA'}] ({criterio}) {desc} {('— ' + str(detalle)) if detalle else ''}")

    def ev(self, texto):
        self.d['evidencia'].append(str(texto))

    def fin(self, ms=None):
        if ms is not None:
            self.d['tiempo_ms'] = round(ms, 1)
        resultados.append(self.d)


def pgbench(script, clientes, hilos, transacciones=None, segundos=None, db=DB):
    sh(['docker', 'exec', '-i', CONT, 'sh', '-c', 'cat > /tmp/script.sql'], script)
    args = ['docker', 'exec', CONT, 'pgbench', '-n', '-U', USR, '-c', str(clientes), '-j', str(hilos), '-f', '/tmp/script.sql']
    args += ['-t', str(transacciones)] if transacciones else ['-T', str(segundos)]
    cod, out, err = sh(args + [db], timeout=900)
    txt = out + err
    proc = re.search(r'number of transactions actually processed: (\d+)', txt)
    fail = re.search(r'number of failed transactions: (\d+)', txt)
    tps = re.search(r'tps = ([\d.]+)', txt)
    lat = re.search(r'latency average = ([\d.]+) ms', txt)
    return {'codigo': cod, 'procesadas': int(proc.group(1)) if proc else 0,
            'fallidas': int(fail.group(1)) if fail else 0,
            'tps': float(tps.group(1)) if tps else 0.0, 'latencia_ms': float(lat.group(1)) if lat else None,
            'salida': txt.strip()[-400:]}


def medir(sql, veces=15, db=DB):
    """Ejecuta una sentencia varias veces; devuelve (aciertos, ms promedio, ms máximo)."""
    tiempos, ok = [], 0
    for _ in range(veces):
        cod, _, ms, _ = psql(sql, db, timing=True)
        if cod == 0:
            ok += 1
            tiempos.append(ms)
    return ok, (sum(tiempos) / len(tiempos) if tiempos else None), (max(tiempos) if tiempos else None)


# ═══════════════════════════════════════════════════════════════════
if not esperar_bd():
    sys.exit('La base de pruebas no responde')
print('Base de pruebas:', valor('SELECT version();')[:60])
psql('CREATE EXTENSION IF NOT EXISTS amcheck;')

# p1 ─────────────────────────────────────────────────────────────────
p = Prueba('p1', 'Insert simultáneos - Prueba de concurrencia',
           'Verificar que muchas inserciones simultáneas no pierden registros y que la restricción única impide duplicar una clase.')
p.proc('pgbench: 20 clientes en paralelo insertan 1.000 intentos de reconocimiento; luego 20 clientes intentan crear '
       'la misma cabecera de asistencia (fecha + horario) con ON CONFLICT, como hace la API.')
antes = contar('intentos_reconocimiento')
r = pgbench("INSERT INTO intentos_reconocimiento (id_alumno, exito, confianza) "
            "VALUES ((random()*4)::int + 1, random() > 0.2, random());", 20, 4, transacciones=50)
despues = contar('intentos_reconocimiento')
p.check('I', '1.000 inserciones concurrentes quedan registradas, sin pérdidas', despues - antes == 1000, f'{despues - antes} filas nuevas')
p.check('CS', 'ninguna transacción falló con 20 clientes simultáneos', r['fallidas'] == 0 and r['codigo'] == 0, f"{r['fallidas']} fallidas")
p.check('D', 'rendimiento sostenido sobre 200 transacciones por segundo', r['tps'] > 200, f"{r['tps']:.0f} tps, latencia media {r['latencia_ms']} ms")
r2 = pgbench("INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario) VALUES ('2026-06-01', 1, 1) "
             "ON CONFLICT (fecha, id_horario) DO NOTHING;", 20, 4, transacciones=10)
n = contar('asistencia_cabecera', "fecha = '2026-06-01' AND id_horario = 1")
p.check('I', '200 intentos simultáneos de abrir la misma clase dejan una sola cabecera', n == 1 and r2['fallidas'] == 0, f'{n} cabecera(s)')
p.ev(f"pgbench inserciones: {r['procesadas']} transacciones, {r['tps']:.0f} tps, {r['fallidas']} fallidas")
p.fin(r['latencia_ms'])

# p2 ─────────────────────────────────────────────────────────────────
p = Prueba('p2', 'Cargue de registros masivo',
           'Medir la carga de un archivo masivo de alumnos y comprobar que las reglas de integridad se mantienen.')
p.proc('Se genera un CSV de 10.000 alumnos con RUT válido y se carga con COPY. Luego se intenta cargar un archivo '
       'con un RUT repetido para comprobar que la carga completa se rechaza.')
filas = ['rut,nombre,apellido_paterno,email,id_curso']
for i in range(10000):
    c = 30000000 + i
    filas.append(f'{c}-{dv(c)},Alumno{i},Carga,carga{i}@prueba.cl,{1 + i % 2}')
sh(['docker', 'exec', '-i', CONT, 'sh', '-c', 'cat > /tmp/alumnos.csv'], '\n'.join(filas) + '\n')
antes = contar('alumnos')
cod, _, ms, err = psql("\\copy alumnos (rut, nombre, apellido_paterno, email, id_curso) FROM '/tmp/alumnos.csv' CSV HEADER", timing=True)
despues = contar('alumnos')
p.check('CS', 'se cargan los 10.000 registros', cod == 0 and despues - antes == 10000, f'{despues - antes} filas')
p.check('D', 'la carga completa tarda menos de 5 segundos', 0 < ms < 5000, f'{ms:.0f} ms')
dup = filas[0] + '\n' + '\n'.join(filas[1:3]) + '\n' + filas[1] + '\n'
sh(['docker', 'exec', '-i', CONT, 'sh', '-c', 'cat > /tmp/dup.csv'], dup)
cod2, _, _, err2 = psql("\\copy alumnos (rut, nombre, apellido_paterno, email, id_curso) FROM '/tmp/dup.csv' CSV HEADER")
p.check('I', 'un archivo con un RUT repetido se rechaza completo (no queda a medias)',
        cod2 != 0 and contar('alumnos') == despues, err2.split('\n')[0][:90])
p.ev(f'COPY de 10.000 filas en {ms:.0f} ms')
p.fin(ms)

# p3 ─────────────────────────────────────────────────────────────────
p = Prueba('p3', 'Inserción basado en una consulta',
           'Crear la lista de asistencia de una clase a partir de los alumnos activos del curso, como hace el sistema.')
p.proc('INSERT ... SELECT: se crea la cabecera de una clase y se inserta un detalle "ausente" por cada alumno activo del curso 1.')
cab = valor("INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario) VALUES ('2026-06-03', 1, 3) RETURNING id;")
esperado = contar('alumnos', 'id_curso = 1 AND activo')
cod, _, ms, _ = psql(f"INSERT INTO asistencia_detalle (id_asistencia_cabecera, id_alumno, presente) "
                     f"SELECT {cab}, id, FALSE FROM alumnos WHERE id_curso = 1 AND activo;", timing=True)
n = contar('asistencia_detalle', f'id_asistencia_cabecera = {cab}')
p.check('I', 'un detalle por cada alumno activo del curso', cod == 0 and n == esperado, f'{n} de {esperado}')
p.check('D', f'inserción de {esperado} filas en menos de {LIMITE_MS} ms', ms < LIMITE_MS, f'{ms:.0f} ms')
cod, _, _, err = psql(f"INSERT INTO asistencia_detalle (id_asistencia_cabecera, id_alumno) SELECT {cab}, id FROM alumnos WHERE id_curso = 1 LIMIT 1;")
p.check('I', 'repetir un alumno en la misma clase se rechaza (UNIQUE)', cod != 0 and 'duplicate key' in err, err.split('\n')[0][:80])
p.fin(ms)
CAB_P3 = cab

# p4 ─────────────────────────────────────────────────────────────────
p = Prueba('p4', 'Generar una consulta en base al resultado de la subconsulta',
           'Obtener los alumnos bajo el 85 % de asistencia con una subconsulta, como el reporte de riesgo.')
p.proc('Se registra asistencia controlada para 3 alumnos del seed y se consulta con una subconsulta que calcula el porcentaje por alumno.')
psql("""INSERT INTO asistencia_cabecera (fecha, id_curso, id_horario) VALUES ('2026-06-10', 1, 3), ('2026-06-17', 1, 3)
        ON CONFLICT DO NOTHING;""")
c1 = valor("SELECT id FROM asistencia_cabecera WHERE fecha='2026-06-10' AND id_horario=3;")
c2 = valor("SELECT id FROM asistencia_cabecera WHERE fecha='2026-06-17' AND id_horario=3;")
psql(f"""INSERT INTO asistencia_detalle (id_asistencia_cabecera, id_alumno, presente) VALUES
        ({c1},1,TRUE),({c2},1,TRUE),({c1},2,FALSE),({c2},2,FALSE),({c1},3,TRUE),({c2},3,FALSE)
        ON CONFLICT DO NOTHING;""")
sql = f"""SELECT a.id FROM alumnos a WHERE a.id IN (1,2,3) AND a.id IN (
            SELECT ad.id_alumno FROM asistencia_detalle ad
             WHERE ad.id_asistencia_cabecera IN ({c1},{c2})
             GROUP BY ad.id_alumno
            HAVING 100.0 * count(*) FILTER (WHERE ad.presente) / count(*) < 85)
          ORDER BY a.id;"""
cod, filas_r, ms, _ = psql(sql, timing=True)
p.check('I', 'la subconsulta devuelve exactamente los alumnos bajo el 85 % (2 y 3)', filas_r == ['2', '3'], filas_r)
p.check('D', 'responde en menos de 100 ms', ms < 100, f'{ms:.1f} ms')
p.fin(ms)

# p5 ─────────────────────────────────────────────────────────────────
p = Prueba('p5', 'Join - Diferencia de información entre dos tablas',
           'Detectar los alumnos que no tienen rostro registrado (LEFT JOIN) y comprobarlo con EXCEPT.')
p.proc('Se compara el resultado de un LEFT JOIN ... IS NULL con el de un EXCEPT entre alumnos y rostros.')
cod, a, ms, _ = psql("SELECT a.id FROM alumnos a LEFT JOIN rostros r ON r.id_alumno = a.id WHERE r.id IS NULL ORDER BY 1;", timing=True)
_, b, _, _ = psql("SELECT id FROM alumnos EXCEPT SELECT id_alumno FROM rostros ORDER BY 1;")
p.check('I', 'LEFT JOIN y EXCEPT entregan el mismo conjunto', a == b and len(a) > 0, f'{len(a)} alumnos sin rostro')
p.check('D', f'el cruce sobre {contar("alumnos")} alumnos tarda menos de {LIMITE_MS} ms', ms < LIMITE_MS, f'{ms:.0f} ms')
p.fin(ms)

# p6 ─────────────────────────────────────────────────────────────────
p = Prueba('p6', 'Exportar la información de la tabla a un archivo',
           'Exportar la lista de alumnos a CSV, como el reporte del sistema, y validar el archivo.')
p.proc("\\copy (SELECT rut, nombre, apellido_paterno, id_curso FROM alumnos) TO '/tmp/export.csv' CSV HEADER; luego se cuentan las líneas.")
total = contar('alumnos')
cod, _, ms, _ = psql("\\copy (SELECT rut, nombre, apellido_paterno, id_curso FROM alumnos ORDER BY id) TO '/tmp/export.csv' CSV HEADER", timing=True)
_, out, _ = sh(['docker', 'exec', CONT, 'sh', '-c', 'wc -l < /tmp/export.csv && head -2 /tmp/export.csv'])
lineas = int(out.split()[0]) if out.strip() else 0
p.check('I', 'el archivo trae todas las filas más el encabezado', cod == 0 and lineas == total + 1, f'{lineas} líneas para {total} alumnos')
p.check('D', 'la exportación tarda menos de 2 segundos', ms < 2000, f'{ms:.0f} ms')
p.ev(out.strip().replace('\n', ' | ')[:160])
p.fin(ms)

# p7 ─────────────────────────────────────────────────────────────────
p = Prueba('p7', 'Funciones varias',
           'Validar las funciones de PostgreSQL que usa el sistema: fechas, agregados, texto y zona horaria.')
p.proc('Se evalúan EXTRACT(ISODOW), ROUND/AVG, string_agg, to_char, generate_series y AT TIME ZONE con resultados conocidos.')
casos = [
    ("SELECT EXTRACT(ISODOW FROM DATE '2026-06-11')::int;", '4', 'día de la semana (jueves = 4)'),
    ("SELECT ROUND(AVG(n)::numeric, 1) FROM (VALUES (6.5),(5.0),(7.0)) t(n);", '6.2', 'promedio de notas con un decimal'),
    ("SELECT string_agg(x, ',' ORDER BY x) FROM (VALUES ('b'),('a'),('c')) t(x);", 'a,b,c', 'concatenación ordenada'),
    ("SELECT to_char(TIMESTAMP '2026-06-11 08:05', 'HH24:MI');", '08:05', 'formato de hora'),
    ("SELECT count(*) FROM generate_series(DATE '2026-03-02', DATE '2026-07-03', '1 day') d WHERE EXTRACT(ISODOW FROM d) = 1;", '18', 'lunes de un semestre (cálculo de clases)'),
    ("SELECT to_char(TIMESTAMPTZ '2026-10-19 00:30+00' AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI');", '2026-10-18 21:30', 'hora de Chile desde UTC'),
]
for sql_c, esp, desc in casos:
    try:
        v = valor(sql_c)
    except Exception as e:
        v = str(e)[:60]
    p.check('I', desc, v == esp, f'{v} (esperado {esp})')
p.fin()

# p8 ─────────────────────────────────────────────────────────────────
p = Prueba('p8', 'Eliminar todos los registros de una tabla',
           'Vaciar una tabla de registro técnico y comprobar que una tabla con dependencias no se puede vaciar sin control.')
p.proc('DELETE FROM intentos_reconocimiento (tabla sin dependientes). Luego TRUNCATE de cursos sin CASCADE, que debe ser rechazado.')
n0 = contar('intentos_reconocimiento')
cod, _, ms, _ = psql('DELETE FROM intentos_reconocimiento;', timing=True)
p.check('I', f'se eliminan los {n0} registros', cod == 0 and contar('intentos_reconocimiento') == 0, f'quedan {contar("intentos_reconocimiento")}')
p.check('D', 'la eliminación tarda menos de 1 segundo', ms < 1000, f'{ms:.0f} ms')
cod, _, _, err = psql('TRUNCATE cursos;')
p.check('I', 'vaciar cursos sin CASCADE se rechaza (protege alumnos y horarios)', cod != 0 and 'foreign key' in err.lower(), err.split('\n')[0][:90])
p.fin(ms)

# p9 ─────────────────────────────────────────────────────────────────
p = Prueba('p9', 'Eliminar un rango de registros de una tabla',
           'Eliminar solo los alumnos de un rango de RUT cargados en p2, sin tocar los demás.')
p.proc("DELETE FROM alumnos WHERE rut BETWEEN '30000000' AND '30000999' (1.000 alumnos de prueba).")
total0 = contar('alumnos')
rango = contar('alumnos', "rut >= '30000000' AND rut < '30001000'")
cod, _, ms, _ = psql("DELETE FROM alumnos WHERE rut >= '30000000' AND rut < '30001000';", timing=True)
p.check('I', 'se eliminan exactamente los 1.000 del rango', cod == 0 and total0 - contar('alumnos') == rango == 1000, f'{total0 - contar("alumnos")} eliminados')
p.check('I', 'los alumnos del seed siguen intactos', contar('alumnos', 'id <= 5') == 5)
p.check('D', 'tarda menos de 1 segundo', ms < 1000, f'{ms:.0f} ms')
p.fin(ms)

# p10 ────────────────────────────────────────────────────────────────
p = Prueba('p10', 'Eliminar un rango de registros de una tabla y recuperarlos con ROLLBACK',
           'Comprobar que una eliminación dentro de una transacción se deshace completa con ROLLBACK, incluidas las cascadas.')
p.proc('BEGIN; DELETE de 1.000 alumnos (con sus detalles en cascada); ROLLBACK; se comparan los conteos antes y después.')
a0, d0 = contar('alumnos'), contar('asistencia_detalle')
cod, filas_r, ms, err = psql("""BEGIN;
DELETE FROM alumnos WHERE rut >= '30001000' AND rut < '30002000';
SELECT count(*) FROM alumnos;
DELETE FROM asistencia_cabecera WHERE id = %s;
SELECT count(*) FROM asistencia_detalle;
ROLLBACK;""" % CAB_P3, timing=True)
p.check('I', 'dentro de la transacción los registros desaparecen', len(filas_r) >= 2 and int(filas_r[0]) == a0 - 1000 and int(filas_r[1]) < d0, filas_r)
p.check('TF', 'después del ROLLBACK vuelven todos (alumnos y detalles en cascada)', contar('alumnos') == a0 and contar('asistencia_detalle') == d0,
        f'alumnos {contar("alumnos")}/{a0}, detalles {contar("asistencia_detalle")}/{d0}')
p.fin(ms)

# p11 ────────────────────────────────────────────────────────────────
p = Prueba('p11', 'Actualización a un campo',
           'Actualizar el teléfono de un alumno y validar que las restricciones de tipo se respetan.')
p.proc("UPDATE alumnos SET telefono = '912345678' WHERE id = 1; luego un valor más largo que el campo, que debe rechazarse.")
cod, _, ms, _ = psql("UPDATE alumnos SET telefono = '912345678' WHERE id = 1;", timing=True)
p.check('I', 'el campo queda con el valor nuevo', cod == 0 and valor('SELECT telefono FROM alumnos WHERE id = 1;') == '912345678')
cod, _, _, err = psql("UPDATE alumnos SET telefono = '9123456789012345678' WHERE id = 1;")
p.check('I', 'un valor más largo que el campo (15) se rechaza', cod != 0 and 'too long' in err, err.split('\n')[0][:80])
p.check('D', 'tarda menos de 100 ms', ms < 100, f'{ms:.1f} ms')
p.fin(ms)

# p12 ────────────────────────────────────────────────────────────────
p = Prueba('p12', 'Actualización a un campo - en cascada',
           'Comprobar el comportamiento en cascada de las llaves foráneas: cambiar una llave referenciada no deja huérfanos '
           'y las acciones CASCADE / SET NULL se propagan.')
p.proc('1) UPDATE cursos SET id = 999 WHERE id = 1 (referenciado): debe rechazarse. 2) Una justificación sobre un detalle: al eliminar '
       'la cabecera se eliminan detalle y justificación en cascada. 3) Al eliminar un curso, sus alumnos quedan con id_curso NULL (SET NULL).')
cod, _, _, err = psql('UPDATE cursos SET id = 999 WHERE id = 1;')
p.check('I', 'cambiar la llave de un curso con alumnos se rechaza (sin huérfanos)', cod != 0 and 'foreign key' in err.lower(), err.split('\n')[0][:90])
det = valor(f'SELECT id FROM asistencia_detalle WHERE id_asistencia_cabecera = {CAB_P3} LIMIT 1;')
psql(f"INSERT INTO justificaciones (id_asistencia_detalle, motivo) VALUES ({det}, 'Prueba de cascada');")
cod, filas_r, ms, _ = psql(f"""BEGIN;
DELETE FROM asistencia_cabecera WHERE id = {CAB_P3};
SELECT count(*) FROM asistencia_detalle WHERE id_asistencia_cabecera = {CAB_P3};
SELECT count(*) FROM justificaciones WHERE id_asistencia_detalle = {det};
ROLLBACK;""", timing=True)
p.check('I', 'cabecera → detalle → justificación se eliminan en cascada', filas_r == ['0', '0'], filas_r)
cod, filas_r, _, _ = psql("""BEGIN;
INSERT INTO cursos (nombre, nivel, anio) VALUES ('Curso cascada', 'Básico', 2026);
UPDATE alumnos SET id_curso = (SELECT max(id) FROM cursos) WHERE rut = '30002000-%s';
DELETE FROM cursos WHERE id = (SELECT max(id) FROM cursos);
SELECT coalesce(id_curso::text, 'NULL') FROM alumnos WHERE rut = '30002000-%s';
ROLLBACK;""" % (dv(30002000), dv(30002000)))
p.check('I', 'al eliminar un curso, el alumno queda sin curso (SET NULL) y no se borra', filas_r[-1:] == ['NULL'], filas_r[-1:])
p.fin(ms)

# p13 ────────────────────────────────────────────────────────────────
p = Prueba('p13', 'Actualización a un campo realizando una condición',
           'Marcar presentes solo a los ausentes de una clase que cumplen una condición, como el marcado manual.')
p.proc(f'UPDATE asistencia_detalle SET presente = TRUE, tipo_asistencia = \'manual\' WHERE id_asistencia_cabecera = {CAB_P3} AND NOT presente AND id_alumno IN (1, 2).')
cod, _, ms, _ = psql(f"UPDATE asistencia_detalle SET presente = TRUE, tipo_asistencia = 'manual' "
                     f"WHERE id_asistencia_cabecera = {CAB_P3} AND NOT presente AND id_alumno IN (1, 2);", timing=True)
pres = contar('asistencia_detalle', f'id_asistencia_cabecera = {CAB_P3} AND presente')
aus = contar('asistencia_detalle', f'id_asistencia_cabecera = {CAB_P3} AND NOT presente')
p.check('I', 'solo los 2 alumnos que cumplen la condición cambian', cod == 0 and pres == 2, f'{pres} presentes, {aus} ausentes')
p.check('I', 'el resto de la clase sigue ausente', aus == contar('asistencia_detalle', f'id_asistencia_cabecera = {CAB_P3}') - 2)
p.check('D', 'tarda menos de 100 ms', ms < 100, f'{ms:.1f} ms')
p.fin(ms)

# p14 ────────────────────────────────────────────────────────────────
TABLAS = valor("SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';").split(',')
conteo_sql = ' UNION ALL '.join(f"SELECT '{t}', count(*) FROM {t}" for t in TABLAS) + ';'
p = Prueba('p14', 'Realización de backup de toda la base de datos',
           'Generar un respaldo completo y consistente de la base con pg_dump.')
p.proc('pg_dump -Fc (formato comprimido) de colegio_db; se mide el tiempo y el tamaño, y se lista el contenido con pg_restore -l.')
t = time.time()
cod, _, err = sh(['docker', 'exec', CONT, 'pg_dump', '-U', USR, '-Fc', '-f', '/tmp/respaldo.dump', DB])
ms = (time.time() - t) * 1000
_, size, _ = sh(['docker', 'exec', CONT, 'sh', '-c', 'stat -c %s /tmp/respaldo.dump'])
_, lista, _ = sh(['docker', 'exec', CONT, 'pg_restore', '-l', '/tmp/respaldo.dump'])
tablas_resp = len(re.findall(r' TABLE DATA public ', lista))
p.check('TF', 'el respaldo se genera sin errores', cod == 0, err[:80])
p.check('I', f'incluye los datos de las {len(TABLAS)} tablas', tablas_resp == len(TABLAS), f'{tablas_resp} tablas con datos')
p.check('D', 'tarda menos de 30 segundos', ms < 30000, f'{ms / 1000:.1f} s, {int(size or 0) / 1024:.0f} KB')
p.ev(f'respaldo.dump: {int(size or 0) / 1024:.0f} KB')
p.fin(ms)

# p15 ────────────────────────────────────────────────────────────────
p = Prueba('p15', 'Restauración backup de toda la base de datos',
           'Restaurar el respaldo en una base nueva y comprobar que queda idéntica a la original.')
p.proc('CREATE DATABASE restaurada; pg_restore del respaldo de p14; se comparan los conteos de las tablas una por una.')
psql('DROP DATABASE IF EXISTS restaurada;', db='postgres')
psql('CREATE DATABASE restaurada;', db='postgres')
t = time.time()
cod, _, err = sh(['docker', 'exec', CONT, 'pg_restore', '-U', USR, '-d', 'restaurada', '/tmp/respaldo.dump'])
ms = (time.time() - t) * 1000
_, orig, _, _ = psql(conteo_sql)
_, rest, _, _ = psql(conteo_sql, db='restaurada')
p.check('TF', 'la restauración termina sin errores', cod == 0, err[:80])
p.check('I', f'las {len(TABLAS)} tablas tienen los mismos registros que la original', orig == rest and len(orig) == len(TABLAS),
        f'{sum(int(x.split("|")[1]) for x in rest)} registros restaurados')
fk_o = valor("SELECT count(*) FROM pg_constraint WHERE contype IN ('f','u','p','c');")
fk_r = valor("SELECT count(*) FROM pg_constraint WHERE contype IN ('f','u','p','c');", db='restaurada')
p.check('I', 'se restauran todas las restricciones (PK, FK, UNIQUE, CHECK)', fk_o == fk_r, f'{fk_r} de {fk_o}')
p.check('D', 'tarda menos de 60 segundos', ms < 60000, f'{ms / 1000:.1f} s')
psql('DROP DATABASE IF EXISTS restaurada;', db='postgres')
p.fin(ms)

# p16-p19: sobrecarga ───────────────────────────────────────────────
print('\nPreparando la carga de fondo (pgbench, 40 clientes)...')
psql('DROP DATABASE IF EXISTS carga;', db='postgres')
psql('CREATE DATABASE carga;', db='postgres')
sh(['docker', 'exec', CONT, 'pgbench', '-i', '-q', '-s', '10', '-U', USR, 'carga'], timeout=600)
OPS = {
    'p16': ('Prueba de inserción mientras el sistema está sobrecargado',
            "INSERT INTO intentos_reconocimiento (id_alumno, exito, confianza) VALUES (1, TRUE, 0.9);"),
    'p17': ('Prueba de consulta mientras el sistema está sobrecargado',
            "SELECT a.id, count(ad.id) FROM alumnos a LEFT JOIN asistencia_detalle ad ON ad.id_alumno = a.id WHERE a.id_curso = 1 GROUP BY a.id;"),
    'p18': ('Prueba de actualización mientras el sistema está sobrecargado',
            "UPDATE alumnos SET telefono = '987654321' WHERE id = 2;"),
    'p19': ('Prueba de eliminación mientras el sistema está sobrecargado',
            "DELETE FROM intentos_reconocimiento WHERE id IN (SELECT id FROM intentos_reconocimiento ORDER BY id LIMIT 1);"),
}
base = {k: medir(sql) for k, (_, sql) in OPS.items()}
fondo = subprocess.Popen(['docker', 'exec', CONT, 'pgbench', '-n', '-U', USR, '-c', '40', '-j', '4', '-T', '75', 'carga'],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(5)
bajo = {k: medir(sql, veces=20) for k, (_, sql) in OPS.items()}
salida_fondo = fondo.communicate(timeout=300)[0]
tps_fondo = re.search(r'tps = ([\d.]+)', salida_fondo)
tps_fondo = float(tps_fondo.group(1)) if tps_fondo else 0
for k, (desc, sql) in OPS.items():
    p = Prueba(k, desc, 'Verificar que la operación sigue funcionando y con tiempos aceptables mientras el servidor procesa una carga '
                        'de escritura de 40 clientes concurrentes.')
    p.proc(f'pgbench con 40 clientes ejecuta transacciones de escritura durante 75 s sobre la misma instancia. En paralelo se ejecuta '
           f'20 veces: {sql}')
    ok_b, avg_b, max_b = base[k]
    ok_c, avg_c, max_c = bajo[k]
    p.check('CS', 'las 20 ejecuciones bajo carga terminan sin error', ok_c == 20, f'{ok_c}/20')
    p.check('D', f'tiempo máximo bajo carga menor a {LIMITE_MS} ms', max_c is not None and max_c < LIMITE_MS,
            f'promedio {avg_c:.1f} ms, máximo {max_c:.1f} ms (sin carga: {avg_b:.1f} ms)')
    p.check('CS', 'la carga de fondo se sostuvo durante la prueba', tps_fondo > 100, f'{tps_fondo:.0f} tps de fondo')
    p.ev(f'sin carga {avg_b:.1f} ms · con carga {avg_c:.1f} ms (máx {max_c:.1f} ms) · fondo {tps_fondo:.0f} tps')
    p.fin(avg_c)
cod, filas_r, _, _ = psql("SELECT telefono FROM alumnos WHERE id = 2;")
psql('DROP DATABASE IF EXISTS carga;', db='postgres')

# p20 ────────────────────────────────────────────────────────────────
p = Prueba('p20', 'Prueba de interrupción eléctrica',
           'Simular un corte de energía a mitad de una transacción y comprobar que la base se recupera sola, conserva lo confirmado '
           'y descarta lo que no alcanzó a confirmarse.')
p.proc('Se confirman 1.000 registros (lote A). Se abre otra transacción con 1.000 registros (lote B) sin COMMIT y se apaga el '
       'contenedor de golpe (docker kill -s KILL, equivalente a cortar la luz). Se vuelve a encender y se revisa el estado.')
psql("CREATE TABLE IF NOT EXISTS prueba_corte (id serial PRIMARY KEY, lote text NOT NULL, creado timestamptz DEFAULT now());")
psql("INSERT INTO prueba_corte (lote) SELECT 'A' FROM generate_series(1, 1000);")
abierta = subprocess.Popen(['docker', 'exec', '-i', CONT, 'psql', '-U', USR, '-d', DB],
                           stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True)
abierta.stdin.write("BEGIN;\nINSERT INTO prueba_corte (lote) SELECT 'B' FROM generate_series(1, 1000);\nSELECT pg_sleep(60);\n")
abierta.stdin.flush()
time.sleep(3)
_, en_curso, _, _ = psql("SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pg_sleep%';")
sh(['docker', 'kill', '-s', 'KILL', CONT])
try:
    abierta.kill()
except Exception:
    pass
t = time.time()
sh(['docker', 'start', CONT])
arriba = esperar_bd(90)
ms = (time.time() - t) * 1000
_, logs, logs_err = sh(['docker', 'logs', '--since', '2m', CONT])
logs = logs + logs_err
recup = 'not properly shut down' in logs and 'redo done' in logs
p.check('TF', 'la base vuelve a estar disponible sola tras el corte', arriba, f'{ms / 1000:.1f} s hasta aceptar conexiones')
p.check('TF', 'PostgreSQL aplicó la recuperación automática (WAL)', recup, 'log: "' + next((l.split('LOG:')[-1].strip() for l in logs.splitlines() if 'not properly shut down' in l), '') + '"')
a_n = contar('prueba_corte', "lote = 'A'") if arriba else -1
b_n = contar('prueba_corte', "lote = 'B'") if arriba else -1
p.check('I', 'los 1.000 registros confirmados (lote A) se conservan', a_n == 1000, f'{a_n} de 1000')
p.check('I', 'los registros sin confirmar (lote B) se descartan completos', b_n == 0, f'{b_n} filas del lote B')
cod, _, err = sh(['docker', 'exec', CONT, 'pg_amcheck', '-U', USR, '-d', DB, '--heapallindexed'])
p.check('I', 'pg_amcheck no detecta corrupción en tablas ni índices', cod == 0, err.strip()[:80] or 'sin hallazgos')
p.ev(f'transacción abierta al momento del corte: {en_curso}')
psql('DROP TABLE IF EXISTS prueba_corte;')
p.fin(ms)

# ═══════════════════════════════════════════════════════════════════
salida = sys.argv[1] if len(sys.argv) > 1 else 'resultados_pruebas_bd.json'
meta = {'fecha': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'postgres': valor('SELECT version();'),
        'tablas': len(TABLAS), 'limite_ms': LIMITE_MS}
json.dump({'meta': meta, 'pruebas': resultados}, open(salida, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
tot = sum(len(r['checks']) for r in resultados)
okc = sum(c['ok'] for r in resultados for c in r['checks'])
print(f'\nRESULTADO: {okc}/{tot} verificaciones OK en {len(resultados)} pruebas → {salida}')
sys.exit(0 if okc == tot else 1)
