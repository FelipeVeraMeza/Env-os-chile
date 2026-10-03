import { app } from '../app.js';
import { api, archivo, enviarForm, get, post, put } from '../api.js';
import {
  $, $$, badge, comprimirFoto, confirmar, errorToast, esqueleto, fechaHora, html, montar, mostrarBlob, obtenerGps, toast, vacio, ESTADOS,
} from '../ui.js';
import { avisoWhatsapp, direccionTexto, retiroTexto, textoPaquete } from './comun.js';
import { enviarPendientes, entregaPendiente, guardarCopia, guardarEntrega, leerCopia } from '../sin-conexion.js';

// Sin señal se muestra lo último que se vio con conexión (y se avisa).
const sinSenal = (err) => err?.status === 0;
const avisoSinSenal = () => html`<div class="aviso alerta" style="margin-bottom:12px"><b>Sin conexión.</b> Ves lo último que se cargó con señal. Las entregas que hagas se guardan en el teléfono y se envían solas al volver internet.</div>`;

// ================= Ruta del día =================
export async function ruta() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  // Administración también reparte: su ruta son los envíos asignados a sí mismo (abre la vista de entrega).
  const esAdmin = app.usuario.rol === 'admin';
  const propios = esAdmin ? `&repartidor_id=${app.usuario.id}` : '';
  const enlace = (e) => (esAdmin ? `#/entrega/${e.id}` : `#/envio/${e.id}`);
  enviarPendientes();
  let datos;
  let offline = false;
  try {
    datos = await Promise.all([
      get(`/api/envios?estado=asignado,en_ruta,reagendado,fallido&limite=100&orden=ruta${propios}`),
      get(`/api/envios?estado=entregado,devuelto&cerrados=hoy&limite=1${propios}`),
      get('/api/envios/disponibles'),
    ]);
    guardarCopia('ruta', datos);
  } catch (err) {
    datos = sinSenal(err) && leerCopia('ruta');
    if (!datos) throw err;
    offline = true;
  }
  const [activos, hechos, disponibles] = datos;
  const enRuta = activos.items.filter((e) => e.estado === 'en_ruta');
  const porRetirar = activos.items.filter((e) => e.estado !== 'en_ruta');
  // Orden de la ruta (RF-60): flechas para subir o bajar cada parada dentro de su sección (en ruta / por retirar);
  // cada sección se numera desde 1. Antes la numeración era una sola y saltaba (1, 3, 4 arriba y 2 abajo).
  const secciones = [enRuta.map((e) => e.id), porRetirar.map((e) => e.id)];
  const seccionDe = (id) => secciones.find((l) => l.includes(id));
  const mover = async (id, paso) => {
    const lista = seccionDe(id);
    const i = lista.indexOf(id);
    const j = i + paso;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    try { await put('/api/envios/ruta/orden', { ids: secciones.flat() }); ruta(); } catch (err) { errorToast(err); }
  };
  const flechas = (e) => {
    const lista = seccionDe(e.id);
    const i = lista.indexOf(e.id);
    return html`<div class="flechas-ruta"><button class="btn-icono" data-mover="${e.id}" data-paso="-1" aria-label="Subir parada ${i + 1}" ${i === 0 ? html`disabled` : ''}>▲</button>
    <span class="sub">${i + 1}</span><button class="btn-icono" data-mover="${e.id}" data-paso="1" aria-label="Bajar parada ${i + 1}" ${i === lista.length - 1 ? html`disabled` : ''}>▼</button></div>`;
  };
  const tarjeta = (e) => html`<div class="parada">${flechas(e)}<a class="item-envio" href="${enlace(e)}">
    <div><div class="fila"><span class="folio">${e.folio}</span>${e.horario_especial ? html`<span class="badge e-en_ruta">${e.franja_horaria}</span>` : ''}
      ${e.tipo_destino === 'punto_courier' ? html`<span class="badge e-asignado">${e.courier_empresa}</span>` : ''}</div>
      ${e.estado !== 'en_ruta' && e.retiro_calle ? html`<div class="sub">Retirar en: <b>${retiroTexto(e)}</b></div>` : ''}
      <div style="font-size:1.05rem;font-weight:700">${e.calle} ${e.numero}${e.depto ? ', ' + e.depto : ''}</div>
      <div class="dir">${e.comuna_nombre.toUpperCase()} · ${e.destinatario_nombre}</div></div>
    <div class="der">${badge(e.estado)}${e.estado_pago !== 'pagado' ? html`<span class="badge e-pendiente">Sin pagar</span>` : ''}${e.intentos ? html`<span class="sub">Intento ${e.intentos + 1}/${app.conf.operacion.intentos_max}</span>` : ''}</div>
  </a></div>`;
  // Envíos pagados que nadie ha tomado: el repartidor los acepta y pasan a su ruta.
  const libre = (e) => html`<div class="item-envio">
    <div><div class="fila"><span class="folio">${e.folio}</span>${e.horario_especial ? html`<span class="badge e-en_ruta">${e.franja_horaria}</span>` : ''}
      ${e.tipo_destino === 'punto_courier' ? html`<span class="badge e-asignado">${e.courier_empresa}</span>` : ''}</div>
      <div style="font-size:1.05rem;font-weight:700">${e.comuna_nombre.toUpperCase()}</div>
      <div class="dir">${e.retiro_comuna_nombre ? `Retiro en ${e.retiro_comuna_nombre} · ` : ''}${e.calle} ${e.numero} · ${textoPaquete(e)}</div></div>
    <div class="der"><button class="btn chico" data-tomar="${e.id}">Tomar</button></div>
  </div>`;
  montar(vista, html`
    ${offline ? avisoSinSenal() : ''}
    <section class="hero"><p>${new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })}</p>
      <h1>Mi ruta</h1>
      <div class="fila"><span class="badge" style="background:rgba(255,255,255,.2)">${enRuta.length} en ruta</span><span class="badge" style="background:rgba(255,255,255,.2)">${porRetirar.length} por retirar</span><span class="badge" style="background:rgba(255,255,255,.2)">${hechos.total} cerrados hoy</span>${disponibles.total ? html`<span class="badge" style="background:rgba(255,255,255,.2)">${disponibles.total} disponibles</span>` : ''}</div></section>
    <div class="card"><h2>En ruta</h2><div class="lista-envios">${enRuta.length ? enRuta.map(tarjeta) : vacio('No tienes envíos en ruta.')}</div></div>
    <div class="card"><h2>Por retirar / reintentar</h2><div class="lista-envios">${porRetirar.length ? porRetirar.map(tarjeta) : vacio('Sin envíos pendientes de retiro.')}</div></div>
    ${disponibles.autoasignacion || esAdmin ? html`<div class="card"><div class="card-titulo"><h2>Disponibles para tomar</h2><span class="sub">Pagados y sin repartidor</span></div>
      <div class="lista-envios" id="lista-disponibles">${disponibles.items.length ? disponibles.items.slice(0, 10).map(libre) : vacio('No hay envíos nuevos por tomar.')}</div>
      ${disponibles.total > 10 ? html`<button class="btn sec ancho" id="ver-disponibles" style="margin-top:12px">Ver los ${disponibles.total - 10} restantes</button>` : ''}</div>`
    : html`<p class="muted" style="text-align:center">Administración te asigna los envíos: aparecerán aquí cuando te asignen uno.</p>`}`);
  $$('[data-mover]').forEach((b) => { b.onclick = () => mover(Number(b.dataset.mover), Number(b.dataset.paso)); });
  // Los disponibles se muestran de a 10: con muchos, la ruta propia quedaba perdida al final de una lista larga.
  $('#ver-disponibles')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      // Si hay más de los que vinieron en la primera carga, se piden (hasta 500 de una vez).
      const todos = disponibles.total > disponibles.items.length ? (await get('/api/envios/disponibles?limite=500')).items : disponibles.items;
      montar($('#lista-disponibles'), html`${todos.map(libre)}`);
      if (disponibles.total > todos.length) btn.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: `Mostrando ${todos.length} de ${disponibles.total}: toma los primeros para ver más.` }));
      else btn.remove();
      enlazarTomar();
    } catch (err) { errorToast(err); btn.disabled = false; }
  });
  const enlazarTomar = () => $$('[data-tomar]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await post(`/api/envios/${b.dataset.tomar}/tomar`); toast('Envío agregado a tu ruta', 'ok'); ruta(); }
      catch (err) { errorToast(err); ruta(); }
    };
  });
  enlazarTomar();
}

