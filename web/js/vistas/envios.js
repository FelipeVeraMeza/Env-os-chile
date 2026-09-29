import { app, ir } from '../app.js';
import { api, archivo, enviarForm, get, post, urlApi } from '../api.js';
import {
  $, $$, abrirBlob, badge, badgePago, clp, confirmar, datosForm, errorToast, esqueleto, fechaHora, hoyISO, html, icono, marcarErrores, modal, montar, toast, vacio, ESTADOS,
} from '../ui.js';
import { itemEnvio } from './comun.js';
import { detalleRepartidor } from './repartidor.js';

// ================= Registro de envíos (búsqueda, filtros, exportación) =================
export async function registro() {
  const vista = $('#vista');
  const rol = app.usuario.rol;
  const f = { q: '', estado: '', pagina: 1, repartidor_id: '', desde: '', hasta: '' };
  const repartidores = rol === 'admin' ? await get('/api/usuarios/repartidores') : [];

  const qs = () => new URLSearchParams(Object.entries({ ...f, limite: 20 }).filter(([, v]) => v !== '' && v !== null)).toString();

  montar(vista, html`
    <div class="encabezado"><div><h1>${rol === 'cliente' ? 'Mis envíos' : rol === 'repartidor' ? 'Historial de entregas' : 'Registro de envíos'}</h1>
      <p>Busca por folio, nombre, teléfono, calle o comuna.</p></div>
      ${rol !== 'repartidor' ? html`<div class="fila"><button class="btn sec" id="exportar">Exportar a Excel (CSV)</button>${rol !== 'repartidor' ? html`<a class="btn" href="#/nuevo">${icono('nuevo')} Nuevo envío</a>` : ''}</div>` : ''}</div>
    <form class="card" id="filtros" style="margin-bottom:16px">
      <div class="grid ${rol === 'admin' ? 'g4' : 'g3'}">
        <label class="campo">Buscar<input type="search" name="q" placeholder="ENV-2026-…, nombre, teléfono"></label>
        <label class="campo">Estado<select name="estado"><option value="">Todos</option>${Object.entries(ESTADOS).filter(([k]) => k !== 'borrador').map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
        ${rol === 'admin' ? html`<label class="campo">Repartidor<select name="repartidor_id"><option value="">Todos</option><option value="sin">Sin asignar</option>${repartidores.map((r) => html`<option value="${r.id}">${r.nombre}</option>`)}</select></label>` : ''}
        <div class="grid g2"><label class="campo">Desde<input type="date" name="desde"></label><label class="campo">Hasta<input type="date" name="hasta" max="${hoyISO()}"></label></div>
      </div>
    </form>
    <div id="resultado">${esqueleto(4)}</div>`);

  async function cargar() {
    try {
      const r = await get(`/api/envios?${qs()}`);
      const paginas = Math.max(1, Math.ceil(r.total / r.limite));
      montar($('#resultado'), html`
        <div class="fila entre" style="margin-bottom:10px"><span class="sub">${r.total} envío(s)</span>
          ${paginas > 1 ? html`<div class="fila"><button class="btn sec chico" id="prev" ${f.pagina <= 1 ? html`disabled` : ''}>Anterior</button>
            <span class="sub">Página ${f.pagina} de ${paginas}</span><button class="btn sec chico" id="next" ${f.pagina >= paginas ? html`disabled` : ''}>Siguiente</button></div>` : ''}</div>
        <div class="lista-envios">${r.items.length ? r.items.map((e) => itemEnvio(e, { montos: rol !== 'repartidor' })) : html`<div class="card">${vacio('No hay envíos con estos filtros.')}</div>`}</div>`);
      $('#prev')?.addEventListener('click', () => { f.pagina -= 1; cargar(); });
      $('#next')?.addEventListener('click', () => { f.pagina += 1; cargar(); });
    } catch (err) { errorToast(err); }
  }

  let t;
  $('#filtros').addEventListener('input', (e) => {
    Object.assign(f, datosForm(e.currentTarget), { pagina: 1 });
    clearTimeout(t);
    t = setTimeout(cargar, 300);
  });
  $('#filtros').onsubmit = (e) => e.preventDefault();
  $('#exportar')?.addEventListener('click', () => abrirBlob(api(`/api/envios/exportar.csv?${qs()}`, { blob: true }), `envios-${hoyISO()}.csv`).catch(errorToast));
  cargar();
}

