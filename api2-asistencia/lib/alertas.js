const pool = require('../db/connection');

// R.26 · Alerta de asistencia bajo el umbral (por defecto 85 %, parámetro "umbral_asistencia").
// Se genera una notificación en el sistema para la administración y para el
// profesor jefe del curso, con los datos de contacto del apoderado para que el
// establecimiento lo contacte. Los apoderados no tienen usuario en el sistema,
// por lo que la comunicación final con ellos la realiza el establecimiento.

async function leerUmbral() {
  try {
    const r = await pool.query("SELECT valor FROM parametros_sistema WHERE clave = 'umbral_asistencia'");
    const v = r.rows.length ? parseFloat(r.rows[0].valor) : NaN;
    return isFinite(v) && v > 0 && v <= 100 ? v : 85;
  } catch {
    return 85;
  }
}

// Revisa la asistencia de los alumnos indicados y notifica a quienes están bajo el umbral.
// Nunca lanza: una falla al notificar no debe impedir el registro de la asistencia.
// Devuelve la cantidad de notificaciones creadas.
async function generarAlertas(idsAlumnos) {
  const ids = [...new Set((idsAlumnos || []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return 0;

  try {
    const umbral = await leerUmbral();

    const bajoUmbral = await pool.query(
      `SELECT a.id, a.nombre, a.apellido_paterno, c.nombre AS curso, c.id_profesor_jefe,
              COUNT(ad.id) AS total,
              SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) AS presentes,
              ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) / NULLIF(COUNT(ad.id), 0), 1) AS porcentaje,
              (SELECT string_agg(
                        ap.nombre || ' (' || COALESCE(ap.parentesco, 'apoderado') || ')'
                          || COALESCE(', tel. ' || NULLIF(ap.telefono, ''), '')
                          || COALESCE(', ' || NULLIF(ap.email, ''), ''),
                        '; ')
                 FROM alumnos_apoderados aa JOIN apoderados ap ON ap.id = aa.id_apoderado
                WHERE aa.id_alumno = a.id AND ap.activo = TRUE) AS contacto_apoderado
         FROM alumnos a
         LEFT JOIN cursos c ON c.id = a.id_curso
         JOIN asistencia_detalle ad ON ad.id_alumno = a.id
        WHERE a.id = ANY($1::int[]) AND a.activo = TRUE
        GROUP BY a.id, a.nombre, a.apellido_paterno, c.nombre, c.id_profesor_jefe
       HAVING COUNT(ad.id) > 0
          AND ROUND(100.0 * SUM(CASE WHEN ad.presente THEN 1 ELSE 0 END) / NULLIF(COUNT(ad.id), 0), 1) < $2`,
      [ids, umbral]
    );
    if (bajoUmbral.rows.length === 0) return 0;

    let creadas = 0;
    for (const al of bajoUmbral.rows) {
      // Destinatarios: todos los administradores activos y el usuario del profesor jefe
      const dest = await pool.query(
        `SELECT id FROM usuarios
          WHERE activo = TRUE AND (tipo_persona = 'admin' OR ($1::int IS NOT NULL AND id_profesor = $1))`,
        [al.id_profesor_jefe]
      );
      const titulo = `Alerta de asistencia: ${al.nombre} ${al.apellido_paterno}`.slice(0, 100);
      const mensaje =
        `${al.nombre} ${al.apellido_paterno} (${al.curso || 'sin curso'}) tiene ${al.porcentaje} % de asistencia ` +
        `(${al.presentes} de ${al.total} clases), bajo el mínimo de ${umbral} %. ` +
        (al.contacto_apoderado
          ? `Contactar al apoderado: ${al.contacto_apoderado}.`
          : 'El alumno no tiene apoderado registrado.');

      for (const u of dest.rows) {
        // Una alerta por alumno y destinatario al día, aunque se guarde varias veces
        const ya = await pool.query(
          `SELECT 1 FROM notificaciones
            WHERE id_usuario = $1 AND titulo = $2 AND fecha_envio::date = CURRENT_DATE`,
          [u.id, titulo]
        );
        if (ya.rows.length) continue;
        await pool.query(
          'INSERT INTO notificaciones (id_usuario, titulo, mensaje) VALUES ($1, $2, $3)',
          [u.id, titulo, mensaje]
        );
        creadas++;
      }
    }
    return creadas;
  } catch (err) {
    console.error('[alertas]', err.message);
    return 0;
  }
}

module.exports = { generarAlertas };
