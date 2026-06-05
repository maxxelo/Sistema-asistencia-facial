/**
 * Generador de JWT de prueba
 * Uso: node generar-token.js
 *
 * Genera tokens para admin y profesor sin necesitar API 1.
 * Solo para desarrollo — no usar en producción.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('ERROR: No se encontró JWT_SECRET en el archivo .env');
  process.exit(1);
}

const tokens = {
  admin: jwt.sign(
    { id: 1, nombre_usuario: 'admin', tipo_persona: 'admin', id_rol: 1, id_profesor: null },
    secret,
    { expiresIn: '8h' }
  ),
  profesor: jwt.sign(
    { id: 2, nombre_usuario: 'profesor1', tipo_persona: 'profesor', id_rol: 2, id_profesor: 1 },
    secret,
    { expiresIn: '8h' }
  )
};

console.log('\n========== TOKENS DE PRUEBA ==========\n');
console.log('TOKEN ADMIN:');
console.log(tokens.admin);
console.log('\nTOKEN PROFESOR (id_profesor=1):');
console.log(tokens.profesor);
console.log('\n======================================');
console.log('\nUso en Postman o curl:');
console.log('Header → Authorization: Bearer <token>\n');