// ================= Detalle del envío =================
const PROGRESO = [['creado', 'Creado'], ['pagado', 'Pagado'], ['asignado', 'Asignado'], ['en_ruta', 'En ruta'], ['entregado', 'Entregado']];

function nivelProgreso(e) {
  const orden = { borrador: 0, creado: 1, asignado: 3, en_ruta: 4, fallido: 4, reagendado: 4, entregado: 5, devuelto: 4, anulado: 1 };
  let n = orden[e.estado] ?? 0;
  if (e.estado_pago === 'pagado' && n < 2) n = 2;
  return n;
}

export async function detalle(id) {
  if (app.usuario.rol === 'repartidor') return detalleRepartidor(id);
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const e = await get(`/api/envios/${id}`);
  const esAdmin = app.usuario.rol === 'admin';
  const nivel = nivelProgreso(e);
  const fotos = e.adjuntos.filter((a) => a.tipo !== 'boleta');
  const boletas = e.adjuntos.filter((a) => a.tipo === 'boleta');
  const reclamoActivo = e.reclamos.find((r) => r.estado !== 'rechazado');
  const puedeReclamar = e.valor_declarado > 0 && !['borrador', 'anulado'].includes(e.estado) && !reclamoActivo;
  const repartidores = esAdmin ? await get('/api/usuarios/repartidores') : [];

  montar(vista, html`
    <div class="encabezado">
      <div><a href="#/envios" class="sub" style="text-decoration:none">← Volver</a>
        <h1 class="mono">${e.folio || 'Borrador'}</h1>
        <div class="fila">${badge(e.estado)} ${badgePago(e.estado_pago)} ${e.horario_especial ? html`<span class="badge e-en_ruta">Horario ${e.franja_horaria}</span>` : ''}
          <span class="sub">Intentos <span class="intentos">${Array.from({ length: app.conf.operacion.intentos_max }, (_, i) => html`<i class="${i < e.intentos ? 'usado' : ''}"></i>`)}</span> ${e.intentos}/${app.conf.operacion.intentos_max}</span></div></div>
      <div class="fila">
        ${e.folio ? html`<button class="btn sec" data-ticket="80mm">Ticket 80 mm</button><button class="btn sec" data-ticket="a4">Ticket A4</button>` : ''}
        ${e.estado_pago === 'pendiente' && !['borrador', 'anulado'].includes(e.estado) ? html`<button class="btn" id="pagar">Pagar ${clp(e.tarifa_total)}</button>` : ''}
      </div>
    </div>
    ${!['anulado', 'devuelto'].includes(e.estado) ? html`<div class="progreso-envio">${PROGRESO.map(([, t], i) => html`<div class="${i < nivel ? 'on' : ''}">${t}</div>`)}</div>` : ''}
    <div class="grid g2" style="margin-top:18px;align-items:start">
      <div>
        <div class="card">
          <div class="card-titulo"><h2>Destino</h2><div class="fila"><a class="btn sec chico" href="${e.mapas.google}" target="_blank" rel="noopener">Google Maps</a><a class="btn sec chico" href="${e.mapas.waze}" target="_blank" rel="noopener">Waze</a></div></div>
          ${e.tipo_destino === 'punto_courier' ? html`<div class="aviso" style="margin-bottom:10px">Entrega en punto <b>${e.courier_empresa}</b>: ${e.courier_punto}${e.courier_codigo ? ` · código ${e.courier_codigo}` : ''}</div>` : ''}
          <p><b>${e.destinatario_nombre}</b> · ${e.destinatario_telefono}</p>
          <p>${e.calle} ${e.numero}${e.depto ? ', ' + e.depto : ''}<br><b style="font-size:1.2rem">${e.comuna_nombre}</b> <span class="muted">· ${e.region}</span></p>
          ${e.referencia ? html`<p class="sub">Ref.: ${e.referencia}</p>` : ''}
          ${esAdmin ? html`<p class="muted">Cliente: ${e.cliente_nombre}</p>` : ''}
        </div>
        <div class="card">
          <h2>Paquete y tarifa</h2>
          <p>${e.descripcion_producto}</p>
          <p class="sub">${e.bultos} bulto(s) · ${e.peso_kg} kg · ${e.largo_cm}×${e.ancho_cm}×${e.alto_cm} cm${e.observaciones ? ` · ${e.observaciones}` : ''}</p>
          <div class="desglose">
            <div><span>Tarifa base</span><span>${clp(e.tarifa_base)}</span></div>
            ${e.recargo_bultos ? html`<div><span>Bultos adicionales</span><span>${clp(e.recargo_bultos)}</span></div>` : ''}
            ${e.recargo_horario ? html`<div><span>Horario especial</span><span>${clp(e.recargo_horario)}</span></div>` : ''}
            <div class="total"><span>Total</span><span>${clp(e.tarifa_total)}</span></div>
          </div>
          ${e.estado_pago === 'pagado' ? html`<p class="sub" style="margin-top:10px">Pagado ${fechaHora(e.pagado_en)} · ${e.pago_medio === 'en_linea' ? 'en línea' : e.pago_medio} ${e.pago_referencia ? `· ${e.pago_referencia}` : ''}</p>` : ''}
        </div>
        <div class="card">
          <div class="card-titulo"><h2>Seguro</h2>${e.valor_declarado ? html`<span class="badge e-creado">Valor declarado ${clp(e.valor_declarado)}</span>` : html`<span class="badge e-anulado">Sin seguro</span>`}</div>
          ${e.reclamos.length ? html`<div class="pila">${e.reclamos.map((r) => html`<div class="fila entre"><div><b class="mono">${r.numero}</b> · ${app.conf.motivos_reclamo[r.motivo]}<div class="sub">Reclamado ${clp(r.monto_reclamado)}${r.monto_aprobado ? ` · aprobado ${clp(r.monto_aprobado)}` : ''}</div></div>${badge(r.estado, app.conf.estados_reclamo[r.estado])}</div>`)}</div>` : ''}
          ${boletas.length ? html`<p class="sub" style="margin-top:10px">Boleta(s): ${boletas.map((b) => html`<a href="${archivo(b.url)}" target="_blank" rel="noopener">${b.nombre_original || 'boleta'}</a> `)}</p>` : ''}
          ${puedeReclamar ? html`<button class="btn sec" id="reclamar" style="margin-top:12px">Reclamar seguro</button><p class="muted" style="margin-top:6px">Requiere adjuntar la boleta de compra (obligatoria).</p>` : ''}
          ${!e.valor_declarado ? html`<p class="muted">Este envío no declaró valor, por lo que no tiene cobertura de seguro.</p>` : ''}
        </div>
      </div>
      <div>
        ${esAdmin ? accionesAdmin(e, repartidores) : accionesCliente(e)}
        ${e.folio ? html`<div class="card" style="text-align:center"><div class="qr-caja"><img id="qr" alt="QR del envío"></div><p class="sub" style="margin-top:8px">Escanéalo para abrir la ruta</p></div>` : ''}
        ${e.estado === 'entregado' ? html`<div class="card"><h2>Constancia de entrega</h2>
          <p>Entregado ${fechaHora(e.entregado_en)}${e.entrega_receptor ? ` · recibió ${e.entrega_receptor}` : ''}</p>
          ${e.entrega_lat ? html`<p class="sub">GPS: ${e.entrega_lat.toFixed(5)}, ${e.entrega_lon.toFixed(5)}${e.entrega_precision_m ? ` (±${Math.round(e.entrega_precision_m)} m)` : ''} · <a href="https://www.google.com/maps?q=${e.entrega_lat},${e.entrega_lon}" target="_blank" rel="noopener">ver en mapa</a></p>` : ''}</div>` : ''}
        ${fotos.length ? html`<div class="card"><h2>Fotos</h2><div class="fila">${fotos.map((a) => html`<a href="${archivo(a.url)}" target="_blank" rel="noopener" title="${a.tipo === 'foto_entrega' ? 'Foto de entrega' : 'Foto del paquete'}"><img class="foto-mini" src="${archivo(a.url)}" alt="${a.tipo === 'foto_entrega' ? 'Foto de entrega' : 'Foto del paquete'}"></a>`)}</div></div>` : ''}
        <div class="card"><h2>Historial</h2><ol class="linea-tiempo">${e.historial.map((h) => html`<li><b>${ESTADOS[h.estado_nuevo]}</b>${h.motivo ? html` · <span class="sub">${h.motivo}</span>` : ''}<div class="cuando">${fechaHora(h.fecha)} · ${h.usuario_nombre || 'Sistema'}</div></li>`)}</ol></div>
      </div>
    </div>`);

  if (e.folio) api(`/api/envios/${e.id}/qr.png`, { blob: true }).then((b) => { $('#qr').src = URL.createObjectURL(b); }).catch(() => {});
  $$('[data-ticket]').forEach((b) => { b.onclick = () => abrirBlob(api(`/api/envios/${e.id}/ticket.pdf?formato=${b.dataset.ticket}`, { blob: true })).catch(errorToast); });
  $('#pagar')?.addEventListener('click', () => pagar(e, () => detalle(id)));
  $('#reclamar')?.addEventListener('click', () => formReclamo(e, boletas, () => detalle(id)));
  enlazarAcciones(e, () => detalle(id));
}

