/**
 * Pruebas automáticas para API 2 - Asistencia
 * Uso: node test-api2.js
 */

require('dotenv').config();
const jwt  = require('jsonwebtoken');
const http = require('http');

const BASE = 'http://localhost:3002';
const HOY  = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// ── Generar token de admin ──────────────────────────────
const TOKEN = jwt.sign(
  { id: 1, nombre_usuario: 'admin', tipo_persona: 'admin', id_rol: 1, id_profesor: null },
  process.env.JWT_SECRET,
  { expiresIn: '8h' }
);

// ── Helper para hacer peticiones HTTP ──────────────────
function peticion(metodo, ruta, body = null) {
  return new Promise((resolve, reject) => {
    const datos  = body ? JSON.stringify(body) : null;
    const url    = new URL(BASE + ruta);
    const opcs   = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method:   metodo,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        ...(datos ? { 'Content-Length': Buffer.byteLength(datos) } : {})
      }
    };

    const req = http.request(opcs, (res) => {
      let respuesta = '';
      res.on('data', chunk => respuesta += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(respuesta) }); }
        catch { resolve({ status: res.statusCode, body: respuesta }); }
      });
    });

    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}

// ── Mostrar resultado de cada prueba ───────────────────
function mostrar(nombre, resultado) {
  const ok = resultado.status >= 200 && resultado.status < 300;
  console.log(`\n${ ok ? '✅' : '❌' } ${nombre}`);
  console.log(`   Estado: ${resultado.status}`);
  console.log(`   Respuesta: ${JSON.stringify(resultado.body, null, 2)
    .split('\n').slice(0, 8).join('\n   ')}`);
}

// ── Pruebas en orden ───────────────────────────────────
async function correr() {
  console.log('==============================================');
  console.log('   PRUEBAS API 2 — ASISTENCIA');
  console.log(`   Fecha de prueba: ${HOY}`);
  console.log('==============================================');

  // 1. Health check
  mostrar('Health check', await peticion('GET', '/health'));

  // 2a. Marcar asistencia clase 1 (3°A, horario 1 = Matemáticas)
  mostrar('Marcar asistencia clase 1 (Matemáticas)', await peticion('POST', '/asistencia/marcar', {
    id_curso:   1,
    id_horario: 1,
    fecha:      HOY,
    alumnos: [
      { id_alumno: 1, presente: true  },
      { id_alumno: 2, presente: true  },
      { id_alumno: 3, presente: true  }
    ]
  }));

  // 2b. Marcar asistencia clase 2 (3°A, horario 2 = Lenguaje) — mismo día
  mostrar('Marcar asistencia clase 2 (Lenguaje)', await peticion('POST', '/asistencia/marcar', {
    id_curso:   1,
    id_horario: 2,
    fecha:      HOY,
    alumnos: [
      { id_alumno: 1, presente: true  },
      { id_alumno: 2, presente: false },  // ausente en Lenguaje
      { id_alumno: 3, presente: true  }
    ]
  }));

  // 3. Ver asistencia del alumno 1
  mostrar('Historial alumno 1', await peticion('GET', '/asistencia/alumno/1'));

  // 4a. Asistencia curso 1 sin filtro → muestra las 2 clases (2 filas por alumno = correcto)
  mostrar(`Asistencia curso 1 SIN id_horario (${HOY}) — espera 6 filas`, await peticion('GET', `/asistencia/curso/1?fecha=${HOY}`));

  // 4b. Asistencia curso 1 CON id_horario → solo Matemáticas (1 fila por alumno)
  mostrar(`Asistencia curso 1 CON id_horario=1 (${HOY}) — espera 3 filas`, await peticion('GET', `/asistencia/curso/1?fecha=${HOY}&id_horario=1`));

  // 5. Ver resumen del día
  mostrar(`Todas las clases del ${HOY}`, await peticion('GET', `/asistencia/fecha?fecha=${HOY}`));

  // 6. Resumen porcentual alumno 1
  mostrar('Resumen asistencia alumno 1', await peticion('GET', '/asistencia/resumen/alumno/1'));

  // 7. Justificar inasistencia del alumno 3 (detalle id=3)
  mostrar('Justificar inasistencia alumno 3', await peticion('POST', '/asistencia/justificar', {
    id_asistencia_detalle: 3,
    motivo: 'Certificado médico'
  }));

  // 8. Ruta que no existe (debe devolver 404)
  mostrar('Ruta inexistente (espera 404)', await peticion('GET', '/ruta-que-no-existe'));

  console.log('\n==============================================\n');
}

correr().catch(err => {
  console.error('\n❌ No se pudo conectar a la API.');
  console.error('   Verifica que Docker esté corriendo: docker-compose ps');
  console.error('   Detalle:', err.message);
});
