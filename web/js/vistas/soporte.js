import { app } from '../app.js';
import { get, patch, post } from '../api.js';
import { $, $$, badge, datosForm, errorToast, esqueleto, fechaHora, html, icono, marcarErrores, modal, montar, toast, vacio } from '../ui.js';

// Soporte (pedido 09-10): el cliente (o cualquiera, desde el inicio de la página) escribe y el mensaje llega a
// administración, que responde en la plataforma. Si la empresa configuró un WhatsApp en Ajustes, también se ofrece.
const ESTADO_TXT = { nuevo: 'Nuevo', respondido: 'Respondido', cerrado: 'Cerrado' };
const CLASE = { nuevo: 'en_ruta', respondido: 'entregado', cerrado: 'anulado' };
const badgeSoporte = (estado) => badge(CLASE[estado], ESTADO_TXT[estado]);
const digitos = (v) => String(v || '').replace(/\D/g, '');

export function enlaceWhatsappSoporte(texto = '') {
  const fono = digitos(app.conf?.negocio?.whatsapp);
  return fono ? `https://wa.me/${fono}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : null;
}

// Tarjeta "¿Necesitas ayuda?" para el inicio del cliente y la pantalla de soporte.
export function tarjetaAyuda() {
  const wa = enlaceWhatsappSoporte(`Hola ${app.conf.negocio.nombre}, necesito ayuda con mis envíos.`);
  return html`<div class="card ayuda"><div><h2>¿Necesitas ayuda?</h2><p class="sub">Escríbenos por cualquier problema con un envío, un pago o tu cuenta.</p></div>
    <div class="fila"><button type="button" class="btn" data-soporte>${icono('soporte')} Escribir a soporte</button>
      ${wa ? html`<a class="btn sec" href="${wa}" target="_blank" rel="noopener">${icono('whatsapp')} WhatsApp</a>` : ''}</div></div>`;
}

// Enlaza los botones [data-soporte] de la pantalla (data-folio opcional) al formulario.
export function enlazarSoporte(raiz = document) {
  $$('[data-soporte]', raiz).forEach((b) => { b.onclick = () => dialogoSoporte({ folio: b.dataset.folio || '' }); });
}

export function dialogoSoporte({ folio = '', alEnviar } = {}) {
  const conSesion = Boolean(app.usuario);
  const wa = enlaceWhatsappSoporte(`Hola ${app.conf?.negocio?.nombre || ''}, necesito ayuda${folio ? ` con el envío ${folio}` : ''}.`);
  const m = modal(html`<h2>Escribir a soporte</h2>
    <p class="sub">Tu mensaje llega a administración. ${conSesion ? 'Verás la respuesta en Soporte, dentro de tu cuenta.' : 'Te respondemos al correo o teléfono que dejes.'}</p>
    <form class="pila" id="f-soporte" novalidate>
      ${conSesion ? '' : html`<label class="campo">Nombre *<input name="nombre" autocomplete="name" maxlength="80"></label>
        <label class="campo">Correo o teléfono *<input name="contacto" autocomplete="email" maxlength="120" placeholder="nombre@correo.cl o +56 9 1234 5678"></label>`}
      <label class="campo">Folio del envío <small>(opcional)</small><input name="folio" value="${folio}" maxlength="20" placeholder="ENV-2026-000123" autocapitalize="characters"></label>
      <label class="campo">Mensaje *<textarea name="mensaje" rows="5" maxlength="2000" placeholder="¿En qué te podemos ayudar?"></textarea></label>
      <button class="btn grande">Enviar mensaje</button>
      ${wa ? html`<a class="btn sec ancho" href="${wa}" target="_blank" rel="noopener">${icono('whatsapp')} Prefiero escribir por WhatsApp</a>` : ''}
    </form>`);
  const f = $('#f-soporte', m.el);
  $(conSesion ? 'textarea' : 'input', f).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = datosForm(f);
    const errores = {};
    if (!conSesion && d.nombre.trim().length < 2) errores.nombre = 'Escribe tu nombre';
    if (!conSesion && !d.contacto.trim()) errores.contacto = 'Escribe tu correo o tu teléfono para responderte';
    if (d.mensaje.trim().length < 5) errores.mensaje = 'Cuéntanos en qué te podemos ayudar';
    if (marcarErrores(f, errores)) return;
    const btn = $('button.btn', f);
    btn.disabled = true;
    try {
      await post('/api/soporte', d);
      m.cerrar();
      toast(conSesion ? 'Mensaje enviado: te responderemos en Soporte' : 'Mensaje enviado: te responderemos pronto', 'ok');
      alEnviar?.();
    } catch (err) { marcarErrores(f, err.detalles); errorToast(err); btn.disabled = false; }
  };
}

const respuestaHtml = (x) => (x.respuesta ? html`<div class="respuesta-soporte"><div class="muted">Respuesta${x.respondido_por ? ` de ${x.respondido_por}` : ''} · ${fechaHora(x.respondido_en)}</div>${x.respuesta}</div>` : '');

// ================= Cliente y repartidor: sus mensajes y las respuestas =================
export async function misMensajes() {
  const vista = $('#vista');
  montar(vista, esqueleto(2));
  const lista = await get('/api/soporte');
  montar(vista, html`
    <div class="encabezado"><div><h1>Soporte</h1><p>Tus mensajes a administración y sus respuestas.</p></div>
      <button class="btn" data-soporte>${icono('nuevo')} Nuevo mensaje</button></div>
    ${lista.length ? html`<div class="pila">${lista.map((x) => html`<div class="card mensaje-soporte">
      <div class="card-titulo"><div><b>${fechaHora(x.creado_en)}</b>${x.folio ? html` · <a class="mono" href="#/seguimiento/${x.folio}">${x.folio}</a>` : ''}</div>${badgeSoporte(x.estado)}</div>
      <p class="texto-mensaje">${x.mensaje}</p>
      ${x.respuesta ? respuestaHtml(x) : html`<p class="muted">Aún sin respuesta: administración la escribirá aquí.</p>`}
    </div>`)}</div>` : html`<div class="card">${vacio('Aún no has escrito a soporte.')}</div>`}
    ${tarjetaAyuda()}`);
  $$('[data-soporte]').forEach((b) => { b.onclick = () => dialogoSoporte({ alEnviar: misMensajes }); });
  app.refrescar = misMensajes;
}

// ================= Administración: bandeja de mensajes =================
const FILTROS = [['abiertos', 'Por atender'], ['nuevo', 'Nuevos'], ['respondido', 'Respondidos'], ['cerrado', 'Cerrados'], ['', 'Todos']];

export async function bandeja(filtro = 'abiertos') {
  const vista = $('#vista');
  if (!$('#lista-soporte')) montar(vista, esqueleto(3));
  const lista = await get(`/api/soporte${filtro ? `?estado=${filtro}` : ''}`);
  montar(vista, html`
    <div class="encabezado"><div><h1>Soporte</h1><p>Mensajes de clientes y visitantes de la página. Respóndelos aquí: el cliente ve la respuesta en su cuenta${app.conf.recuperacion_por_correo ? ' y, si dejó un correo, también le llega por correo' : ''}.</p></div></div>
    <div class="segmentos desplazable" style="margin-bottom:16px">${FILTROS.map(([v, t]) => html`<button type="button" data-filtro="${v}" class="${v === filtro ? 'activo' : ''}">${t}</button>`)}</div>
    <div class="pila" id="lista-soporte">${lista.length ? lista.map((x) => tarjetaMensaje(x)) : html`<div class="card">${vacio(filtro === 'abiertos' ? 'No hay mensajes por atender.' : 'No hay mensajes.')}</div>`}</div>`);
  $$('[data-filtro]').forEach((b) => { b.onclick = () => bandeja(b.dataset.filtro); });
  $$('[data-responder]').forEach((f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const respuesta = f.respuesta.value.trim();
      if (marcarErrores(f, respuesta ? {} : { respuesta: 'Escribe la respuesta' })) return;
      try {
        const r = await post(`/api/soporte/${f.dataset.responder}/responder`, { respuesta });
        toast(r.correo_enviado ? 'Respuesta guardada y enviada por correo' : 'Respuesta guardada', 'ok');
        bandeja(filtro);
        actualizarContadorSoporte();
      } catch (err) { marcarErrores(f, err.detalles); errorToast(err); }
    };
  });
  $$('[data-estado]').forEach((b) => {
    b.onclick = async () => {
      const [id, estado] = b.dataset.estado.split(':');
      try { await patch(`/api/soporte/${id}`, { estado }); toast(estado === 'cerrado' ? 'Mensaje cerrado' : 'Mensaje abierto de nuevo', 'ok'); bandeja(filtro); actualizarContadorSoporte(); }
      catch (err) { errorToast(err); }
    };
  });
  // La actualización automática no borra una respuesta a medio escribir.
  app.refrescar = async () => { if (!$$('[data-responder] textarea').some((t) => t.value !== t.defaultValue)) await bandeja(filtro); };
}

function tarjetaMensaje(x) {
  const fono = digitos(x.contacto);
  const esCorreo = /@/.test(x.contacto || '');
  const saludo = `Hola ${x.nombre}, te escribimos de ${app.conf.negocio.nombre} por tu mensaje${x.folio ? ` sobre el envío ${x.folio}` : ''}.`;
  return html`<div class="card mensaje-soporte">
    <div class="card-titulo"><div><h2 style="margin:0">${x.nombre}</h2>
      <div class="sub">${x.usuario_id ? (x.usuario_rol === 'repartidor' ? 'Repartidor' : 'Cliente') : 'Sin cuenta (desde la página)'}${x.contacto ? html` · ${esCorreo ? html`<a href="mailto:${x.contacto}">${x.contacto}</a>` : x.contacto}` : ''} · ${fechaHora(x.creado_en)}</div></div>
      ${badgeSoporte(x.estado)}</div>
    ${x.folio ? html`<p class="sub">Envío: <a class="mono" href="#/seguimiento/${x.folio}">${x.folio}</a></p>` : ''}
    <p class="texto-mensaje">${x.mensaje}</p>
    ${respuestaHtml(x)}
    ${x.estado === 'cerrado' ? '' : html`<form class="pila" data-responder="${x.id}" novalidate style="margin-top:12px">
      <label class="campo">${x.respuesta ? 'Cambiar la respuesta' : 'Respuesta'}<textarea name="respuesta" rows="3" maxlength="2000">${x.respuesta || ''}</textarea></label>
      <div class="fila"><button class="btn chico">Responder</button>
        ${!esCorreo && fono.length >= 8 ? html`<a class="btn sec chico" target="_blank" rel="noopener" href="https://wa.me/${fono}?text=${encodeURIComponent(saludo)}">${icono('whatsapp')} WhatsApp</a>` : ''}
        <button type="button" class="btn sec chico" data-estado="${x.id}:cerrado">Cerrar (ya atendido)</button></div></form>`}
    ${x.estado === 'cerrado' ? html`<button type="button" class="btn sec chico" style="margin-top:10px" data-estado="${x.id}:nuevo">Abrir de nuevo</button>` : ''}
  </div>`;
}

// Cantidad de mensajes nuevos junto a "Soporte" en el menú de administración (y en "Más" en el celular).
export async function actualizarContadorSoporte() {
  if (app.usuario?.rol !== 'admin') return 0;
  let n = 0;
  try { n = (await get('/api/soporte/nuevos')).nuevos; } catch { return 0; }
  $$('[data-contador-soporte]').forEach((el) => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
  return n;
}