function accionesCliente(e) {
  if (e.estado !== 'creado' || e.estado_pago !== 'pendiente') return '';
  return html`<div class="card"><h2>Acciones</h2><button class="btn peligro" data-estado="anulado">Anular envío</button></div>`;
}

function accionesAdmin(e, repartidores) {
  const botones = [];
  if (['creado', 'asignado', 'reagendado'].includes(e.estado)) {
    botones.push(html`<label class="campo">Repartidor asignado<select id="asignar">${e.estado === 'reagendado' ? '' : html`<option value="">Sin asignar</option>`}${repartidores.map((r) => html`<option value="${r.id}" ${r.id === e.repartidor_id ? html`selected` : ''}>${r.nombre}</option>`)}</select></label>`);
  } else if (e.repartidor_nombre) botones.push(html`<p class="sub">Repartidor: <b>${e.repartidor_nombre}</b></p>`);
  if (e.estado_pago === 'pendiente' && !['borrador', 'anulado'].includes(e.estado)) botones.push(html`<button class="btn sec" id="pago-manual">Registrar pago manual</button>`);
  if (e.estado === 'fallido') {
    const puede = e.intentos < app.conf.operacion.intentos_max;
    botones.push(html`<div class="fila"><button class="btn" data-estado="reagendado" ${puede ? '' : html`disabled`}>Reagendar (${e.intentos}/${app.conf.operacion.intentos_max})</button><button class="btn sec" data-estado="devuelto">Devolver al origen</button></div>`);
    if (!puede) botones.push(html`<div class="aviso alerta">Se alcanzó el máximo de intentos: corresponde devolver el envío.</div>`);
  }
  if (['creado', 'asignado'].includes(e.estado)) botones.push(html`<button class="btn peligro" data-estado="anulado">Anular envío</button>`);
  if (!botones.length) return '';
  return html`<div class="card"><h2>Administración</h2><div class="pila">${botones}</div></div>`;
}

