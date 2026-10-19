/* ═══════════════════════════════════════════════════════════════
   SICAF-UI.JS — Avisos flotantes y diálogo de confirmación
   Reemplazan alert() y confirm() del navegador (cuadros grises,
   sin estilo) por componentes con la identidad del sistema.
   Estilos en css/sicaf-tema.css
═══════════════════════════════════════════════════════════════ */

const _ICONO_AVISO = { ok: 'ok', error: 'error', aviso: 'alerta', info: 'info' }

/**
 * Muestra un aviso flotante que se cierra solo.
 * @param {string} texto
 * @param {'ok'|'error'|'aviso'|'info'} tipo
 */
function sicafAviso(texto, tipo = 'info') {
  let zona = document.getElementById('sk-avisos')
  if (!zona) {
    zona = document.createElement('div')
    zona.id = 'sk-avisos'
    zona.className = 'sk-avisos'
    document.body.appendChild(zona)
  }
  const aviso = document.createElement('div')
  aviso.className = `sk-aviso ${tipo}`
  aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status')
  aviso.innerHTML = `<i class="im im-${_ICONO_AVISO[tipo] || 'info'}" aria-hidden="true"></i><p></p>
    <button type="button" aria-label="Cerrar aviso"><i class="im im-cerrar" aria-hidden="true"></i></button>`
  aviso.querySelector('p').textContent = texto            // texto plano: nunca se interpreta como HTML
  zona.appendChild(aviso)

  let temporizador
  const cerrar = () => {
    clearTimeout(temporizador)
    aviso.classList.add('saliendo')
    setTimeout(() => aviso.remove(), 220)
  }
  const programar = () => { temporizador = setTimeout(cerrar, tipo === 'error' ? 8000 : 5000) }
  aviso.querySelector('button').addEventListener('click', cerrar)
  aviso.addEventListener('mouseenter', () => clearTimeout(temporizador))   // se queda mientras se lee
  aviso.addEventListener('mouseleave', programar)
  programar()
}

/**
 * Pide confirmación con un diálogo propio. Devuelve una promesa con true / false.
 * La primera línea del texto es el título; el resto, el detalle.
 * Si la acción elimina o revoca algo, el diálogo se muestra en rojo y el foco
 * parte en "Cancelar" para evitar confirmaciones accidentales.
 * @param {string} texto
 * @param {{textoSi?: string, peligro?: boolean}} opciones
 * @returns {Promise<boolean>}
 */
function sicafConfirmar(texto, opciones = {}) {
  const [titulo, ...resto] = String(texto).split('\n')
  const detalle = resto.join('\n').trim()
  const peligro = opciones.peligro ?? /eliminar|revocar|borrar|desactivar/i.test(titulo)
  const verbo = (titulo.match(/¿\s*(\w+)/) || [])[1] || ''
  const textoSi = opciones.textoSi ||
    (peligro && verbo ? `Sí, ${verbo.toLowerCase()}` : 'Confirmar')

  return new Promise(resolver => {
    const dlg = document.createElement('dialog')
    dlg.className = `sk-dialogo${peligro ? ' peligro' : ''}`
    dlg.setAttribute('aria-labelledby', 'sk-dlg-titulo')
    dlg.innerHTML = `
      <div class="sk-dlg-cab">
        <div class="sk-dlg-ico" aria-hidden="true"><i class="im im-${peligro ? 'alerta' : 'info'}"></i></div>
        <h2 id="sk-dlg-titulo"></h2>
      </div>
      <div class="sk-dlg-txt"></div>
      <div class="sk-dlg-pie">
        <button type="button" class="sk-btn sec" value="no">Cancelar</button>
        <button type="button" class="sk-btn pri" value="si"></button>
      </div>`
    dlg.querySelector('h2').textContent = titulo
    const cuerpo = dlg.querySelector('.sk-dlg-txt')
    if (detalle) {
      detalle.split(/\n+/).forEach(linea => {
        const p = document.createElement('p')
        p.textContent = linea
        cuerpo.appendChild(p)
      })
    } else {
      cuerpo.remove()
    }
    dlg.querySelector('.pri').textContent = textoSi
    document.body.appendChild(dlg)

    let respondido = false
    const responder = valor => {
      if (respondido) return
      respondido = true
      if (dlg.open) dlg.close()
      dlg.remove()
      resolver(valor)
    }
    dlg.querySelector('.sec').addEventListener('click', () => responder(false))
    dlg.querySelector('.pri').addEventListener('click', () => responder(true))
    dlg.addEventListener('cancel', e => { e.preventDefault(); responder(false) })        // tecla Esc
    dlg.addEventListener('click', e => { if (e.target === dlg) responder(false) })       // clic fuera del diálogo

    dlg.showModal()
    dlg.querySelector(peligro ? '.sec' : '.pri').focus()
  })
}

// Red de seguridad: cualquier alert() que haya quedado se muestra como aviso del sistema
window.alert = mensaje => sicafAviso(String(mensaje ?? ''), 'info')


