/**
 * Pruebas automáticas para API 1 - Académica
 * Uso: node test-api1.js
 */

require('dotenv').config();
const http = require('http');

const BASE = 'http://localhost:3001';
let TOKEN  = '';

// ── Helper para hacer peticiones HTTP ──────────────────
function peticion(metodo, ruta, body = null, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const datos = body ? JSON.stringify(body) : null;
    const url   = new URL(BASE + ruta);
    const opcs  = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method:   metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
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

function mostrar(nombre, resultado) {
  const ok = resultado.status >= 200 && resultado.status < 300;
  console.log(`\n${ok ? '✅' : '❌'} ${nombre}`);
  console.log(`   Estado: ${resultado.status}`);
  console.log(`   Respuesta: ${JSON.stringify(resultado.body, null, 2)
    .split('\n').slice(0, 8).join('\n   ')}`);
  return resultado;
}

async function correr() {
  console.log('==============================================');
  console.log('   PRUEBAS API 1 — ACADÉMICA');
  console.log('==============================================');

  // 1. Health check
  mostrar('Health check', await peticion('GET', '/health', null, ''));

  // 2. Login con credenciales incorrectas (espera 401)
  mostrar('Login incorrecto (espera 401)', await peticion('POST', '/login', {
    nombre_usuario: 'admin',
    password: 'contraseña_mala'
  }, ''));

  // 3. Login correcto con admin
  const loginRes = mostrar('Login admin correcto', await peticion('POST', '/login', {
    nombre_usuario: 'admin',
    password: 'admin123'
  }, ''));

  if (loginRes.status !== 200) {
    console.log('\n❌ No se pudo obtener token. Abortando pruebas restantes.');
    return;
  }
  TOKEN = loginRes.body.token;

  // 4. Login con profesor
  mostrar('Login profesor correcto', await peticion('POST', '/login', {
    nombre_usuario: 'profesor1',
    password: 'profesor123'
  }, ''));

  // 5. Listar alumnos
  mostrar('Listar alumnos', await peticion('GET', '/alumnos'));

  // 6. Listar alumnos del curso 1
  mostrar('Listar alumnos curso 1', await peticion('GET', '/alumnos?id_curso=1'));

  // 7. Obtener alumno por ID
  mostrar('Obtener alumno ID 1', await peticion('GET', '/alumnos/1'));

  // 8. Crear alumno nuevo
  const nuevoAlumno = mostrar('Crear alumno nuevo', await peticion('POST', '/alumnos', {
    rut: '66666666-6',
    nombre: 'Diego',
    apellido_paterno: 'Vargas',
    apellido_materno: 'Torres',
    email: 'dvargas@alumno.cl',
    id_curso: 1
  }));

  // 9. Actualizar el alumno recién creado
  if (nuevoAlumno.status === 201) {
    const idNuevo = nuevoAlumno.body.id;
    mostrar('Actualizar alumno', await peticion('PUT', `/alumnos/${idNuevo}`, {
      telefono: '912345678'
    }));

    // 10. Desactivar alumno
    mostrar('Desactivar alumno', await peticion('DELETE', `/alumnos/${idNuevo}`));
  }

  // 11. Listar cursos
  mostrar('Listar cursos', await peticion('GET', '/cursos'));

  // 12. Obtener curso con sus alumnos
  mostrar('Obtener curso 1 con alumnos', await peticion('GET', '/cursos/1'));

  // 13. Crear curso nuevo
  const nuevoCurso = mostrar('Crear curso nuevo', await peticion('POST', '/cursos', {
    nombre: '5°C',
    nivel: '5°',
    letra: 'C',
    anio: 2025
  }));

  // 14. Listar profesores
  mostrar('Listar profesores', await peticion('GET', '/profesores'));

  // 15. Obtener profesor con sus cursos
  mostrar('Obtener profesor 1 con cursos', await peticion('GET', '/profesores/1'));

  // 16. Ruta inexistente (espera 404)
  mostrar('Ruta inexistente (espera 404)', await peticion('GET', '/ruta-que-no-existe'));

  console.log('\n==============================================\n');
}

correr().catch(err => {
  console.error('\n❌ No se pudo conectar a la API.');
  console.error('   Verifica que Docker esté corriendo: docker-compose ps');
  console.error('   Detalle:', err.message);
});