function enlazarAcciones(e, recargar) {
  $('#asignar')?.addEventListener('change', async (ev) => {
    try { await post(`/api/envios/${e.id}/asignar`, { repartidor_id: ev.target.value || null }); toast('Asignación actualizada', 'ok'); recargar(); }
    catch (err) { errorToast(err); }
  });
  $('#pago-manual')?.addEventListener('click', () => {
    const m = modal(html`<h2>Registrar pago manual</h2><form class="pila" id="f-pm">
      <label class="campo">Medio<select name="medio"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="otro">Otro</option></select></label>
      <label class="campo">Referencia / N° de operación<input name="referencia"></label><button class="btn">Marcar como pagado</button></form>`);
    $('#f-pm', m.el).onsubmit = async (ev) => {
      ev.preventDefault();
      try { await post(`/api/envios/${e.id}/pago-manual`, datosForm(ev.target)); m.cerrar(); toast('Pago registrado', 'ok'); recargar(); }
      catch (err) { errorToast(err); }
    };
  });
  $$('[data-estado]').forEach((b) => {
    b.onclick = async () => {
      const estado = b.dataset.estado;
      let motivo = null;
      if (estado === 'anulado') {
        motivo = await pedirMotivo(e);
        if (!motivo) return;
      } else if (!(await confirmar(`¿${b.textContent.trim()}?`, `El envío ${e.folio} pasará a "${ESTADOS[estado]}".`))) return;
      try { await post(`/api/envios/${e.id}/estado`, { estado, motivo }); toast(`Envío ${ESTADOS[estado].toLowerCase()}`, 'ok'); recargar(); }
      catch (err) { errorToast(err); }
    };
  });
}

