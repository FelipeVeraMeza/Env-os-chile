import { actualizarContadores, app, ir } from '../app.js';
import { api, enviarForm, get, patch, post, urlApi } from '../api.js';
import {
  $, $$, abrirBlob, badge, botonCopiar, comprimirFoto, confirmar, datosForm, errorToast, esqueleto, fechaHora, html, icono, marcarErrores, modal, montar, mostrarBlob, toast, vacio,
} from '../ui.js';

// Soporte (pedidos 09-10 y 13-10). Cada mensaje es un caso con número (SOP-2026-000045) y una conversación de ida y
// vuelta: el cliente escribe (con foto o PDF si quiere), administración responde (o deja notas internas) y el cliente
// ve el aviso de respuesta nueva. Quien escribió sin cuenta sigue su caso con un enlace privado que le llega por correo.
const MOTIVOS = {
  envio: 'Un envío (retiro, entrega o seguimiento)',
  pago: 'Pago o comprobante',
  reclamo: 'Reclamo o paquete dañado',
  cuenta: 'Mi cuenta',
  otro: 'Otro',
};
const ESTADO_TXT = { nuevo: 'Por responder', respondido: 'Respondido', cerrado: 'Cerrado' };
const CLASE = { nuevo: 'en_ruta', respondido: 'entregado', cerrado: 'anulado' };
const badgeSoporte = (estado) => badge(CLASE[estado], ESTADO_TXT[estado]);
const digitos = (v) => String(v || '').replace(/\D/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const recortar = (t, n = 120) => (String(t || '').length > n ? `${String(t).slice(0, n)}…` : String(t || ''));

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

// Archivo opcional (foto o PDF): las fotos se achican antes de subir (más rápido con poca señal).
async function agregarArchivo(fd, input) {
  const archivo = input?.files?.[0];
  if (archivo) fd.append('archivo', archivo.type.startsWith('image/') ? await comprimirFoto(archivo, 1800, 0.82) : archivo);
}

export async function dialogoSoporte({ folio = '', alEnviar } = {}) {
  const conSesion = Boolean(app.usuario);
  // El cliente elige el envío de una lista (antes escribía el folio a mano).
  const envios = app.usuario?.rol === 'cliente'
    ? (await get('/api/envios?limite=50').catch(() => ({ items: [] }))).items.filter((e) => e.folio) : [];
  const wa = enlaceWhatsappSoporte(`Hola ${app.conf?.negocio?.nombre || ''}, necesito ayuda${folio ? ` con el envío ${folio}` : ''}.`);
  const m = modal(html`<h2>Escribir a soporte</h2>
    <p class="sub">Tu mensaje llega a administración. ${conSesion ? 'Verás la respuesta en Soporte, dentro de tu cuenta.' : 'Te enviamos un número de caso y un enlace para ver la respuesta.'}</p>
    <form class="pila" id="f-soporte" novalidate>
      ${conSesion ? '' : html`<label class="campo">Nombre *<input name="nombre" autocomplete="name" maxlength="80"></label>
        <label class="campo">Correo o teléfono *<input name="contacto" autocomplete="email" maxlength="120" placeholder="nombre@correo.cl o +56 9 1234 5678">
          <small>Con correo te llega el enlace para seguir la conversación</small></label>`}
      <label class="campo">Motivo *<select name="motivo">${Object.entries(MOTIVOS).map(([v, t]) => html`<option value="${v}" ${v === (folio ? 'envio' : 'otro') ? html`selected` : ''}>${t}</option>`)}</select></label>
      ${envios.length ? html`<label class="campo">Envío <small>(opcional)</small><select name="folio"><option value="">Ninguno en particular</option>
          ${envios.map((e) => html`<option value="${e.folio}" ${e.folio === folio ? html`selected` : ''}>${e.folio} · ${e.destinatario_nombre}</option>`)}</select></label>`
        : html`<label class="campo">Folio del envío <small>(opcional)</small><input name="folio" value="${folio}" maxlength="20" placeholder="ENV-2026-000123" autocapitalize="characters"></label>`}
      <label class="campo">Mensaje *<textarea name="mensaje" rows="5" maxlength="2000" placeholder="¿En qué te podemos ayudar?"></textarea></label>
      <label class="campo">Foto o PDF <small>(opcional: por ejemplo, del paquete o del comprobante)</small><input type="file" name="archivo" accept="image/*,application/pdf"></label>
      <button class="btn grande">Enviar mensaje</button>
      ${wa ? html`<a class="btn sec ancho" href="${wa}" target="_blank" rel="noopener">${icono('whatsapp')} Prefiero escribir por WhatsApp</a>` : ''}
    </form>`);
  const f = $('#f-soporte', m.el);
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
      const fd = new FormData();
      for (const [k, v] of Object.entries(d)) fd.append(k, v);
      await agregarArchivo(fd, f.archivo);
      const caso = await enviarForm('/api/soporte', fd);
      m.cerrar();
      alEnviar?.();
      if (conSesion) { toast(`Caso ${caso.folio_caso} creado: te responderemos en Soporte`, 'ok'); ir(`#/soporte/${caso.id}`); }
      else casoCreado(caso, EMAIL.test(d.contacto.trim()));
    } catch (err) { marcarErrores(f, err.detalles); errorToast(err); btn.disabled = false; }
  };
}

