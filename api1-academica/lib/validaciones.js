// =====================================================
// Validaciones de datos personales en el servidor.
// El formulario ya las hace, pero la API no debe confiar en el
// navegador: también llegan datos por la importación CSV o por
// llamadas directas. Así nunca se guarda HTML ni un RUT inválido.
// =====================================================

// Letras (con tildes y ñ), espacios, apóstrofe (D'Angelo), punto y guion
const NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]{0,59}$/;
const EMAIL  = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const TELEFONO = /^(\+?56)?\s?\d{8,9}$/;

const ETIQUETAS = {
  nombre: 'Nombre', apellido_paterno: 'Apellido paterno',
  apellido_materno: 'Apellido materno', parentesco: 'Parentesco'
};

// RUT chileno con dígito verificador (módulo 11). Acepta 12345678-5 o 12.345.678-5
function rutValido(rut) {
  const limpio = String(rut || '').replace(/\./g, '').trim().toUpperCase();
  const m = /^(\d{7,8})-([\dK])$/.exec(limpio);
  if (!m) return false;
  let suma = 0, mult = 2;
  for (const d of m[1].split('').reverse()) {
    suma += Number(d) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === m[2];
}

/**
 * Revisa los campos de una persona (alumno, profesor o apoderado).
 * Solo valida los campos que vienen con valor.
 * @returns {string|null} el mensaje de error, o null si está todo bien
 */
function validarPersona(datos, { campos = ['nombre', 'apellido_paterno', 'apellido_materno'], validarRut = true } = {}) {
  for (const campo of campos) {
    const valor = datos[campo];
    if (valor === undefined || valor === null || valor === '') continue;
    if (!NOMBRE.test(String(valor).trim())) {
      return `${ETIQUETAS[campo] || campo}: solo se admiten letras, espacios, apóstrofe, punto o guion`;
    }
  }
  if (validarRut && datos.rut && !rutValido(datos.rut)) {
    return 'El RUT no es válido: revisa el formato (12345678-5) y el dígito verificador';
  }
  if (datos.email && !EMAIL.test(String(datos.email).trim())) {
    return 'El email no tiene un formato válido';
  }
  if (datos.telefono && !TELEFONO.test(String(datos.telefono).replace(/[\s-]/g, ''))) {
    return 'El teléfono debe tener 9 dígitos (puede incluir +56)';
  }
  return null;
}

/**
 * Política de contraseñas (la misma que pide el formulario):
 * 8+ caracteres, una mayúscula, un número, un símbolo y sin contener el nombre de usuario.
 * @returns {string|null}
 */
function validarClave(clave, nombreUsuario = '') {
  const c = String(clave || '');
  if (c.length < 8)            return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(c))        return 'La contraseña debe contener al menos una mayúscula';
  if (!/[0-9]/.test(c))        return 'La contraseña debe contener al menos un número';
  if (!/[^a-zA-Z0-9]/.test(c)) return 'La contraseña debe contener al menos un símbolo (!@#$...)';
  if (nombreUsuario && c.toLowerCase().includes(String(nombreUsuario).toLowerCase())) {
    return 'La contraseña no puede contener el nombre de usuario';
  }
  return null;
}

module.exports = { validarPersona, rutValido, validarClave };