function pedirMotivo(e) {
  return new Promise((resolve) => {
    let motivo = null;
    const m = modal(html`<h2>Anular ${e.folio}</h2>
      <p class="sub">${e.estado_pago === 'pagado' ? 'Este envío ya está pagado: la anulación no genera un reembolso automático.' : 'El envío quedará anulado y no se podrá retirar.'}</p>
      <form class="pila" id="f-anular" novalidate><label class="campo">Motivo *<input name="motivo" maxlength="200" placeholder="Ej. el cliente ya no lo enviará"></label>
        <div class="fila" style="justify-content:flex-end"><button type="button" class="btn sec" data-no>Volver</button><button class="btn peligro">Anular envío</button></div></form>`,
    { onClose: () => resolve(motivo) });
    $('[data-no]', m.el).onclick = () => m.cerrar();
    $('#f-anular', m.el).onsubmit = (ev) => {
      ev.preventDefault();
      const v = ev.target.motivo.value.trim();
      if (!v) return marcarErrores(ev.target, { motivo: 'Indica el motivo' });
      motivo = v;
      m.cerrar();
    };
  });
}

// ================= Pago en línea (pasarela simulada) =================
export async function pagar(envio, alTerminar) {
  let pago;
  try { pago = await post(`/api/envios/${envio.id}/pago`); } catch (err) { return errorToast(err); }
  const m = modal(html`<h2>Pagar envío</h2>
    <div class="pasarela">
      <div class="fila entre"><span>Envío <b class="mono">${envio.folio}</b></span><span class="badge e-asignado">Pasarela de prueba</span></div>
      <div class="monto" style="margin:10px 0">${clp(pago.monto)}</div>
      <div class="pila">
        <label class="campo" style="color:#39406b">Número de tarjeta<input value="4051 8856 0044 6623" inputmode="numeric"></label>
        <div class="grid g2"><label class="campo" style="color:#39406b">Vencimiento<input value="12/28"></label><label class="campo" style="color:#39406b">CVV<input value="123"></label></div>
      </div>
    </div>
    <p class="muted" style="margin-top:10px">Simulación: en la etapa de desarrollo se conecta con Webpay Plus, Mercado Pago o Flow. No se cobra dinero real.</p>
    <div class="fila" style="margin-top:14px"><button class="btn grande" id="aprobar">Pagar ${clp(pago.monto)}</button><button class="btn sec" id="rechazar">Simular rechazo</button></div>`);
  const confirmarPago = async (resultado) => {
    try {
      const r = await post(`/api/pagos/${pago.token}/confirmar`, { resultado });
      m.cerrar();
      if (r.estado === 'aprobado') toast('¡Pago aprobado! Tu envío ya puede ser retirado.', 'ok');
      else toast('Pago rechazado. Puedes intentarlo nuevamente.', 'error');
      alTerminar?.();
    } catch (err) { errorToast(err); }
  };
  $('#aprobar', m.el).onclick = () => confirmarPago('aprobado');
  $('#rechazar', m.el).onclick = () => confirmarPago('rechazado');
}