// Sin cuenta: el número de caso y el enlace para volver a ver la conversación (también le llega por correo).
function casoCreado(caso, conCorreo) {
  const enlace = `${location.origin}${location.pathname}#/soporte/caso/${caso.token}`;
  const m = modal(html`<h2>Recibimos tu mensaje ✔</h2>
    <p class="sub">Tu número de caso es</p><div class="monto-grande mono">${caso.folio_caso}</div>
    <p class="sub" style="margin-top:12px">${conCorreo ? 'Te enviamos por correo el enlace para ver la respuesta. También puedes guardarlo ahora:' : 'Guarda este enlace: con él ves la respuesta y puedes seguir escribiendo.'}</p>
    <div class="fila"><input readonly value="${enlace}" style="flex:1" aria-label="Enlace del caso">${botonCopiar(enlace, 'enlace')}</div>
    <div class="fila" style="margin-top:14px"><a class="btn" href="#/soporte/caso/${caso.token}" id="ver-caso">Ver mi caso</a></div>`);
  $('#ver-caso', m.el).addEventListener('click', () => m.cerrar());
}

// ================= Listas de casos =================
function itemCaso(c, { admin }) {
  const nuevoParaCliente = !admin && c.no_leido_cliente;
  const quien = c.ultimo_autor === 'admin' ? (admin ? 'Tú' : 'Soporte') : (admin ? c.nombre : 'Tú');
  return html`<a class="item-envio caso-soporte ${nuevoParaCliente ? 'sin-leer' : ''}" href="#/soporte/${c.id}">
    <div><div class="titulo-item"><span class="mono">${c.folio_caso}</span> · ${admin ? c.nombre : c.motivo_texto}
        ${nuevoParaCliente ? html` <span class="badge e-en_ruta">Respuesta nueva</span>` : ''}</div>
      <div class="dir">${admin ? html`${c.motivo_texto}${c.folio ? ` · ${c.folio}` : ''}${c.usuario_id ? '' : ' · sin cuenta'}` : (c.folio ? c.folio : '')}</div>
      <div class="sub">${quien}: ${recortar(c.ultimo_texto) || '(archivo adjunto)'}</div></div>
    <div class="der">${badgeSoporte(c.estado)}<span class="sub">${fechaHora(c.actualizado_en)}</span></div></a>`;
}

// Cliente y repartidor: sus casos.
export async function misMensajes() {
  const vista = $('#vista');
  montar(vista, esqueleto(2));
  const lista = await get('/api/soporte');
  montar(vista, html`
    <div class="encabezado"><div><h1>Soporte</h1><p>Tus conversaciones con administración. Toca un caso para verlo y responder.</p></div>
      <button class="btn" data-nuevo-caso>${icono('nuevo')} Nuevo mensaje</button></div>
    ${lista.length ? html`<div class="lista-envios">${lista.map((c) => itemCaso(c, { admin: false }))}</div>` : html`<div class="card">${vacio('Aún no has escrito a soporte.')}</div>`}
    ${tarjetaAyuda()}`);
  $$('[data-nuevo-caso], [data-soporte]').forEach((b) => { b.onclick = () => dialogoSoporte(); });
  app.refrescar = misMensajes;
}

// Administración: bandeja con filtros por estado y motivo.
const FILTROS = [['abiertos', 'Por atender'], ['nuevo', 'Por responder'], ['respondido', 'Respondidos'], ['cerrado', 'Cerrados'], ['', 'Todos']];

