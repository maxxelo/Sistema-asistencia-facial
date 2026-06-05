// Importa la conexión a PostgreSQL
const pool = require('../db/connection')

// Función que compara dos descriptores faciales
// Calcula la distancia euclidiana entre dos vectores
// Si la distancia es menor a 0.6 → es la misma persona
function calcularDistancia(descriptor1, descriptor2) {
  // Suma las diferencias al cuadrado entre cada par de valores
  let suma = 0
  for (let i = 0; i < descriptor1.length; i++) {
    suma += Math.pow(descriptor1[i] - descriptor2[i], 2)
  }
  // Retorna la raíz cuadrada de la suma
  return Math.sqrt(suma)
}

// Función principal que busca el alumno en la BD
async function buscarAlumno(descriptorRecibido) {
  // Obtiene todos los rostros registrados en la BD
  const resultado = await pool.query(`
    SELECT r.id_alumno, r.descriptor_facial,
           a.nombre, a.apellido_paterno, a.rut
    FROM rostros r
    JOIN alumnos a ON r.id_alumno = a.id
    WHERE r.activo = TRUE
  `)

  // Si no hay rostros registrados
  if (resultado.rows.length === 0) {
    return null
  }

  let mejorCoincidencia = null
  let menorDistancia = Infinity

  // Compara el descriptor recibido con cada rostro en la BD
  for (const fila of resultado.rows) {
    // pg devuelve FLOAT[] como array de JS directamente, pero por seguridad
    // nos aseguramos que sea un array de números
    const descriptorBD = Array.isArray(fila.descriptor_facial)
      ? fila.descriptor_facial.map(Number)
      : fila.descriptor_facial

    const distancia = calcularDistancia(
      descriptorRecibido,
      descriptorBD
    )

    // Guarda la coincidencia con menor distancia
    if (distancia < menorDistancia) {
      menorDistancia = distancia
      mejorCoincidencia = {
        id_alumno: fila.id_alumno,
        nombre: fila.nombre,
        apellido_paterno: fila.apellido_paterno,
        rut: fila.rut,
        distancia: distancia
      }
    }
  }

  // Umbral de 0.6 — si la distancia es mayor, no se reconoce
  const UMBRAL = 0.6
  if (menorDistancia > UMBRAL) {
    return null
  }

  return mejorCoincidencia
}

// Guarda el descriptor facial de un alumno en la BD
// Recibe: id_alumno (número) + descriptor (array de 128 floats)
async function registrarRostro(idAlumno, descriptor) {
  // Verifica que el alumno existe
  const alumno = await pool.query(
    'SELECT id FROM alumnos WHERE id = $1',
    [idAlumno]
  )
  if (alumno.rows.length === 0) {
    throw new Error('Alumno no encontrado')
  }

  // Inserta o actualiza el rostro (un alumno solo tiene un rostro)
  await pool.query(`
    INSERT INTO rostros (id_alumno, descriptor_facial, activo)
    VALUES ($1, $2, TRUE)
    ON CONFLICT (id_alumno)
    DO UPDATE SET descriptor_facial = $2, activo = TRUE, fecha_captura = NOW()
  `, [idAlumno, descriptor])
}

module.exports = { buscarAlumno, registrarRostro }