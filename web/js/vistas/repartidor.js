import { app } from '../app.js';
import { api, archivo, enviarForm, get, post, put } from '../api.js';
import {
  $, $$, badge, comprimirFoto, confirmar, errorToast, esqueleto, fechaHora, html, montar, obtenerGps, toast, vacio, ESTADOS,
} from '../ui.js';
import { avisoWhatsapp, direccionTexto } from './comun.js';

// ================= Ruta del día =================
export async function ruta() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const [activos, hechos] = await Promise.all([
    get('/api/envios?estado=asignado,en_ruta,reagendado,fallido&limite=100&orden=ruta'),
    get(`/api/envios?estado=entregado,devuelto&limite=100&desde=${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })}`),
  ]);
  const enRuta = activos.items.filter((e) => e.estado === 'en_ruta');
  const porRetirar = activos.items.filter((e) => e.estado !== 'en_ruta');
  // Orden de la ruta (RF-60): flechas para subir o bajar cada parada; se guarda en el servidor.
  const orden = activos.items.map((e) => e.id);
  const mover = async (id, paso) => {
    const i = orden.indexOf(id);
    const j = i + paso;
    if (j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    try { await put('/api/envios/ruta/orden', { ids: orden }); ruta(); } catch (err) { errorToast(err); }
  };
  const flechas = (e) => html`<div class="flechas-ruta"><button class="btn-icono" data-mover="${e.id}" data-paso="-1" aria-label="Subir parada">▲</button>
    <span class="sub">${orden.indexOf(e.id) + 1}</span><button class="btn-icono" data-mover="${e.id}" data-paso="1" aria-label="Bajar parada">▼</button></div>`;
  const tarjeta = (e) => html`<div class="parada">${flechas(e)}<a class="item-envio" href="#/envio/${e.id}">
    <div><div class="fila"><span class="folio">${e.folio}</span>${e.horario_especial ? html`<span class="badge e-en_ruta">${e.franja_horaria}</span>` : ''}
      ${e.tipo_destino === 'punto_courier' ? html`<span class="badge e-asignado">${e.courier_empresa}</span>` : ''}</div>
      <div style="font-size:1.05rem;font-weight:700">${e.calle} ${e.numero}${e.depto ? ', ' + e.depto : ''}</div>
      <div class="dir">${e.comuna_nombre.toUpperCase()} · ${e.destinatario_nombre}</div></div>
    <div class="der">${badge(e.estado)}${e.estado_pago !== 'pagado' ? html`<span class="badge e-pendiente">Sin pagar</span>` : ''}${e.intentos ? html`<span class="sub">Intento ${e.intentos + 1}/${app.conf.operacion.intentos_max}</span>` : ''}</div>
  </a></div>`;
  montar(vista, html`
    <section class="hero"><p>${new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' })}</p>
      <h1>Mi ruta</h1>
      <div class="fila"><span class="badge" style="background:rgba(255,255,255,.2)">${enRuta.length} en ruta</span><span class="badge" style="background:rgba(255,255,255,.2)">${porRetirar.length} por retirar</span><span class="badge" style="background:rgba(255,255,255,.2)">${hechos.total} cerrados hoy</span></div></section>
    <div class="card"><h2>En ruta</h2><div class="lista-envios">${enRuta.length ? enRuta.map(tarjeta) : vacio('No tienes envíos en ruta.')}</div></div>
    <div class="card"><h2>Por retirar / reintentar</h2><div class="lista-envios">${porRetirar.length ? porRetirar.map(tarjeta) : vacio('Sin envíos pendientes de retiro.')}</div></div>`);
  $$('[data-mover]').forEach((b) => { b.onclick = () => mover(Number(b.dataset.mover), Number(b.dataset.paso)); });
}

// ================= Detalle para el repartidor: acciones grandes para usar en la calle =================
let temporizador = null;

