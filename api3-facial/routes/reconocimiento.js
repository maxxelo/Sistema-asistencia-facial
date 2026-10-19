// Importa la conexión a PostgreSQL
const pool = require('../db/connection')

// Face-api.js genera descriptores de 128 dimensiones
const TAMANO_DESCRIPTOR = 128
// Máximo de capturas guardadas por alumno (mejora la robustez ante luz/ángulo)
const MAX_DESCRIPTORES = 5

// ── Umbral configurable ─────────────────────────────────
// Se lee de la tabla configuracion_biometrica (editable desde
// la pestaña Configuración del frontend) con caché de 30 segundos
// para no consultar la BD en cada frame.
let umbralCache = { valor: 0.6, leido: 0 }

async function obtenerUmbral() {
  if (Date.now() - umbralCache.leido < 30000) return umbralCache.valor
  try {
    const r = await pool.query(
      'SELECT umbral_confianza FROM configuracion_biometrica WHERE id = 1'
    )
    const valor = r.rows.length ? parseFloat(r.rows[0].umbral_confianza) : NaN
    umbralCache = { valor: isFinite(valor) && valor > 0 ? valor : 0.6, leido: Date.now() }
  } catch (err) {
    console.error('[umbral biométrico]', err.message)
    umbralCache.leido = Date.now() // no reintentar en cada frame si la BD falla
  }
  return umbralCache.valor
}

// Distancia euclidiana entre dos descriptores faciales
function calcularDistancia(descriptor1, descriptor2) {
  let suma = 0
  for (let i = 0; i < descriptor1.length; i++) {
    suma += Math.pow(descriptor1[i] - descriptor2[i], 2)
  }
  return Math.sqrt(suma)
}

function esDescriptorValido(d) {
  return Array.isArray(d) &&
         d.length === TAMANO_DESCRIPTOR &&
         d.every(n => typeof n === 'number' && isFinite(n))
}

// El campo rostros.descriptor_facial guarda de 1 a 5 descriptores
// concatenados (multiplos de 128 floats). Esta función los separa.
function partirDescriptores(plano) {
  const lista = []
  for (let i = 0; i + TAMANO_DESCRIPTOR <= plano.length; i += TAMANO_DESCRIPTOR) {
    lista.push(plano.slice(i, i + TAMANO_DESCRIPTOR))
  }
  return lista
}

// ── Buscar al alumno comparando contra todos los rostros ──
// Devuelve { alumno, distancia }:
//   alumno    → datos del alumno si la menor distancia está bajo el umbral, si no null
//   distancia → la menor distancia encontrada (para registrar la confianza del intento)
//   idCurso   → si viene, solo se compara contra los alumnos de ese curso: es más rápido,
//               baja los falsos positivos y nunca marca a un alumno de otro curso
async function buscarAlumno(descriptorRecibido, idCurso = null) {
  const resultado = await pool.query(`
    SELECT r.id_alumno, r.descriptor_facial,
           a.nombre, a.apellido_paterno, a.rut
    FROM rostros r
    JOIN alumnos a ON r.id_alumno = a.id
    WHERE r.activo = TRUE AND a.activo = TRUE
      AND a.consentimiento_biometrico = TRUE   -- sin consentimiento no se reconoce (R.40)
      AND ($1::int IS NULL OR a.id_curso = $1)
  `, [idCurso])

  if (resultado.rows.length === 0) {
    return { alumno: null, distancia: null }
  }

  let mejorCoincidencia = null
  let menorDistancia = Infinity

  for (const fila of resultado.rows) {
    const plano = Array.isArray(fila.descriptor_facial)
      ? fila.descriptor_facial.map(Number)
      : []

    // Comparar contra cada captura guardada del alumno y quedarse con la mejor
    for (const candidato of partirDescriptores(plano)) {
      const distancia = calcularDistancia(descriptorRecibido, candidato)
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
  }

  const umbral = await obtenerUmbral()
  const distanciaFinal = isFinite(menorDistancia) ? menorDistancia : null

  if (!mejorCoincidencia || menorDistancia > umbral) {
    return { alumno: null, distancia: distanciaFinal }
  }
  return { alumno: mejorCoincidencia, distancia: distanciaFinal }
}

// ── Guardar el/los descriptores faciales de un alumno ──
// Acepta de 1 a 5 capturas; se guardan concatenadas en un solo FLOAT[].
// Devuelve cuántas capturas quedaron registradas.
async function registrarRostro(idAlumno, descriptores) {
  const alumno = await pool.query(
    'SELECT id, activo, consentimiento_biometrico FROM alumnos WHERE id = $1',
    [idAlumno]
  )
  if (alumno.rows.length === 0) throw new Error('Alumno no encontrado')
  if (!alumno.rows[0].activo)   throw new Error('El alumno está inactivo')
  // R.40 · Leyes 19.628 y 21.719: el alumno es menor de edad y su dato biométrico
  // solo puede tratarse con el consentimiento de su apoderado.
  if (!alumno.rows[0].consentimiento_biometrico) {
    const err = new Error('El alumno no tiene el consentimiento de su apoderado para el tratamiento de datos biométricos')
    err.codigo = 'SIN_CONSENTIMIENTO'
    throw err
  }

  if (!Array.isArray(descriptores) || descriptores.length === 0) {
    throw new Error('Se requiere al menos un descriptor facial')
  }
  const lista = descriptores.slice(0, MAX_DESCRIPTORES)
  for (const d of lista) {
    if (!esDescriptorValido(d)) {
      throw new Error(`Cada descriptor debe ser un arreglo de ${TAMANO_DESCRIPTOR} números`)
    }
  }

  const plano = lista.flat()
  await pool.query(`
    INSERT INTO rostros (id_alumno, descriptor_facial, activo)
    VALUES ($1, $2, TRUE)
    ON CONFLICT (id_alumno)
    DO UPDATE SET descriptor_facial = $2, activo = TRUE, fecha_captura = NOW()
  `, [idAlumno, plano])

  return lista.length
}

// ── Log técnico de intentos (tabla intentos_reconocimiento) ──
// Registra éxitos y fallos del motor para depuración y estadísticas.
// Nunca lanza error: un fallo del log no debe cortar el reconocimiento.
async function registrarIntento(idAlumno, exito, confianza) {
  try {
    await pool.query(
      `INSERT INTO intentos_reconocimiento (id_alumno, exito, confianza)
       VALUES ($1, $2, $3)`,
      [idAlumno, exito, confianza]
    )
  } catch (err) {
    console.error('[intentos_reconocimiento]', err.message)
  }
}

module.exports = { buscarAlumno, registrarRostro, registrarIntento }
