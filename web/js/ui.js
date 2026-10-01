// Utilidades de interfaz: plantillas seguras, formato chileno, modales, avisos, fotos y GPS.
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function valor(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(valor).join('');
  return escapar(v);
}
// Plantilla con escape automático de todo lo interpolado (evita inyección de HTML).
export function html(partes, ...vals) {
  return raw(partes.reduce((acc, p, i) => acc + p + (i < vals.length ? valor(vals[i]) : ''), ''));
}
export function montar(el, contenido) { el.innerHTML = contenido instanceof Raw ? contenido.s : valor(contenido); return el; }

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const clp = (n) => { const v = Math.round(Number(n || 0)); return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('es-CL')}`; };
export const fecha = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('-') : d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago' }) : '—');
export const fechaHora = (d) => (d ? new Date(d).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }) : '—');
export const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

export const ESTADOS = {
  borrador: 'Borrador', creado: 'Creado', asignado: 'Asignado', en_ruta: 'En ruta', entregado: 'Entregado',
  fallido: 'Fallido', reagendado: 'Reagendado', devuelto: 'Devuelto', anulado: 'Anulado',
};
export const badge = (estado, texto) => html`<span class="badge e-${estado}">${texto || ESTADOS[estado] || estado}</span>`;
export const PAGO_TXT = { pendiente: 'Pago pendiente', en_revision: 'Pago en revisión', pagado: 'Pagado', reembolsado: 'Reembolsado' };
export const badgePago = (e) => badge(['pagado', 'en_revision', 'reembolsado'].includes(e) ? e : 'pendiente', PAGO_TXT[e] || PAGO_TXT.pendiente);

export function toast(mensaje, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = mensaje;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

export function errorToast(err) { toast(err.message || 'Ocurrió un error', 'error'); }

// Abre un modal; devuelve { el, cerrar }. onClose se ejecuta al cerrar.
// fijo: true → no se cierra con Escape, clic afuera ni ✕ (solo por código).
export function modal(contenido, { onClose, fijo = false } = {}) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${fijo ? '' : '<button class="btn-icono cerrar" aria-label="Cerrar">✕</button>'}<div class="modal-cuerpo"></div></div>`;
  montar($('.modal-cuerpo', fondo), contenido);
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape' && !fijo) cerrar(); };
  fondo.addEventListener('click', (e) => { if (e.target === fondo && !fijo) cerrar(); });
  $('.cerrar', fondo)?.addEventListener('click', cerrar);
  document.addEventListener('keydown', esc);
  $('#modal-raiz').append(fondo);
  $('input, select, textarea, button:not(.cerrar)', fondo)?.focus();
  return { el: fondo, cerrar };
}

export function confirmar(titulo, texto, etiqueta = 'Confirmar') {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal(html`<h2>${titulo}</h2><p class="sub">${texto}</p>
      <div class="fila" style="justify-content:flex-end;margin-top:18px"><button class="btn sec" data-no>Cancelar</button><button class="btn" data-si>${etiqueta}</button></div>`,
    { onClose: () => resolve(ok) });
    $('[data-no]', m.el).onclick = () => m.cerrar();
    $('[data-si]', m.el).onclick = () => { ok = true; m.cerrar(); };
  });
}

// Marca errores de validación de la API en los campos (name = clave del error).
export function marcarErrores(form, detalles = {}) {
  $$('.error-campo', form).forEach((e) => e.remove());
  $$('.campo.invalido', form).forEach((e) => e.classList.remove('invalido'));
  let primero = null;
  for (const [clave, msg] of Object.entries(detalles)) {
    const input = form.querySelector(`[name="${CSS.escape(clave)}"]`) || form.querySelector(`[name="${CSS.escape(clave.split('.').pop())}"]`);
    const campo = input?.closest('.campo');
    if (!campo) continue;
    campo.classList.add('invalido');
    const s = document.createElement('span');
    s.className = 'error-campo';
    s.textContent = msg;
    campo.append(s);
    primero ||= input;
  }
  primero?.focus();
  return Boolean(primero);
}

export function datosForm(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'file') continue;
    if (el.type === 'checkbox') d[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
    else d[el.name] = el.value;
  }
  return d;
}

// Comprime la foto (máx. 1600 px, JPEG ~80%). Al redibujar en canvas se eliminan los metadatos EXIF/GPS.
export async function comprimirFoto(file, lado = 1600, calidad = 0.8) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', calidad));
  // Algunos navegadores (memoria baja, imagen enorme) no generan el JPEG: se sube la foto original, nunca un archivo vacío.
  if (!blob || !blob.size) return file;
  return new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function obtenerGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo no entrega ubicación GPS'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'Permiso de ubicación denegado. Actívalo para cerrar la entrega.' : 'No se pudo obtener la ubicación GPS')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export const ICONOS = {
  inicio: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  nuevo: '<path d="M12 5v14M5 12h14" stroke-width="2.4"/>',
  envios: '<path d="M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10"/>',
  libreta: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6zM6 3v18M10 8h5M10 12h5"/>',
  seguimiento: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  seguro: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  ruta: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  panel: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  tarifas: '<path d="M20 12 12 20 4 12V4h8z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  candado: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 14.5v2.5"/>',
  salir: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  llave: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 7l3 3M14 9l2 2"/>',
  cobranza: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/>',
  caja: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
};
export const icono = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n] || ''}</svg>`);

export function vacio(texto, accion) {
  return html`<div class="vacio">${icono('caja')}<p>${texto}</p>${accion || ''}</div>`;
}

export function esqueleto(n = 3) {
  return raw(Array.from({ length: n }, () => '<div class="esqueleto"></div>').join('<div style="height:10px"></div>'));
}

// Descarga/abre un archivo protegido (ticket PDF) pidiendo el blob con las cabeceras de sesión.
export async function abrirBlob(promesa, nombre) {
  const blob = await promesa;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  if (nombre) a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
