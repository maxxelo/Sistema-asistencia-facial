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
