const pool = require('../db/connection');

// Tabla real que afecta cada recurso de la API
const MAPA_TABLAS = {
  'alumnos':      'alumnos',
  'cursos':       'cursos',
  'profesores':   'profesores',
  'horarios':     'horarios',
  'usuarios':     'usuarios',
  'asignaturas':  'asignaturas',
  'aulas':        'aulas',
  'periodos':     'periodos_academicos',
  'evaluaciones': 'evaluaciones',
  'apoderados':   'apoderados',
  'ficha-medica': 'ficha_medica',
  'comunicados':  'comunicados',
  'parametros':   'parametros_sistema'
};

const ACCIONES = { POST: 'CREAR', PUT: 'EDITAR', PATCH: 'EDITAR', DELETE: 'ELIMINAR' };

// Registra en bitacora_operaciones toda escritura exitosa (POST/PUT/PATCH/DELETE).
// Se ejecuta cuando la respuesta ya terminó: no agrega latencia ni puede
// romper la operación original (los errores solo se loguean en consola).
function auditoria(req, res, next) {
  // Capturar el path ANTES de next() porque Express lo modifica al entrar
  // en sub-routers (e.g. /aulas → / dentro del router montado en /aulas).
  const capturePath = req.path;

  res.on('finish', () => {
    try {
      const verbo = ACCIONES[req.method];
      if (!verbo) return;                          // solo operaciones de escritura
      if (res.statusCode >= 400) return;           // solo operaciones exitosas
      if (!req.usuario || !req.usuario.id) return; // sin usuario real no hay a quién atribuir

      const segmentos = capturePath.split('/').filter(Boolean); // p.ej. ['alumnos','5','reactivar']
      const recurso   = segmentos[0] || '';
      const tabla     = MAPA_TABLAS[recurso];
      if (!tabla) return;                          // rutas no mapeadas (login, health) no se auditan

      const idMatch    = capturePath.match(/\/(\d+)(?:\/|$)/);
      const registroId = idMatch ? parseInt(idMatch[1]) : null;
      // Sub-acción si existe: reactivar, toggle, password, jefe, bulk...
      const extra = segmentos.find(s => isNaN(s) && s !== recurso);
      const accion = `${verbo} ${recurso}${extra ? ` (${extra})` : ''}`;

      pool.query(
        `INSERT INTO bitacora_operaciones (id_usuario, accion, tabla_afectada, registro_id)
         VALUES ($1, $2, $3, $4)`,
        [req.usuario.id, accion, tabla, registroId]
      ).catch(err => console.error('[auditoria]', err.message));
    } catch (err) {
      console.error('[auditoria]', err.message);
    }
  });
  next();
}

module.exports = auditoria;
