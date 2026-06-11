const pool = require('../db/connection');

const ACCIONES = { POST: 'CREAR', PUT: 'EDITAR', PATCH: 'EDITAR', DELETE: 'ELIMINAR' };

// Registra en bitacora_operaciones las escrituras exitosas de esta API.
// Las marcas del token de servicio de API 3 (id 0) no se auditan aquí:
// ya quedan registradas en asistencia_facial_log.
function auditoria(req, res, next) {
  res.on('finish', () => {
    try {
      const verbo = ACCIONES[req.method];
      if (!verbo) return;
      if (res.statusCode >= 400) return;
      if (!req.usuario || !req.usuario.id) return;

      const segmentos = req.path.split('/').filter(Boolean); // ['asistencia','marcar']
      if (segmentos[0] !== 'asistencia') return;

      const sub   = segmentos[1] || '';
      const tabla = sub.startsWith('justifica') ? 'justificaciones' : 'asistencia_detalle';
      const idMatch    = req.path.match(/\/(\d+)(?:\/|$)/);
      const registroId = idMatch ? parseInt(idMatch[1]) : null;

      pool.query(
        `INSERT INTO bitacora_operaciones (id_usuario, accion, tabla_afectada, registro_id)
         VALUES ($1, $2, $3, $4)`,
        [req.usuario.id, `${verbo} asistencia (${sub})`, tabla, registroId]
      ).catch(err => console.error('[auditoria]', err.message));
    } catch (err) {
      console.error('[auditoria]', err.message);
    }
  });
  next();
}

module.exports = auditoria;
