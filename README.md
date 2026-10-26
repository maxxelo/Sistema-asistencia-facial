# SICAF · Sistema de Control de Asistencia Facial

Sistema web para registrar la asistencia escolar mediante reconocimiento facial, con lista manual de respaldo, gestión académica, reportes en PDF y CSV, y alertas automáticas cuando un alumno baja del 85 % de asistencia.

## Funcionalidades

- **Asistencia por reconocimiento facial** con la webcam del PC o la cámara de un celular (app IP Webcam), más la lista manual para marcar o corregir.
- **Borrador y registro definitivo**: el docente puede guardar y seguir editando; una vez definitiva, la asistencia ya no se modifica.
- **Ventana horaria**: la asistencia se pasa el día de la clase, desde 15 minutos antes del inicio hasta 30 minutos después del término.
- **Gestión académica**: alumnos (también por importación CSV), cursos, profesores, asignaturas, aulas, horarios (con validación de choques), apoderados, períodos y notas.
- **Feriados y días no lectivos**: el colegio registra sus días sin clases, que no cuentan en el porcentaje de asistencia.
- **Reportes**: asistencia por alumno (con rango de fechas) y por curso, libro de clases y boletín en PDF, exportación a CSV y alumnos en riesgo.
- **Alertas**: al registrar la asistencia definitiva se notifica al administrador y al profesor jefe de cada alumno que queda bajo el umbral.
- **Consentimiento biométrico**: el rostro de un alumno solo se registra y reconoce con el consentimiento de su apoderado. Si se revoca, el rostro se elimina.
- **Bitácora** de las operaciones y **notificaciones** dentro del sistema.

## Arquitectura

Microservicios en contenedores Docker:

| Servicio | Puerto | Responsabilidad |
|---|---|---|
| `frontend` (nginx) | 3000 | Interfaz web (HTML, CSS y JavaScript) |
| `api1-academica` | 3001 | Login, alumnos, cursos, profesores, horarios, notas, apoderados, parámetros |
| `api2-asistencia` | 3002 | Registro de asistencia, justificaciones y alertas |
| `api3-facial` | 3003 | Registro de rostros y reconocimiento en vivo por WebSocket |
| `api4-reportes` | 3004 | Reportes PDF y CSV, alumnos en riesgo |
| `postgres` | interno | Base de datos PostgreSQL 16 |
| `adminer` | 8080 | Administración de la base de datos (solo desarrollo) |

El reconocimiento usa **face-api.js** en el navegador: la cámara genera un descriptor numérico de 128 valores y solo ese vector viaja al servidor. **Las imágenes no se guardan.**

## Tecnologías

Node.js y Express · PostgreSQL · WebSocket (`ws`) · face-api.js · PDFKit · Docker Compose · JWT · bcrypt

## Puesta en marcha

Requisitos: Docker Desktop.

```bash
cp .env.example .env        # y edita las claves
docker compose up -d --build
```

- Sistema: http://localhost:3000
- Adminer: http://localhost:8080

La base de datos se crea sola con `database/init.sql` (estructura) y `database/seed.sql` (datos de demostración). Los usuarios iniciales están en `seed.sql`: **cambia sus contraseñas antes de usar el sistema con datos reales.**

## Pruebas automáticas

`scripts/test-sistema.py` recorre las cuatro APIs de extremo a extremo: login, permisos por rol, reglas de asistencia, reconocimiento, consentimiento, reportes, alertas, justificaciones, notas y validación de datos.

Como las pruebas usan los datos de `seed.sql`, se corren en una pila aislada para no tocar la base real:

```bash
docker compose down
docker compose -p sicaf_test up -d
python scripts/test-sistema.py
docker compose -p sicaf_test down -v
docker compose up -d
```

`scripts/correr_pruebas_bd.py` ejecuta la matriz de 20 pruebas de base de datos (concurrencia, carga masiva, respaldo y restauración, sobrecarga y corte de energía) sobre un contenedor PostgreSQL aparte, sin tocar el sistema:

```bash
python scripts/correr_pruebas_bd.py
```

## Seguridad y privacidad

- **Sesiones con JWT**, contraseñas cifradas con bcrypt y política de claves (8 caracteres, mayúscula, número y símbolo).
- **Límite de intentos de login**: 10 fallidos cada 15 minutos por usuario.
- **Permisos por rol** validados en el servidor: un profesor solo ve y registra sus cursos y sus clases.
- **Reglas de negocio en el servidor**, no solo en la pantalla: ventana horaria, asistencia definitiva inmodificable, sin fechas futuras ni feriados, alumnos del curso correcto.
- **Validación de datos**: RUT con dígito verificador, nombres, email y teléfono; se rechazan etiquetas HTML para evitar XSS.
- **Helmet, CORS y límites de solicitudes** en todas las APIs. CORS acepta solo el equipo local y la red privada del colegio: el sistema funciona desde cualquier equipo de la red, nunca desde un sitio externo.
- **Datos biométricos** según las Leyes 19.628 y 21.719: consentimiento del apoderado, solo descriptores numéricos y derecho de cancelación.

## Estructura

```
api1-academica/    API de gestión académica
api2-asistencia/   API de asistencia
api3-facial/       API de reconocimiento facial
api4-reportes/     API de reportes
database/          init.sql, seed.sql y migraciones
frontend/          interfaz web (index.html, css/, js/, assets/)
scripts/           pruebas automáticas y utilidades
docker-compose.yml
```

## Equipo

- Maximiliano Castillo, jefe de proyecto
- Francisco Jara
- Sebastián Hurtado
- Dilan Nuñez, QA