// ================= Seguro: reclamo con boleta OBLIGATORIA =================
function formReclamo(e, boletas, alTerminar) {
  const hoy = hoyISO();
  const m = modal(html`<h2>Reclamar seguro</h2>
    <p class="sub">Envío ${e.folio} · valor declarado ${clp(e.valor_declarado)}. <b>La boleta de compra es obligatoria.</b></p>
    <form class="pila" id="f-rec" novalidate>
      <label class="campo">Motivo *<select name="motivo">${Object.entries(app.conf.motivos_reclamo).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <label class="campo">Descripción<textarea name="descripcion" placeholder="¿Qué ocurrió?"></textarea></label>
      <div class="card" style="box-shadow:none;background:rgba(224,33,138,.08);border-color:rgba(224,33,138,.35)">
        <h3>Boleta de compra *</h3>
        ${boletas.length ? html`<label class="campo">Usar boleta ya adjunta<select name="boleta_adjunto_id"><option value="">— Subir una nueva —</option>${boletas.map((b) => html`<option value="${b.id}">${b.nombre_original || 'Boleta ' + b.id}</option>`)}</select></label>` : ''}
        <label class="campo">Archivo (PDF o foto)<input type="file" name="boleta" accept="application/pdf,image/*"></label>
        <div class="grid g3" style="margin-top:10px">
          <label class="campo">N° boleta *<input name="boleta_numero"></label>
          <label class="campo">Fecha *<input type="date" name="boleta_fecha" max="${hoy}"></label>
          <label class="campo">Monto boleta *<input type="number" name="boleta_monto" min="1"></label>
        </div>
        <label class="campo" style="margin-top:10px">RUT del emisor<input name="boleta_emisor_rut" placeholder="76.123.456-7"></label>
      </div>
      <label class="campo">Monto a reclamar *<input type="number" name="monto_reclamado" min="1" max="${e.valor_declarado}"><small>No puede superar el valor declarado ni el monto de la boleta.</small></label>
      <button class="btn grande">Enviar reclamo</button>
    </form>`);
  $('#f-rec', m.el).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const fd = new FormData(f);
    const file = f.boleta.files[0];
    if (!file) fd.delete('boleta');
    if (!file && !fd.get('boleta_adjunto_id')) {
      marcarErrores(f, { boleta: 'La boleta es obligatoria para cobrar el seguro' });
      return toast('Adjunta la boleta: es obligatoria para cobrar el seguro', 'error');
    }
    try { const r = await enviarForm(`/api/reclamos/envio/${e.id}`, fd); m.cerrar(); toast(`Reclamo ${r.numero} enviado`, 'ok'); alTerminar(); }
    catch (err) { marcarErrores(f, err.detalles); errorToast(err); }
  };
}