export async function detalleRepartidor(id) {
  clearInterval(temporizador);
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const e = await get(`/api/envios/${id}`);
  const op = app.conf.operacion;
  const espera = op.espera_max_min * 60;
  const segundosDesdeLlegada = () => (e.llegada_en ? Math.floor((Date.now() - new Date(e.llegada_en).getTime()) / 1000) : null);

  montar(vista, html`
    <a href="#/ruta" class="sub" style="text-decoration:none">← Mi ruta</a>
    <div class="encabezado" style="margin-top:6px"><div><h1 class="mono">${e.folio}</h1>
      <div class="fila">${badge(e.estado)} ${e.estado_pago === 'pagado' ? html`<span class="badge e-pagado">Pagado</span>` : html`<span class="badge e-pendiente">Pago pendiente</span>`}
        <span class="sub">Intentos ${e.intentos}/${op.intentos_max}</span></div></div></div>
    <div class="card">
      ${e.tipo_destino === 'punto_courier' ? html`<div class="aviso magenta" style="margin-bottom:10px">Dejar en punto <b>${e.courier_empresa}</b>: ${e.courier_punto}${e.courier_codigo ? ` · código ${e.courier_codigo}` : ''}</div>` : ''}
      ${e.horario_especial ? html`<div class="aviso alerta" style="margin-bottom:10px">Horario especial: <b>${e.franja_horaria}</b></div>` : ''}
      <div style="font-size:1.35rem;font-weight:800">${e.calle} ${e.numero}${e.depto ? ', ' + e.depto : ''}</div>
      <div style="font-size:1.8rem;font-weight:900;letter-spacing:.02em">${e.comuna_nombre.toUpperCase()}</div>
      ${e.referencia ? html`<p class="sub">Ref.: ${e.referencia}</p>` : ''}
      <p><b>${e.destinatario_nombre}</b> · <a href="tel:${e.destinatario_telefono.replace(/\s/g, '')}">${e.destinatario_telefono}</a></p>
      ${e.destinatario_telefono ? html`<a class="btn sec chico" href="${avisoWhatsapp(e, app.conf.negocio)}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}
      <p class="sub">${e.descripcion_producto} · ${e.bultos} bulto(s) · ${e.peso_kg} kg</p>
      <div class="grid g2" style="margin-top:12px">
        <a class="btn blanco grande" href="${e.mapas.google}" target="_blank" rel="noopener">Ir con Google Maps</a>
        <a class="btn azul grande" href="${e.mapas.waze}" target="_blank" rel="noopener">Ir con Waze</a>
      </div>
    </div>
    <div id="acciones"></div>
    <div class="card"><h2>Historial</h2><ol class="linea-tiempo">${e.historial.map((h) => html`<li><b>${ESTADOS[h.estado_nuevo]}</b>${h.motivo ? html` · <span class="sub">${h.motivo}</span>` : ''}<div class="cuando">${fechaHora(h.fecha)}</div></li>`)}</ol></div>`);

  const acciones = $('#acciones');
  const recargar = () => detalleRepartidor(id);

  if (['asignado', 'reagendado'].includes(e.estado)) {
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
        const restante = Math.max(0, espera - segundosDesdeLlegada());
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

// Cierre de entrega: foto OBLIGATORIA + GPS.
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
  obtenerGps().then((u) => fijarUbic(u)).catch((err) => { $('#gps', cont).className = 'aviso alerta'; $('#gps', cont).textContent = err.message; });
  $('#gps-demo', cont)?.addEventListener('click', () => fijarUbic({ lat: -33.4263, lon: -70.6170, precision: 25 }, true));
  $('input[name="foto"]', cont).onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    foto = await comprimirFoto(f);
    const img = $('#prev', cont);
    img.src = URL.createObjectURL(foto);
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
    try { await enviarForm(`/api/envios/${e.id}/entregar`, fd); cont.remove(); toast('¡Entrega registrada con foto y GPS!', 'ok'); recargar(); }
    catch (err) { errorToast(err); btn.disabled = false; }
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
    const u = await obtenerGps().catch(() => null);
    try {
      await post(`/api/envios/${e.id}/estado`, { estado: 'fallido', motivo, detalle: ev.target.detalle.value || undefined, ...(u ? { lat: u.lat, lon: u.lon } : {}) });
      cont.remove();
      toast('Intento fallido registrado', 'ok');
      recargar();
    } catch (err) { errorToast(err); }
  };
}

