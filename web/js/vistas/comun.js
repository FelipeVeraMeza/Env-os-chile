import { app } from '../app.js';
import { get } from '../api.js';
import { badgePago, html } from '../ui.js';

let cacheComunas = null;
export async function comunasCobertura() {
  cacheComunas ||= get('/api/comunas?cobertura=1');
  return cacheComunas;
}
export function limpiarCacheComunas() { cacheComunas = null; }

export function opcionesComunas(comunas, seleccionada) {
  return html`<option value="">Selecciona la comuna…</option>${comunas.map((c) => html`<option value="${c.id}" ${String(c.id) === String(seleccionada) ? html`selected` : ''}>${c.nombre}</option>`)}`;
}


// Aviso al destinatario por WhatsApp (RF-55): abre el chat con el mensaje listo; no requiere API ni tiene costo.
const MENSAJE_AVISO = {
  creado: (e) => `Hola ${e.destinatario_nombre}, tienes un envío registrado (${e.folio}).`,
  asignado: (e) => `Hola ${e.destinatario_nombre}, tu envío ${e.folio} ya tiene repartidor asignado.`,
  en_ruta: (e) => `Hola ${e.destinatario_nombre}, tu envío ${e.folio} va en camino${e.horario_especial ? ` (horario ${e.franja_horaria})` : ''}. Por favor, que alguien pueda recibirlo.`,
  reagendado: (e) => `Hola ${e.destinatario_nombre}, reprogramamos la entrega de tu envío ${e.folio}.`,
  fallido: (e) => `Hola ${e.destinatario_nombre}, intentamos entregar tu envío ${e.folio} y no fue posible. Responde este mensaje para coordinar un nuevo intento.`,
  entregado: (e) => `Hola ${e.destinatario_nombre}, tu envío ${e.folio} fue entregado. ¡Gracias!`,
};
export function avisoWhatsapp(e, negocio) {
  const texto = (MENSAJE_AVISO[e.estado] || MENSAJE_AVISO.creado)(e);
  const seguimiento = `${location.origin}${location.pathname}#/seguimiento/${e.folio}`;
  const fono = String(e.destinatario_telefono || '').replace(/\D/g, '');
  return `https://wa.me/${fono}?text=${encodeURIComponent(`${texto}\nSigue tu envío: ${seguimiento}\n${negocio?.nombre || ''}`.trim())}`;
}

export function direccionTexto(e) {
  return `${e.calle} ${e.numero}${e.depto ? `, ${e.depto}` : ''} · ${e.comuna_nombre}`;
}

// Dirección de retiro (dónde el repartidor recoge el paquete).
export function retiroTexto(e) {
  return `${e.retiro_calle} ${e.retiro_numero}${e.retiro_depto ? `, ${e.retiro_depto}` : ''} · ${e.retiro_comuna_nombre || ''}`;
}

// Día de retiro elegido al reagendar ("martes 14 de octubre"); sin fecha, rige el horario de retiro normal.
export function fechaRetiroTexto(e) {
  if (!e.retiro_fecha) return '';
  return new Date(`${String(e.retiro_fecha).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// Tamaño declarado ("Estándar" / "Sobredimensionado") o, en envíos antiguos, peso y medidas.
export function textoPaquete(e) {
  const t = app.conf.tarifas;
  const bultos = `${e.bultos} ${Number(e.bultos) === 1 ? 'bulto' : 'bultos'}`;
  if (e.tamano === 'estandar') return `${bultos} · Estándar (hasta ${t.dim_estandar_cm}×${t.dim_estandar_cm}×${t.dim_estandar_cm} cm y ${t.peso_estandar_kg} kg)`;
  if (e.tamano === 'sobredimensionado') return `${bultos} · Sobredimensionado (hasta ${t.dim_max_cm}×${t.dim_max_cm}×${t.dim_max_cm} cm y ${t.peso_max_kg} kg)`;
  return `${bultos} · ${e.peso_kg} kg · ${e.largo_cm}×${e.ancho_cm}×${e.alto_cm} cm`;
}

// Mapa de Google para corroborar una dirección (sin clave de API: vista embebida de Google Maps).
export function urlMapaGoogle(calle, numero, comuna) {
  if (!String(calle || '').trim() || !comuna) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(`${calle} ${numero || ''}, ${comuna}, Chile`)}&output=embed`;
}
// Sin dirección todavía no se muestra el recuadro vacío del mapa: aparece al escribir la calle, el número y la comuna.
export function mapaGoogle(id, url) {
  return html`<div class="mapa-dir" style="margin-top:12px" ${url ? '' : html`hidden`}>
    <iframe id="${id}" title="Mapa de Google con la dirección" src="${url || 'about:blank'}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
      style="width:100%;height:240px;border:0;border-radius:14px;background:rgba(255,255,255,.06)"></iframe>
    <p class="muted" style="margin-top:6px">Revisa en el mapa que el punto sea la dirección correcta. Si no lo es, corrige la calle, el número o la comuna.</p></div>`;
}

// En qué intento de entrega va (pedido 07-10): en ruta o reagendado es el siguiente; fallido, el que no resultó.
export function textoIntento(e) {
  const max = app.conf.operacion?.intentos_max || 3;
  const n = Number(e.intentos) || 0;
  if (e.estado === 'en_ruta') return `Intento ${n + 1} de ${max}`;
  if (e.estado === 'reagendado') return `Próximo: intento ${n + 1} de ${max}`;
  if (e.estado === 'fallido') return `Intento ${n} de ${max} sin éxito`;
  if (e.estado === 'devuelto' && n) return `${n} intento${n === 1 ? '' : 's'} sin éxito`;
  if (e.estado === 'entregado' && n) return `Entregado en el intento ${n + 1}`;
  return '';
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
      ${textoIntento(e) ? html`<span class="badge ${e.estado === 'fallido' || e.estado === 'devuelto' ? 'e-anulado' : 'e-en_ruta'}">${textoIntento(e)}</span>` : ''}
      ${montos && e.tarifa_total !== undefined ? html`<span class="monto">${'$' + Number(e.tarifa_total).toLocaleString('es-CL')}</span>` : ''}
      ${['pendiente', 'en_revision'].includes(e.estado_pago) && !['borrador', 'anulado'].includes(e.estado) ? badgePago(e.estado_pago) : ''}
    </div>
  </a>`;
}

const ESTADO_TXT = { borrador: 'Borrador', creado: 'Creado', asignado: 'Por retirar', en_ruta: 'En ruta', entregado: 'Entregado', fallido: 'Fallido', reagendado: 'Reagendado', devuelto: 'Devuelto', anulado: 'Anulado' };