// ================= Detalle para el repartidor: acciones grandes para usar en la calle =================
let temporizador = null;

export async function detalleRepartidor(id) {
  clearInterval(temporizador);
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  let e;
  let offline = false;
  try {
    e = await get(`/api/envios/${id}`);
    guardarCopia(`envio.${id}`, e);
  } catch (err) {
    e = sinSenal(err) && leerCopia(`envio.${id}`);
    if (!e) throw err;
    offline = true;
  }
  const guardada = await entregaPendiente(e.id);
  const op = app.conf.operacion;
  const antesDeRetirar = ['asignado', 'reagendado'].includes(e.estado);
  const espera = op.espera_max_min * 60;
  const segundosDesdeLlegada = () => (e.llegada_en ? Math.floor((Date.now() - new Date(e.llegada_en).getTime()) / 1000) : null);

  montar(vista, html`
    <a href="#/ruta" class="sub" style="text-decoration:none">← Mi ruta</a>
    ${offline ? avisoSinSenal() : ''}
    <div class="encabezado" style="margin-top:6px"><div><h1 class="mono">${e.folio}</h1>
      <div class="fila">${badge(e.estado)} ${e.estado_pago === 'pagado' ? html`<span class="badge e-pagado">Pagado</span>` : html`<span class="badge e-pendiente">Pago pendiente</span>`}
        <span class="sub">Intentos ${e.intentos}/${op.intentos_max}</span></div></div></div>
    ${e.retiro_calle ? html`<div class="card"${antesDeRetirar ? '' : html` style="opacity:.75"`}>
      <div class="card-titulo"><h2>1 · Retirar en</h2>${antesDeRetirar ? '' : html`<span class="badge e-entregado">Retirado</span>`}</div>
      <div style="font-size:1.2rem;font-weight:800">${e.retiro_calle} ${e.retiro_numero}${e.retiro_depto ? ', ' + e.retiro_depto : ''}</div>
      <div style="font-size:1.3rem;font-weight:900">${String(e.retiro_comuna_nombre || '').toUpperCase()}</div>
      ${e.retiro_referencia ? html`<p class="sub">Ref.: ${e.retiro_referencia}</p>` : ''}
      <p>Remitente: <b>${e.cliente_nombre}</b>${e.cliente_telefono ? html` · <a href="tel:${e.cliente_telefono.replace(/\s/g, '')}">${e.cliente_telefono}</a>` : ''}</p>
      ${antesDeRetirar && e.mapas_retiro ? html`<div class="grid g2" style="margin-top:10px">
        <a class="btn blanco" href="${e.mapas_retiro.google}" target="_blank" rel="noopener">Ir a retirar (Google Maps)</a>
        <a class="btn azul" href="${e.mapas_retiro.waze}" target="_blank" rel="noopener">Ir a retirar (Waze)</a></div>` : ''}
    </div>` : ''}
    <div class="card">
      ${e.retiro_calle ? html`<h2>2 · Entregar en</h2>` : ''}
      ${e.tipo_destino === 'punto_courier' ? html`<div class="aviso magenta" style="margin-bottom:10px">Dejar en punto <b>${e.courier_empresa}</b>: ${e.courier_punto}${e.courier_codigo ? ` · código ${e.courier_codigo}` : ''}</div>` : ''}
      ${e.horario_especial ? html`<div class="aviso alerta" style="margin-bottom:10px">Horario especial: <b>${e.franja_horaria}</b></div>` : ''}
      <div style="font-size:1.35rem;font-weight:800">${e.calle} ${e.numero}${e.depto ? ', ' + e.depto : ''}</div>
      <div style="font-size:1.8rem;font-weight:900;letter-spacing:.02em">${e.comuna_nombre.toUpperCase()}</div>
      ${e.referencia ? html`<p class="sub">Ref.: ${e.referencia}</p>` : ''}
      <p><b>${e.destinatario_nombre}</b> · <a href="tel:${e.destinatario_telefono.replace(/\s/g, '')}">${e.destinatario_telefono}</a></p>
      ${e.destinatario_telefono ? html`<a class="btn sec chico" href="${avisoWhatsapp(e, app.conf.negocio)}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}
      <div class="grid g2" style="margin-top:12px">
        <a class="btn blanco grande" href="${e.mapas.google}" target="_blank" rel="noopener">Ir con Google Maps</a>
        <a class="btn azul grande" href="${e.mapas.waze}" target="_blank" rel="noopener">Ir con Waze</a>
      </div>
    </div>
    <div class="card"${antesDeRetirar ? html` style="border-color:var(--magenta-500)"` : ''}>
      <h2>${antesDeRetirar ? 'Paquete a retirar' : 'Paquete'}</h2>
      <div style="font-size:1.1rem;font-weight:800">${textoPaquete(e)}</div>
      ${e.descripcion_producto ? html`<p>Contenido: <b>${e.descripcion_producto}</b></p>` : ''}
      ${e.valor_declarado ? html`<p><span class="badge e-creado">Asegurado</span></p>` : ''}
      ${e.observaciones ? html`<p class="sub">Observaciones: ${e.observaciones}</p>` : ''}
      ${antesDeRetirar ? html`<p class="muted">Revisa que los bultos coincidan antes de retirar. Esta información no va impresa en la etiqueta.</p>` : ''}
    </div>
    <div id="acciones"></div>
    <div class="card"><h2>Historial</h2><ol class="linea-tiempo">${e.historial.map((h) => html`<li><b>${ESTADOS[h.estado_nuevo]}</b>${h.motivo ? html` · <span class="sub">${h.motivo}</span>` : ''}<div class="cuando">${fechaHora(h.fecha)}</div></li>`)}</ol></div>`);

  const acciones = $('#acciones');
  const recargar = () => detalleRepartidor(id);

  if (guardada && e.estado !== 'entregado') {
    montar(acciones, html`<div class="card"><h2>Entrega guardada en el teléfono ✔</h2>
      <p>La registraste sin conexión el ${fechaHora(guardada.hora)}. Se enviará sola apenas vuelva internet; no tienes que hacer nada más.</p>
      <button class="btn sec" id="reintentar">Enviar ahora</button></div>`);
    $('#reintentar').onclick = async () => { await enviarPendientes(); recargar(); };
  } else if (['asignado', 'reagendado'].includes(e.estado)) {
    const pagado = e.estado_pago === 'pagado';
    montar(acciones, html`<div class="card">
      ${pagado ? '' : html`<div class="aviso alerta" style="margin-bottom:12px">Este envío <b>no está pagado</b>: no se puede retirar hasta que el cliente pague.</div>`}
      <button class="btn grande ancho" id="retirar" ${pagado ? '' : html`disabled`}>Retirar y salir a ruta</button></div>`);
    $('#retirar').onclick = async () => {
      try { await post(`/api/envios/${id}/estado`, { estado: 'en_ruta' }); toast('Envío retirado. ¡Buen viaje!', 'ok'); recargar(); } catch (err) { errorToast(err); }
    };
  } else if (e.estado === 'en_ruta') {
    montar(acciones, html`<div class="card">
      ${e.llegada_en ? html`
        <h2 style="text-align:center">Tiempo de espera</h2>
        <div class="cuenta-regresiva"><svg viewBox="0 0 120 120" width="150" height="150"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="10"/>
          <circle id="anillo" cx="60" cy="60" r="52" fill="none" stroke="url(#grad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="0"/>
          <defs><linearGradient id="grad"><stop offset="0" stop-color="#e0218a"/><stop offset="1" stop-color="#6f8bff"/></linearGradient></defs></svg>
          <div class="tiempo" id="reloj">--:--</div></div>
        <p class="sub" style="text-align:center">Máximo ${op.espera_max_min} minutos esperando en el destino.</p>`
        : html`<button class="btn sec grande ancho" id="llegue">📍 Llegué al destino</button>
        <p class="muted" style="text-align:center;margin-top:6px">Inicia el contador de ${op.espera_max_min} minutos de espera.</p>`}
      <div class="grid g2" style="margin-top:14px">
        <button class="btn grande" id="entregar">Entregar</button>
        <button class="btn peligro grande" id="fallido">No se pudo entregar</button>
      </div></div>`);
    $('#llegue')?.addEventListener('click', async () => {
      try { await post(`/api/envios/${id}/llegada`); recargar(); } catch (err) { errorToast(err); }
    });
    if (e.llegada_en) {
      const tick = () => {
        // Si la hora del teléfono va atrasada respecto del servidor, la llegada parece "en el futuro": se limita a la espera
        // completa (antes el contador pasaba de 5:00 y el anillo se salía de escala).
        const restante = Math.min(espera, Math.max(0, espera - segundosDesdeLlegada()));
        const reloj = $('#reloj');
        if (!reloj) return clearInterval(temporizador);
        reloj.textContent = `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}`;
        $('#anillo').setAttribute('stroke-dashoffset', String(326.7 * (1 - restante / espera)));
        if (restante === 0) { reloj.textContent = '¡Tiempo!'; clearInterval(temporizador); }
      };
      tick();
      temporizador = setInterval(tick, 1000);
    }
    $('#entregar').onclick = () => entregar(e, recargar);
    $('#fallido').onclick = () => fallido(e, segundosDesdeLlegada, espera, recargar);
  } else if (e.estado === 'fallido') {
    montar(acciones, html`<div class="aviso alerta">Intento fallido registrado. Administración decidirá si se reagenda (${e.intentos}/${op.intentos_max}) o se devuelve.</div>`);
  } else if (e.estado === 'entregado') {
    const foto = e.adjuntos.find((a) => a.tipo === 'foto_entrega');
    montar(acciones, html`<div class="card"><h2>Entregado ✔</h2><p>${fechaHora(e.entregado_en)}${e.entrega_lat ? ` · GPS ${e.entrega_lat.toFixed(5)}, ${e.entrega_lon.toFixed(5)}` : ''}</p>
      ${foto ? html`<img class="foto-mini" style="width:160px;height:160px" src="${archivo(foto.url)}" alt="Foto de entrega">` : ''}</div>`);
  }
}

// Cierre de entrega: foto OBLIGATORIA; GPS si se puede (opcional salvo que administración lo exija).
// Sin señal, la entrega queda guardada en el teléfono y se envía sola al volver internet.
function entregar(e, recargar) {
  const esDemo = app.conf.auth_mode === 'demo';
  const cont = document.createElement('div');
  cont.className = 'modal-fondo';
  montar(cont, html`<div class="modal"><h2>Cerrar entrega</h2>
    <form class="pila" id="f-ent" novalidate>
      <label class="campo">Foto de la entrega * <small>Obligatoria para terminar la entrega</small>
        <input type="file" name="foto" accept="image/*" capture="environment" required></label>
      <img id="prev" class="foto-mini" style="display:none;width:100%;height:220px" alt="Vista previa de la foto">
      <div class="aviso" id="gps">Obteniendo ubicación GPS…</div>
      ${esDemo ? html`<button type="button" class="btn sec chico" id="gps-demo">Usar ubicación de prueba (solo demo)</button>` : ''}
      <label class="campo">¿Quién recibe? <small>(opcional)</small><input name="receptor" placeholder="Nombre de quien recibe"></label>
      <div class="fila"><button type="button" class="btn sec" id="cancelar">Cancelar</button><button class="btn grande" id="confirmar-ent" disabled>Confirmar entrega</button></div>
    </form></div>`);
  $('#modal-raiz').append(cont);
  let ubic = null;
  let foto = null;
  const listo = () => { $('#confirmar-ent', cont).disabled = !(foto && (ubic || !app.conf.operacion.gps_obligatorio)); };
  const fijarUbic = (u, demo = false) => {
    ubic = u;
    montar($('#gps', cont), html`✔ Ubicación ${demo ? 'de prueba ' : ''}lista: ${u.lat.toFixed(5)}, ${u.lon.toFixed(5)}${u.precision ? ` (±${u.precision} m)` : ''}`);
    $('#gps', cont).className = 'aviso ok';
    listo();
  };
  obtenerGps().then((u) => fijarUbic(u)).catch((err) => {
    const gps = $('#gps', cont);
    gps.className = app.conf.operacion.gps_obligatorio ? 'aviso alerta' : 'aviso';
    gps.textContent = app.conf.operacion.gps_obligatorio ? err.message : `Sin ubicación GPS (${err.message.toLowerCase()}). Puedes confirmar la entrega igual: la foto es lo obligatorio.`;
  });
  $('#gps-demo', cont)?.addEventListener('click', () => fijarUbic({ lat: -33.4263, lon: -70.6170, precision: 25 }, true));
  $('input[name="foto"]', cont).onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    foto = await comprimirFoto(f);
    const img = $('#prev', cont);
    mostrarBlob(img, foto);
    img.style.display = 'block';
    listo();
  };
  $('#cancelar', cont).onclick = () => cont.remove();
  $('#f-ent', cont).onsubmit = async (ev) => {
    ev.preventDefault();
    if (!foto) return toast('La foto es obligatoria para terminar la entrega', 'error');
    const fd = new FormData();
    fd.append('foto', foto, 'entrega.jpg');
    if (ubic) { fd.append('lat', ubic.lat); fd.append('lon', ubic.lon); if (ubic.precision) fd.append('precision', ubic.precision); }
    if (ev.target.receptor.value) fd.append('receptor', ev.target.receptor.value);
    const btn = $('#confirmar-ent', cont);
    btn.disabled = true;
    const guardarSinSenal = async () => {
      await guardarEntrega({ envioId: e.id, foto, lat: ubic?.lat, lon: ubic?.lon, precision: ubic?.precision, receptor: ev.target.receptor.value || null });
      cont.remove();
      toast('Sin señal: la entrega quedó guardada en el teléfono y se enviará sola al volver internet', 'ok');
      recargar();
    };
    try {
      if (!navigator.onLine) return await guardarSinSenal();
      await enviarForm(`/api/envios/${e.id}/entregar`, fd);
      cont.remove();
      toast(ubic ? '¡Entrega registrada con foto y GPS!' : '¡Entrega registrada con foto!', 'ok');
      recargar();
    } catch (err) {
      if (err.status === 0) { try { return await guardarSinSenal(); } catch { /* sin almacenamiento en el teléfono */ } }
      errorToast(err);
      btn.disabled = false;
    }
  };
}

function fallido(e, segundosDesdeLlegada, espera, recargar) {
  const cumplida = e.llegada_en && segundosDesdeLlegada() >= espera;
  const cont = document.createElement('div');
  cont.className = 'modal-fondo';
  montar(cont, html`<div class="modal"><h2>No se pudo entregar</h2>
    <p class="sub">Intento ${e.intentos + 1} de ${app.conf.operacion.intentos_max}. ${e.intentos + 1 >= app.conf.operacion.intentos_max ? 'Es el último intento: el envío deberá devolverse.' : ''}</p>
    <form class="pila" id="f-fal">
      ${Object.entries(app.conf.motivos_fallo).map(([k, v]) => {
        const bloqueado = k === 'espera_excedida' && !cumplida;
        return html`<label class="item-envio" style="cursor:${bloqueado ? 'not-allowed' : 'pointer'};opacity:${bloqueado ? 0.5 : 1}"><div>${v}${bloqueado ? html`<div class="muted">Disponible tras ${app.conf.operacion.espera_max_min} min desde "Llegué"</div>` : ''}</div>
          <input type="radio" name="motivo" value="${k}" ${bloqueado ? html`disabled` : ''} style="width:22px;min-height:22px"></label>`;
      })}
      <label class="campo">Detalle<input name="detalle" placeholder="Opcional"></label>
      <div class="fila"><button type="button" class="btn sec" id="cancelar">Cancelar</button><button class="btn peligro grande">Registrar intento fallido</button></div>
    </form></div>`);
  $('#modal-raiz').append(cont);
  $('#cancelar', cont).onclick = () => cont.remove();
  $('#f-fal', cont).onsubmit = async (ev) => {
    ev.preventDefault();
    const motivo = ev.target.motivo.value;
    if (!motivo) return toast('Selecciona un motivo', 'error');
    if (!(await confirmar('¿Registrar intento fallido?', 'Quedará registrado con tu ubicación.'))) return;
    // Mientras se busca la ubicación (hasta 25 s) el botón queda tomado y avisa: antes no pasaba nada en pantalla
    // y un segundo toque enviaba el intento otra vez.
    const btn = $('button.peligro', ev.target);
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Obteniendo ubicación…';
    const u = await obtenerGps().catch(() => null);
    btn.textContent = 'Registrando…';
    try {
      await post(`/api/envios/${e.id}/estado`, { estado: 'fallido', motivo, detalle: ev.target.detalle.value || undefined, ...(u ? { lat: u.lat, lon: u.lon } : {}) });
      cont.remove();
      toast('Intento fallido registrado', 'ok');
      recargar();
    } catch (err) { errorToast(err); btn.disabled = false; btn.textContent = 'Registrar intento fallido'; }
  };
}