export async function bandeja(filtro = 'abiertos', motivo = '') {
  const vista = $('#vista');
  if (!$('#lista-soporte')) montar(vista, esqueleto(3));
  const qs = new URLSearchParams({ ...(filtro ? { estado: filtro } : {}), ...(motivo ? { motivo } : {}) });
  const lista = await get(`/api/soporte?${qs}`);
  montar(vista, html`
    <div class="encabezado"><div><h1>Soporte</h1><p>Casos de clientes y visitantes. Toca uno para ver la conversación y responder: el cliente ve tu respuesta en su cuenta${app.conf.recuperacion_por_correo ? ' y le llega por correo' : ''}.</p></div>
      <button class="btn sec" id="plantillas">Respuestas rápidas</button></div>
    <div class="fila" style="margin-bottom:16px;align-items:center">
      <div class="segmentos desplazable">${FILTROS.map(([v, t]) => html`<button type="button" data-filtro="${v}" class="${v === filtro ? 'activo' : ''}">${t}</button>`)}</div>
      <select id="filtro-motivo" aria-label="Motivo" style="max-width:260px"><option value="">Todos los motivos</option>
        ${Object.entries(MOTIVOS).map(([v, t]) => html`<option value="${v}" ${v === motivo ? html`selected` : ''}>${t}</option>`)}</select></div>
    <div class="lista-envios" id="lista-soporte">${lista.length ? lista.map((c) => itemCaso(c, { admin: true })) : html`<div class="card">${vacio(filtro === 'abiertos' ? 'No hay casos por atender.' : 'No hay casos.')}</div>`}</div>`);
  $$('[data-filtro]').forEach((b) => { b.onclick = () => bandeja(b.dataset.filtro, motivo); });
  $('#filtro-motivo').onchange = (e) => bandeja(filtro, e.target.value);
  $('#plantillas').onclick = () => gestionarPlantillas();
  app.refrescar = () => bandeja(filtro, motivo);
}

// ================= Conversación =================
// fuente: { tipo: 'sesion', id } (cliente, repartidor o administración) o { tipo: 'enlace', token } (sin cuenta).
const rutaCaso = (f) => (f.tipo === 'sesion' ? `/api/soporte/${f.id}` : `/api/soporte/caso/${f.token}`);

async function blobAdjunto(f, mensajeId) {
  if (f.tipo === 'sesion') return api(`${rutaCaso(f)}/adjuntos/${mensajeId}`, { blob: true });
  const r = await fetch(`${urlApi()}${rutaCaso(f)}/adjuntos/${mensajeId}`);
  if (!r.ok) throw new Error('No se pudo abrir el archivo');
  return r.blob();
}

function burbuja(m, { admin, caso }) {
  const empresa = app.conf?.negocio?.nombre || 'Soporte';
  const autor = m.interno ? `Nota interna${m.autor_nombre ? ` · ${m.autor_nombre}` : ''}`
    : m.autor === 'admin' ? (admin ? (m.autor_nombre || 'Administración') : `Soporte ${empresa}`)
      : (admin ? caso.nombre : 'Tú');
  const lado = admin ? (m.autor === 'admin' ? 'propio' : 'otro') : (m.autor === 'cliente' ? 'propio' : 'otro');
  return html`<div class="burbuja ${lado} ${m.interno ? 'interna' : ''}">
    <div class="meta"><b>${autor}</b> · ${fechaHora(m.creado_en)}</div>
    ${m.texto ? html`<div class="texto-mensaje">${m.texto}</div>` : ''}
    ${m.tiene_adjunto ? (m.adjunto_mime?.startsWith('image/')
      ? html`<button type="button" class="adjunto-img" data-adjunto="${m.id}" aria-label="Ver foto en grande"><img data-img-adjunto="${m.id}" alt="Foto adjunta"></button>`
      : html`<button type="button" class="btn sec chico" data-adjunto="${m.id}">📎 ${m.adjunto_nombre || 'Ver archivo'}</button>`) : ''}
  </div>`;
}