// ================= Listado de reclamos de seguro =================
export async function reclamos() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const esAdmin = app.usuario.rol === 'admin';
  const lista = await get('/api/reclamos');
  montar(vista, html`
    <div class="encabezado"><div><h1>Reclamos de seguro</h1><p>Toda indemnización requiere la boleta de compra del producto.</p></div></div>
    ${lista.length ? html`<div class="tabla-wrap"><table class="tabla-cards">
      <thead><tr><th>N°</th><th>Envío</th>${esAdmin ? html`<th>Cliente</th>` : ''}<th>Motivo</th><th class="num">Declarado</th><th class="num">Reclamado</th><th class="num">Aprobado</th><th>Boleta</th><th>Estado</th>${esAdmin ? html`<th>Acción</th>` : ''}</tr></thead>
      <tbody>${lista.map((r) => html`<tr>
        <td data-label="N°" class="mono"><b>${r.numero}</b></td><td data-label="Envío"><a href="#/envio/${r.envio_id}">${r.folio}</a></td>${esAdmin ? html`<td data-label="Cliente">${r.cliente_nombre}</td>` : ''}
        <td data-label="Motivo">${app.conf.motivos_reclamo[r.motivo]}</td><td data-label="Declarado" class="num">${clp(r.valor_declarado)}</td><td data-label="Reclamado" class="num">${clp(r.monto_reclamado)}</td>
        <td data-label="Aprobado" class="num">${r.monto_aprobado ? clp(r.monto_aprobado) : '—'}</td>
        <td data-label="Boleta"><a href="${archivo(r.boleta_url)}" target="_blank" rel="noopener">N° ${r.boleta_numero} · ${clp(r.boleta_monto)}</a></td>
        <td data-label="Estado">${badge(r.estado, app.conf.estados_reclamo[r.estado])}</td>
        ${esAdmin ? html`<td data-label="Acción"><div class="fila">
          ${r.estado === 'solicitado' ? html`<button class="btn sec chico" data-revisar="${r.id}">Revisar</button>` : ''}
          ${['solicitado', 'en_revision'].includes(r.estado) ? html`<button class="btn chico" data-resolver="${r.id}">Resolver</button>` : ''}
          ${r.estado === 'aprobado' ? html`<button class="btn chico" data-pagar="${r.id}">Pagar</button>` : ''}</div></td>` : ''}
      </tr>`)}</tbody></table></div>` : html`<div class="card">${vacio('No hay reclamos de seguro.')}</div>`}`);

  $$('[data-revisar]').forEach((b) => { b.onclick = async () => { await post(`/api/reclamos/${b.dataset.revisar}/revision`).catch(errorToast); reclamos(); }; });
  $$('[data-pagar]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmar('¿Pagar la indemnización?', 'Se registrará como costo "seguro" y descontará de la ganancia neta.', 'Pagar'))) return;
      await post(`/api/reclamos/${b.dataset.pagar}/pagar`).then(() => toast('Indemnización pagada', 'ok')).catch(errorToast);
      reclamos();
    };
  });
  $$('[data-resolver]').forEach((b) => {
    b.onclick = () => {
      const r = lista.find((x) => String(x.id) === b.dataset.resolver);
      const m = modal(html`<h2>Resolver ${r.numero}</h2>
        <p class="sub">Reclamado ${clp(r.monto_reclamado)} · boleta N° ${r.boleta_numero} por ${clp(r.boleta_monto)} · <a href="${archivo(r.boleta_url)}" target="_blank" rel="noopener">ver boleta</a></p>
        <form class="pila" id="f-res" novalidate>
          <label class="campo">Monto aprobado<input type="number" name="monto_aprobado" value="${r.monto_reclamado}" max="${r.monto_reclamado}"></label>
          <label class="campo">Nota (obligatoria si se rechaza)<textarea name="nota"></textarea></label>
          <div class="fila"><button class="btn" name="decision" value="aprobar">Aprobar</button><button class="btn peligro" name="decision" value="rechazar">Rechazar</button></div>
        </form>`);
      $('#f-res', m.el).onsubmit = async (ev) => {
        ev.preventDefault();
        const d = { ...datosForm(ev.target), decision: ev.submitter.value };
        try { await post(`/api/reclamos/${r.id}/resolver`, d); m.cerrar(); toast('Reclamo resuelto', 'ok'); reclamos(); }
        catch (err) { marcarErrores(ev.target, err.detalles); errorToast(err); }
      };
    };
  });
}

