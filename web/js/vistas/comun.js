import { get } from '../api.js';
import { html } from '../ui.js';

let cacheComunas = null;
export async function comunasCobertura() {
  cacheComunas ||= get('/api/comunas?cobertura=1');
  return cacheComunas;
}
export function limpiarCacheComunas() { cacheComunas = null; }

export function opcionesComunas(comunas, seleccionada) {
  return html`<option value="">Selecciona la comuna…</option>${comunas.map((c) => html`<option value="${c.id}" ${String(c.id) === String(seleccionada) ? html`selected` : ''}>${c.nombre}</option>`)}`;
}


export function direccionTexto(e) {
  return `${e.calle} ${e.numero}${e.depto ? `, ${e.depto}` : ''} · ${e.comuna_nombre}`;
}

export function itemEnvio(e, { montos = true } = {}) {
  return html`<a class="item-envio" href="#/envio/${e.id}">
    <div>
      <div class="fila"><span class="folio">${e.folio || 'Borrador'}</span> ${e.tipo_destino === 'punto_courier' ? html`<span class="badge e-asignado">${e.courier_empresa}</span>` : ''}
        ${e.horario_especial ? html`<span class="badge e-en_ruta">Horario especial</span>` : ''}</div>
      <div>${e.destinatario_nombre}</div>
      <div class="dir">${direccionTexto(e)}</div>
    </div>
    <div class="der">
      <span class="badge e-${e.estado}">${ESTADO_TXT[e.estado]}</span>
      ${montos && e.tarifa_total !== undefined ? html`<span class="monto">${'$' + Number(e.tarifa_total).toLocaleString('es-CL')}</span>` : ''}
      ${e.estado_pago && e.estado_pago !== 'pagado' && !['borrador', 'anulado'].includes(e.estado) ? html`<span class="badge e-pendiente">Pago pendiente</span>` : ''}
    </div>
  </a>`;
}

const ESTADO_TXT = { borrador: 'Borrador', creado: 'Creado', asignado: 'Asignado', en_ruta: 'En ruta', entregado: 'Entregado', fallido: 'Fallido', reagendado: 'Reagendado', devuelto: 'Devuelto', anulado: 'Anulado' };
