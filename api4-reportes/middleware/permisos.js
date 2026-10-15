const pool = require('../db/connection');

// R.23 · Un profesor solo consulta reportes de los cursos que le están asignados:
// aquellos donde es profesor jefe o donde tiene al menos un horario de clase.
// El administrador no tiene restricción.

const SQL_CURSOS_DEL_PROFESOR = `
  SELECT c.id FROM cursos c
   WHERE c.id_profesor_jefe = $1
      OR EXISTS (SELECT 1 FROM horarios h WHERE h.id_curso = c.id AND h.id_profesor = $1)`;

const esAdmin = (req) => req.usuario && req.usuario.tipo_persona === 'admin';

function denegar(res) {
  return res.status(403).json({ error: 'No tienes acceso a este curso: no está asignado a tu perfil de profesor' });
}

// Devuelve los ids de curso asignados al profesor autenticado
async function cursosDelProfesor(idProfesor) {
  if (!idProfesor) return [];
  const r = await pool.query(SQL_CURSOS_DEL_PROFESOR, [idProfesor]);
  return r.rows.map(f => f.id);
}

// Fábrica: resuelve el curso a partir del :id de la ruta y verifica la asignación
function permiso(resolverCurso) {
  return async (req, res, next) => {
    try {
      if (esAdmin(req)) return next();
      const id = parseInt(req.params.id);
      if (isNaN(id)) return next();               // la ruta responde su propio 400
      const idCurso = await resolverCurso(id);
      if (idCurso === undefined) return next();   // el recurso no existe: la ruta responde 404
      const asignados = await cursosDelProfesor(req.usuario.id_profesor);
      if (idCurso === null || !asignados.includes(idCurso)) return denegar(res);
      next();
    } catch (err) {
      console.error('[permisos]', err.message);
      res.status(500).json({ error: 'Error al verificar permisos' });
    }
  };
}

const unaFila = async (sql, id, campo) => {
  const r = await pool.query(sql, [id]);
  return r.rows.length ? r.rows[0][campo] : undefined;
};

const permisoCurso   = permiso(async (id) => (await unaFila('SELECT id FROM cursos WHERE id = $1', id, 'id')));
const permisoAlumno  = permiso(async (id) => (await unaFila('SELECT id_curso FROM alumnos WHERE id = $1', id, 'id_curso')));
const permisoHorario = permiso(async (id) => (await unaFila('SELECT id_curso FROM horarios WHERE id = $1', id, 'id_curso')));

module.exports = { permisoCurso, permisoAlumno, permisoHorario, cursosDelProfesor };
