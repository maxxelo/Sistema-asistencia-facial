// =====================================================
// Rechaza etiquetas HTML en los datos que se escriben (POST, PUT, PATCH).
// Defensa contra XSS guardado: si alguien envía "<script>" o "<img onerror=...>"
// en un nombre, comunicado o motivo, no llega a la base de datos.
// Un "<" suelto ("nota < 4", "<3") sí se permite: solo se bloquea lo que parece etiqueta.
// =====================================================
const CAMPOS_EXENTOS = new Set(['password', 'nueva_password']);   // la clave puede tener cualquier símbolo
const PARECE_HTML = /<\s*[a-z!\/?]/i;

function buscarHtml(valor, clave) {
  if (typeof valor === 'string') {
    return !CAMPOS_EXENTOS.has(clave) && PARECE_HTML.test(valor) ? (clave || 'texto') : null;
  }
  if (Array.isArray(valor)) {
    for (const v of valor) { const c = buscarHtml(v, clave); if (c) return c; }
    return null;
  }
  if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) { const c = buscarHtml(v, k); if (c) return c; }
  }
  return null;
}

module.exports = function sinHtml(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const campo = buscarHtml(req.body, '');
  if (campo) {
    return res.status(400).json({ error: `El campo "${campo}" no puede contener etiquetas HTML` });
  }
  next();
};
