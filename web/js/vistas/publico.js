import { get, post } from '../api.js';
import { $, badge, clp, errorToast, fechaHora, html, montar, toast } from '../ui.js';

// Seguimiento por folio: muestra solo el estado, sin datos personales.
// Intentos de entrega (pedido 07-10): en qué intento va, cuántos fallaron y si se devolvió al remitente.
function avisoIntentos(s) {
  const max = s.intentos_max || 3;
  const fallidos = Number(s.intentos) || 0;
  const puntos = html`<span class="intentos">${Array.from({ length: max }, (_, i) => html`<i class="${i < fallidos ? 'usado' : ''}"></i>`)}</span>`;
  if (s.estado === 'devuelto') {
    return html`<div class="aviso alerta" style="margin-top:10px"><b>El paquete se devolvió al remitente</b>${fallidos >= max ? ` después de ${fallidos} intentos de entrega sin éxito` : ''}. ${puntos}</div>`;
  }
  if (s.estado === 'entregado') return fallidos ? html`<p class="sub">Entregado en el intento ${fallidos + 1} de ${max}.</p>` : '';
  if (['en_ruta', 'fallido', 'reagendado'].includes(s.estado)) {
    const actual = s.estado === 'fallido' ? fallidos : fallidos + 1;
    const texto = s.estado === 'fallido' ? `Intento ${actual} de ${max}: no se pudo entregar${fallidos < max ? '. Se hará un nuevo intento.' : '.'}`
      : s.estado === 'reagendado' ? `Nuevo intento programado: intento ${actual} de ${max}.` : `En camino: intento ${actual} de ${max}.`;
    return html`<div class="aviso ${s.estado === 'fallido' ? 'alerta' : ''}" style="margin-top:10px"><b>${texto}</b> ${puntos}</div>`;
  }
  return '';
}

export async function seguimiento(folioInicial) {
  const vista = $('#vista');
  montar(vista, html`
    <div class="hero"><h1>Seguimiento de envío</h1><p>Ingresa el folio que aparece en tu ticket para ver el estado de tu envío.</p>
      <form class="fila" id="f-seg" style="margin-top:14px;max-width:560px">
        <input name="folio" placeholder="ENV-2026-000123" value="${folioInicial || ''}" style="flex:1;background:rgba(255,255,255,.95);color:#0a1a6b;font-weight:700" aria-label="Folio" autocapitalize="characters">
        <button class="btn blanco">Buscar</button></form></div>
    <div id="res-seg"></div>`);
  const buscar = async (folio) => {
    const res = $('#res-seg');
    try {
      const s = await get(`/api/seguimiento/${encodeURIComponent(folio.trim().toUpperCase())}`);
      montar(res, html`<div class="card">
        <div class="card-titulo"><div><h2 class="mono">${s.folio}</h2><div class="sub">Destino: ${s.tipo_destino === 'punto_courier' ? `punto ${s.courier_empresa} · ` : ''}${s.comuna}</div></div>${badge(s.estado, s.estado_label)}</div>
        ${s.horario_especial ? html`<p class="sub">Horario especial: ${s.franja_horaria}</p>` : ''}
        ${avisoIntentos(s)}
        <ol class="linea-tiempo" style="margin-top:14px">${s.historial.filter((h) => h.estado !== 'borrador').map((h) => html`<li class="${['fallido', 'devuelto'].includes(h.estado) ? 'rechazo' : ''}"><b>${h.label}</b>${h.detalle ? html`<div class="sub">${h.detalle}</div>` : ''}<div class="cuando">${fechaHora(h.fecha)}</div></li>`)}</ol>
      </div>`);
      if (location.hash !== `#/seguimiento/${s.folio}`) history.replaceState(null, '', `#/seguimiento/${s.folio}`);
    } catch (err) {
      montar(res, html`<div class="aviso alerta">${err.message}</div>`);
      if (err.status === 0) errorToast(err);
    }
  };
  $('#f-seg').onsubmit = (e) => { e.preventDefault(); buscar(e.target.folio.value); };
  if (folioInicial) buscar(folioInicial);
}

// Página del link de pago: sin sesión ni clave. Solo folio, monto y empresa (ningún dato personal).
export async function pagoPublico(token) {
  const vista = $('#vista');
  montar($('#menu'), '');
  const pintar = async () => {
    let l;
    try { l = await get(`/api/pago-publico/${encodeURIComponent(token)}`); } catch (err) {
      return montar(vista, html`<div class="card login" style="margin:24px auto"><h1>Link de pago</h1><div class="aviso alerta">${err.message}</div></div>`);
    }
    const estado = l.pagado ? html`<div class="aviso ok">Este envío ya está <b>pagado</b>. ¡Gracias!</div>`
      : l.anulado ? html`<div class="aviso alerta">El envío fue anulado: no hay nada que pagar.</div>`
      : l.en_linea === false ? html`<div class="aviso">El pago se hace por <b>transferencia</b>: quien creó el envío transfiere y sube el comprobante desde su cuenta.</div>`
      : !l.vigente ? html`<div class="aviso alerta">Este link venció. Pide uno nuevo a quien te lo envió.</div>` : '';
    montar(vista, html`<div class="login-caja"><div class="card login">
      <p class="sub">${l.negocio}</p><h1>Pagar envío</h1>
      <p class="mono" style="font-size:1.2rem;font-weight:800">${l.folio}</p>
      <div class="monto" style="font-size:2.2rem;font-weight:900;margin:8px 0">${clp(l.monto)}</div>
      ${estado || html`
        ${l.proveedor === 'simulado' ? html`<div class="pasarela"><div class="pila">
          <label class="campo" style="color:#39406b">Número de tarjeta<input value="4051 8856 0044 6623" inputmode="numeric"></label>
          <div class="grid g2"><label class="campo" style="color:#39406b">Vencimiento<input value="12/28"></label><label class="campo" style="color:#39406b">CVV<input value="123"></label></div></div></div>
          <p class="muted" style="margin-top:10px">Pasarela de prueba: no se cobra dinero real.</p>` : ''}
        <div class="fila" style="margin-top:14px"><button class="btn grande ancho" id="pagar-link">Pagar ${clp(l.monto)}</button></div>
        ${l.proveedor === 'simulado' ? html`<button class="btn sec chico" id="rechazo-link" style="margin-top:8px">Simular rechazo</button>` : ''}`}
      <p class="muted" style="margin-top:16px">Vence el ${fechaHora(l.vence_en)}. Nunca te pediremos tu contraseña por este medio.</p>
      <div class="pie"><a href="#/seguimiento/${l.folio}">Seguir este envío →</a></div>
    </div></div>`);
    const pagarCon = (resultado) => async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await post(`/api/pago-publico/${encodeURIComponent(token)}/pagar`, { resultado });
        if (r.estado === 'aprobado') toast('¡Pago aprobado! Gracias.', 'ok'); else toast('Pago rechazado. Puedes intentarlo nuevamente.', 'error');
        pintar();
      } catch (err) { errorToast(err); ev.target.disabled = false; }
    };
    $('#pagar-link')?.addEventListener('click', pagarCon('aprobado'));
    $('#rechazo-link')?.addEventListener('click', pagarCon('rechazado'));
  };
  await pintar();
}