/* ── Pantallas vacías ──────────────────────────────────────────────
   Ícono dibujado, una frase que explica y, si corresponde, el botón
   para crear el primer registro. Las opciones las escribe el código
   (no vienen del usuario), por eso se arman como HTML. */
function sicafVacio({ icono = 'carpeta', titulo = 'Sin datos', texto = '', accion = null, compacto = false } = {}) {
  const btn = accion
    ? `<button type="button" class="btn-primary sk-vacio-btn" onclick="${accion.onclick}"><i class="im im-mas" aria-hidden="true"></i> ${accion.texto}</button>`
    : ''
  return `<div class="sk-vacio${compacto ? ' compacto' : ''}">
    <span class="sk-vacio-ico" aria-hidden="true"><i class="im im-${icono}"></i></span>
    <b>${titulo}</b>${texto ? `<p>${texto}</p>` : ''}${btn}</div>`
}
function sicafVacioFila(columnas, opciones) {
  return `<tr class="sk-vacio-fila"><td colspan="${columnas}">${sicafVacio(opciones)}</td></tr>`
}

/* ── Ayudas emergentes de los botones de tabla ─────────────────────
   Los botones de solo ícono llevan title="Editar", "Eliminar"...
   Aquí se muestran como globo propio (al pasar el mouse o con Tab)
   y el texto pasa a aria-label para los lectores de pantalla. */
;(function () {
  const SEL = '.btn-sm[title], .btn-sm[data-tip]'
  let globo = null, actual = null
  function mostrar(el) {
    const texto = el.getAttribute('title') || el.dataset.tip
    if (!texto) return
    if (el.hasAttribute('title')) { el.dataset.tip = texto; el.removeAttribute('title') }   // sin el globo nativo duplicado
    if (!el.textContent.trim() && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', texto)
    if (!globo) {
      globo = document.createElement('div')
      globo.className = 'sk-tip'; globo.setAttribute('role', 'tooltip')
      document.body.appendChild(globo)
    }
    globo.textContent = texto
    globo.classList.add('visible')
    const r = el.getBoundingClientRect(), g = globo.getBoundingClientRect()
    let x = r.left + r.width / 2 - g.width / 2
    x = Math.max(8, Math.min(x, innerWidth - g.width - 8))
    let y = r.top - g.height - 8
    if (y < 8) y = r.bottom + 8
    globo.style.left = x + 'px'; globo.style.top = y + 'px'
    actual = el
  }
  function ocultar() { if (globo) globo.classList.remove('visible'); actual = null }
  document.addEventListener('mouseover', e => {
    const el = e.target.closest && e.target.closest(SEL)
    if (el) { if (el !== actual) mostrar(el) } else if (actual) ocultar()
  })
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest(SEL)
    el ? mostrar(el) : ocultar()
  })
  document.addEventListener('focusout', ocultar)
  document.addEventListener('scroll', ocultar, true)
  document.addEventListener('click', ocultar, true)
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ocultar() })
})()

/* ── Formularios: el error se marca en el campo ────────────────────
   Las validaciones escriben el mensaje en #modal-msg (o en el mensaje
   del formulario de notas). Aquí se detecta a qué campo se refiere,
   se pinta en rojo, se escribe el motivo debajo y se lleva el foco.
   Sirve también para los errores que devuelve el servidor
   ("El RUT ya está registrado"). */
const _CAMPOS_ERROR = [
  ['nombre de usuario', ['nombre_usuario']], ['usuario:', ['nombre_usuario']],
  ['apellido paterno', ['apellido_paterno']], ['apellido materno', ['apellido_materno']],
  ['fecha de nacimiento', ['fecha_nacimiento']], ['edad', ['fecha_nacimiento']],
  ['fechas', ['fecha_inicio', 'fecha_fin']], ['fecha', ['fecha', 'fecha_inicio']],
  ['hora de inicio', ['hora_inicio']], ['hora de fin', ['hora_fin']],
  ['tipo de acceso', ['tipo_persona']], ['nueva contraseña', ['nueva_password']],
  ['contraseña', ['password', 'nueva_password']],
  ['rut', ['rut']], ['email', ['email']], ['correo', ['email']], ['teléfono', ['telefono']],
  ['especialidad', ['especialidad']], ['nivel', ['nivel']], ['letra', ['letra']], ['año', ['anio']],
  ['asignatura', ['id_asignatura']], ['período', ['id_periodo']], ['porcentaje', ['porcentaje']],
  ['profesor', ['id_profesor']], ['curso', ['id_curso']], ['día', ['dia_semana']],
  ['código', ['codigo']], ['capacidad', ['capacidad']], ['horas', ['horas_semanales']],
  ['sala', ['sala']], ['parentesco', ['parentesco']], ['dirección', ['direccion']],
  ['título', ['titulo']], ['contenido', ['contenido']], ['mensaje', ['contenido']],
  ['alumno', ['buscar-alumno']], ['nombre', ['nombre']], ['tipo', ['tipo']]
]