async function pintarConversacion(f) {
  const vista = $('#vista');
  if (!$('#hilo')) montar(vista, esqueleto(3));
  const { caso, mensajes } = f.tipo === 'sesion' ? await get(rutaCaso(f)) : await fetchPublico(rutaCaso(f));
  const admin = app.usuario?.rol === 'admin' && f.tipo === 'sesion';
  const plantillas = admin ? await get('/api/soporte/plantillas').catch(() => []) : [];
  const fono = digitos(caso.contacto);
  const esCorreo = EMAIL.test(caso.contacto || '');
  const saludo = `Hola ${caso.nombre}, te escribimos de ${app.conf.negocio.nombre} por tu caso ${caso.folio_caso}.`;
  montar(vista, html`
    <div class="encabezado"><div>
      ${f.tipo === 'sesion' ? html`<a class="sub" href="#/soporte">← Soporte</a>` : ''}
      <h1>Caso <span class="mono">${caso.folio_caso}</span></h1>
      <p>${caso.motivo_texto}${caso.folio ? html` · envío <a class="mono" href="#/seguimiento/${caso.folio}">${caso.folio}</a>` : ''} · ${badgeSoporte(caso.estado)}</p></div></div>
    ${admin ? html`<div class="card fila entre" style="align-items:center">
      <div><b>${caso.nombre}</b> <span class="sub">${caso.usuario_id ? (caso.usuario_rol === 'repartidor' ? 'Repartidor' : 'Cliente') : 'Sin cuenta'}</span>
        ${caso.contacto ? html`<div class="sub">${esCorreo ? html`<a href="mailto:${caso.contacto}">${caso.contacto}</a>` : caso.contacto}</div>` : ''}</div>
      <div class="fila">
        ${!esCorreo && fono.length >= 8 ? html`<a class="btn sec chico" target="_blank" rel="noopener" href="https://wa.me/${fono}?text=${encodeURIComponent(saludo)}">${icono('whatsapp')} WhatsApp</a>` : ''}
        ${caso.usuario_id ? '' : html`<span class="sub">Enlace del caso</span> ${botonCopiar(caso.enlace, 'enlace del caso')}`}
        <button type="button" class="btn sec chico" id="estado-caso">${caso.estado === 'cerrado' ? 'Abrir de nuevo' : 'Cerrar (ya atendido)'}</button></div></div>` : ''}
    <div class="hilo" id="hilo">${mensajes.map((m) => burbuja(m, { admin, caso }))}</div>
    <form class="card pila" id="f-responder" novalidate>
      ${caso.estado === 'cerrado' && !admin ? html`<p class="sub" style="margin:0">Este caso está cerrado. Si escribes, se abre de nuevo.</p>` : ''}
      ${admin && plantillas.length ? html`<label class="campo">Respuesta rápida<select id="plantilla"><option value="">Elegir…</option>
        ${plantillas.map((p) => html`<option value="${p.id}">${p.titulo}</option>`)}</select></label>` : ''}
      <label class="campo">${admin ? 'Responder' : 'Escribir'}<textarea name="texto" rows="3" maxlength="2000" placeholder="${admin ? 'Escribe la respuesta…' : 'Agrega detalles o responde…'}"></textarea></label>
      <label class="campo">Foto o PDF <small>(opcional)</small><input type="file" name="archivo" accept="image/*,application/pdf"></label>
      ${admin ? html`<label class="interruptor"><input type="checkbox" name="interno"> Nota interna (el cliente no la ve)</label>` : ''}
      <button class="btn">Enviar</button>
    </form>`);

  // Fotos adjuntas a la vista (se piden con la sesión o con el enlace del caso); tocar una la abre en grande.
  $$('[data-img-adjunto]').forEach((img) => { blobAdjunto(f, img.dataset.imgAdjunto).then((b) => mostrarBlob(img, b)).catch(() => { img.alt = 'No se pudo cargar la foto'; }); });
  $$('[data-adjunto]').forEach((b) => { b.onclick = () => abrirBlob(blobAdjunto(f, b.dataset.adjunto)).catch(errorToast); });
  $('#hilo').lastElementChild?.scrollIntoView({ block: 'nearest' });

  const form = $('#f-responder');
  $('#plantilla')?.addEventListener('change', (e) => {
    const p = plantillas.find((x) => String(x.id) === e.target.value);
    if (p) { form.texto.value = form.texto.value ? `${form.texto.value}\n\n${p.texto}` : p.texto; form.texto.focus(); }
    e.target.value = '';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const texto = form.texto.value.trim();
    if (!texto && !form.archivo.files.length) return marcarErrores(form, { texto: 'Escribe un mensaje o adjunta un archivo' });
    const btn = $('button.btn', form);
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append('texto', texto);
      if (admin && form.interno.checked) fd.append('interno', 'true');
      await agregarArchivo(fd, form.archivo);
      const r = await enviarForm(`${rutaCaso(f)}/mensajes`, fd);
      toast(r.interno ? 'Nota interna guardada' : admin ? (r.correo_enviado ? 'Respuesta enviada (también por correo)' : 'Respuesta enviada') : 'Mensaje enviado', 'ok');
      await pintarConversacion(f);
      actualizarContadores();
    } catch (err) { marcarErrores(form, err.detalles); errorToast(err); btn.disabled = false; }
  };
  $('#estado-caso')?.addEventListener('click', async () => {
    const cerrar = caso.estado !== 'cerrado';
    if (cerrar && !(await confirmar('Cerrar caso', 'Ciérralo si ya quedó resuelto. Si el cliente vuelve a escribir, se abre solo.', 'Cerrar'))) return;
    try { await patch(`/api/soporte/${caso.id}`, { estado: cerrar ? 'cerrado' : 'nuevo' }); toast(cerrar ? 'Caso cerrado' : 'Caso abierto de nuevo', 'ok'); await pintarConversacion(f); actualizarContadores(); }
    catch (err) { errorToast(err); }
  });
  // La actualización automática no borra una respuesta a medio escribir.
  app.refrescar = async () => { if (!form.texto.value && !form.archivo.files.length) await pintarConversacion(f); };
  actualizarContadores();
}

