# -*- coding: utf-8 -*-
"""Corre la matriz de pruebas de base de datos de SICAF con un solo comando.

Uso (desde la carpeta del proyecto, en PowerShell o Git Bash):
    python scripts/correr_pruebas_bd.py            → corre todo y al final borra la base de prueba
    python scripts/correr_pruebas_bd.py --dejar    → deja la base de prueba encendida para revisarla
                                                     (puerto 55432, usuario admin, clave pruebas123)

Qué hace, paso a paso:
    1. Borra la base de prueba anterior, si existe. Las pruebas cargan 10.000 alumnos de ejemplo,
       así que siempre hay que partir de una base limpia.
    2. Crea una base PostgreSQL 16 NUEVA en un contenedor aparte (sicaf_pruebas_db), cargada con
       database/init.sql (las 32 tablas) y database/seed.sql (datos de demostración).
       La base real del sistema (colegio_db en el contenedor colegio_db) NO se toca.
    3. Espera a que PostgreSQL termine de crear las tablas.
    4. Ejecuta las 20 pruebas (scripts/pruebas_bd.py) y muestra OK o FALLA en cada verificación.
    5. Guarda los resultados en entregables/fase3/resultados_pruebas_bd.json y borra la base de prueba.

Requisito: Docker Desktop encendido ("Engine running").
"""
import os, subprocess, sys, time

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)   # cada línea se muestra al tiro, en orden
CONTENEDOR = 'sicaf_pruebas_db'
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # carpeta del proyecto
DEJAR = '--dejar' in sys.argv


def docker(*args, mostrar_error=True):
    r = subprocess.run(['docker', *args], capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0 and mostrar_error:
        print('   ' + (r.stderr or r.stdout).strip().splitlines()[-1])
    return r


def paso(n, texto):
    print(f'\n[{n}/5] {texto}')


# ── 0. ¿Está Docker encendido? ───────────────────────────────────────
if docker('info', mostrar_error=False).returncode != 0:
    sys.exit('Docker no responde. Abre Docker Desktop, espera a que diga "Engine running" y vuelve a intentar.')

# ── 1. Base limpia ───────────────────────────────────────────────────
paso(1, 'Borrando la base de prueba anterior (si existe)...')
docker('rm', '-f', CONTENEDOR, mostrar_error=False)
print('   listo')

# ── 2. Crear la base de prueba ───────────────────────────────────────
paso(2, 'Creando una base PostgreSQL nueva con init.sql y seed.sql...')
init_sql = os.path.join(RAIZ, 'database', 'init.sql')
seed_sql = os.path.join(RAIZ, 'database', 'seed.sql')
r = docker('run', '-d', '--name', CONTENEDOR,
           '-e', 'POSTGRES_USER=admin', '-e', 'POSTGRES_PASSWORD=pruebas123', '-e', 'POSTGRES_DB=colegio_db',
           '-p', '55432:5432',
           '-v', f'{init_sql}:/docker-entrypoint-initdb.d/01_init.sql:ro',
           '-v', f'{seed_sql}:/docker-entrypoint-initdb.d/02_seed.sql:ro',
           'postgres:16')
if r.returncode != 0:
    sys.exit('No se pudo crear el contenedor de prueba (¿el puerto 55432 está ocupado?).')
print(f'   contenedor {CONTENEDOR} creado')

# ── 3. Esperar a que termine de crear las tablas ─────────────────────
# PostgreSQL arranca, ejecuta init.sql y seed.sql, y se reinicia. Recién después de la línea
# "init process complete" del log la base está lista para las pruebas.
paso(3, 'Esperando a que PostgreSQL cree las 32 tablas...')
lista = False
for _ in range(120):
    log = docker('logs', CONTENEDOR, mostrar_error=False)
    if 'init process complete' in (log.stdout + log.stderr):
        ok = docker('exec', CONTENEDOR, 'psql', '-U', 'admin', '-d', 'colegio_db', '-tAc',
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'", mostrar_error=False)
        if ok.returncode == 0 and ok.stdout.strip():
            print(f'   base lista: {ok.stdout.strip()} tablas')
            lista = True
            break
    time.sleep(1)
if not lista:
    sys.exit('La base de prueba no terminó de iniciar. Revisa con: docker logs sicaf_pruebas_db')

# ── 4. Ejecutar las 20 pruebas ───────────────────────────────────────
paso(4, 'Ejecutando las 20 pruebas (toma unos 3 minutos: incluye 75 s de sobrecarga y un corte de energía simulado)...')
salida = os.path.join(RAIZ, 'entregables', 'fase3', 'resultados_pruebas_bd.json')
os.makedirs(os.path.dirname(salida), exist_ok=True)
resultado = subprocess.run([sys.executable, os.path.join(RAIZ, 'scripts', 'pruebas_bd.py'), salida])

# ── 5. Limpieza ──────────────────────────────────────────────────────
paso(5, 'Terminando...')
if DEJAR:
    print(f'   La base de prueba sigue encendida en el puerto 55432 (contenedor {CONTENEDOR}).')
    print(f'   Para borrarla después: docker rm -f {CONTENEDOR}')
else:
    docker('rm', '-f', CONTENEDOR, mostrar_error=False)
    print('   base de prueba borrada')
print(f'   resultados guardados en {os.path.relpath(salida, RAIZ)}')
sys.exit(resultado.returncode)