function _campoDelFormulario(caja, sufijo) {
  return caja.querySelector(`#f-${sufijo}, #fn-${sufijo}`)
}

function _limpiarErroresCampo(caja) {
  caja.querySelectorAll('.campo-error-msg').forEach(p => p.remove())
  caja.querySelectorAll('.con-error').forEach(g => g.classList.remove('con-error'))
  caja.querySelectorAll('[aria-invalid="true"]').forEach(c => { c.removeAttribute('aria-invalid'); c.removeAttribute('aria-describedby') })
  caja.querySelectorAll('[data-en-campo]').forEach(m => delete m.dataset.enCampo)
}

function _marcarErrorEnCampo(caja, contenedorMsg, texto) {
  const minus = texto.toLowerCase()
  const encontrados = []
  _CAMPOS_ERROR.forEach(([clave, sufijos]) => {
    const rx = new RegExp(`(^|[^a-záéíóúñü])${clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-záéíóúñü])`, 'i')
    const m = rx.exec(minus)
    if (!m) return
    const campos = sufijos.map(s => _campoDelFormulario(caja, s)).filter(Boolean)
    if (campos.length) encontrados.push({ pos: m.index, largo: clave.length, campos })
  })
  if (!encontrados.length) return
  encontrados.sort((a, b) => a.pos - b.pos || b.largo - a.largo)

  // "RUT, Nombre y Apellido Paterno son obligatorios": se marcan los que están vacíos
  let campos, textoCampo = texto
  const vacio = c => !String(c.value || '').trim()
  if (/obligatori/.test(minus) && (encontrados.length > 1 || encontrados[0].campos.length > 1)) {
    const todos = [...new Set(encontrados.flatMap(e => e.campos))]
    campos = todos.filter(vacio)
    if (!campos.length) campos = [todos[0]]
    if (campos.length > 1) textoCampo = 'Este campo es obligatorio'
  } else {
    campos = [encontrados[0].campos[0]]
  }

  campos.forEach((campo, i) => {
    const grupo = campo.closest('.form-group') || campo.parentElement
    grupo.classList.add('con-error')
    campo.setAttribute('aria-invalid', 'true')
    const p = document.createElement('p')
    p.className = 'campo-error-msg'
    p.id = `err-${campo.id}`
    p.textContent = textoCampo
    campo.insertAdjacentElement('afterend', p)
    campo.setAttribute('aria-describedby', p.id)
    if (i === 0) campo.focus({ preventScroll: false })
    const quitar = () => {
      grupo.classList.remove('con-error'); p.remove()
      campo.removeAttribute('aria-invalid'); campo.removeAttribute('aria-describedby')
      campo.removeEventListener('input', quitar); campo.removeEventListener('change', quitar)
    }
    campo.addEventListener('input', quitar); campo.addEventListener('change', quitar)
  })
  if (campos.length === 1) contenedorMsg.dataset.enCampo = ''   // el mensaje ya se ve junto al campo
}

function _vigilarMensajesModal() {
  const caja = document.getElementById('modal-box')
  if (!caja) return
  new MutationObserver(mutaciones => {
    // Solo interesan los cambios en los contenedores de mensajes (#modal-msg, #msg-modal-notas)
    const msg = mutaciones.map(m => m.target.nodeType === 1 ? m.target : m.target.parentElement)
      .map(n => n && n.closest('#modal-msg, #msg-modal-notas')).find(Boolean)
    if (!msg) return
    _limpiarErroresCampo(caja)
    const error = msg.querySelector('.mensaje-aviso, .mensaje-err')
    if (error) _marcarErrorEnCampo(caja, msg, error.textContent.trim())
  }).observe(caja, { childList: true, subtree: true, characterData: true })

  // Ícono del título según la acción: Nuevo · Editar · Contraseña · otro
  const titulo = document.getElementById('modal-titulo')
  const ico    = document.getElementById('modal-ico')
  if (titulo && ico) {
    const ponerIcono = () => {
      const t = titulo.textContent.trim().toLowerCase()
      const n = /^nuev/.test(t) ? 'mas' : /^editar/.test(t) ? 'lapiz' : /contraseña/.test(t) ? 'llave'
              : /alumnos/.test(t) ? 'alumnos' : /justific/.test(t) ? 'justificacion' : /ficha/.test(t) ? 'medica' : 'nota'
      ico.className = `im im-${n}`
    }
    new MutationObserver(ponerIcono).observe(titulo, { childList: true, characterData: true, subtree: true })
    ponerIcono()
  }

  // Esc cierra el formulario (si no hay un diálogo de confirmación encima)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    const capa = document.getElementById('modal-overlay')
    if (capa && capa.style.display === 'block' && !document.querySelector('dialog[open]') && typeof cerrarModal === 'function') cerrarModal()
  })
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _vigilarMensajesModal)
else _vigilarMensajesModal()