async function fetchPublico(ruta) {
  const r = await fetch(`${urlApi()}${ruta}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'No se pudo abrir el caso');
  return d;
}

export const conversacion = (id) => pintarConversacion({ tipo: 'sesion', id });

// Enlace privado del caso (sin cuenta): la misma conversación, sin el menú de la plataforma.
export async function casoPublico(token) {
  try { await pintarConversacion({ tipo: 'enlace', token }); } catch (err) {
    montar($('#vista'), html`<div class="card" style="max-width:560px;margin:0 auto"><h2>No encontramos el caso</h2><p class="sub">${err.message}. Revisa que el enlace esté completo o escríbenos de nuevo.</p>
      <button class="btn" data-soporte>${icono('soporte')} Escribir a soporte</button></div>`);
    enlazarSoporte($('#vista'));
  }
}

// ================= Respuestas rápidas (administración) =================
async function gestionarPlantillas() {
  const lista = await get('/api/soporte/plantillas');
  const m = modal(html`<h2>Respuestas rápidas</h2>
    <p class="sub">Textos que usas seguido: al responder un caso los eliges de una lista.</p>
    <div class="pila" style="margin-bottom:16px">${lista.length ? lista.map((p) => html`<div class="card" style="margin:0;box-shadow:none">
      <div class="fila entre"><b>${p.titulo}</b><button type="button" class="btn peligro chico" data-borrar-plantilla="${p.id}">Borrar</button></div>
      <p class="sub texto-mensaje" style="margin:6px 0 0">${p.texto}</p></div>`) : vacio('Aún no hay respuestas rápidas.')}</div>
    <form class="pila" id="f-plantilla" novalidate>
      <label class="campo">Título *<input name="titulo" maxlength="60" placeholder="Ej. Pago aprobado"></label>
      <label class="campo">Texto *<textarea name="texto" rows="3" maxlength="2000"></textarea></label>
      <button class="btn">Agregar</button></form>`, { ancho: true });
  $$('[data-borrar-plantilla]', m.el).forEach((b) => {
    b.onclick = async () => {
      try { await api(`/api/soporte/plantillas/${b.dataset.borrarPlantilla}`, { metodo: 'DELETE' }); m.cerrar(); toast('Respuesta rápida borrada', 'ok'); gestionarPlantillas(); }
      catch (err) { errorToast(err); }
    };
  });
  $('#f-plantilla', m.el).onsubmit = async (e) => {
    e.preventDefault();
    try { await post('/api/soporte/plantillas', datosForm(e.target)); m.cerrar(); toast('Respuesta rápida guardada', 'ok'); gestionarPlantillas(); }
    catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
  };
}

// Número junto a "Soporte" en el menú: para administración, los casos por responder; para el cliente y el
// repartidor, las respuestas que aún no ha visto.
export async function actualizarContadorSoporte() {
  if (!app.usuario) return 0;
  let n = 0;
  try {
    n = app.usuario.rol === 'admin' ? (await get('/api/soporte/nuevos')).nuevos : (await get('/api/soporte/sin-leer')).sin_leer;
  } catch { return 0; }
  $$('[data-contador-soporte]').forEach((el) => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
  return n;
}
