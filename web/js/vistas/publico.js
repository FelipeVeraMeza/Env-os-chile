import { get } from '../api.js';
import { $, badge, errorToast, fechaHora, html, montar } from '../ui.js';

// Seguimiento por folio: muestra solo el estado, sin datos personales.
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
        ${s.intentos ? html`<p class="sub">Intentos de entrega: ${s.intentos} de ${s.intentos_max}</p>` : ''}
        <ol class="linea-tiempo" style="margin-top:14px">${s.historial.filter((h) => h.estado !== 'borrador').map((h) => html`<li><b>${h.label}</b><div class="cuando">${fechaHora(h.fecha)}</div></li>`)}</ol>
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
