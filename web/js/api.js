// Cliente de la API. Por defecto la interfaz y la API viven en la misma app (mismo origen:
// Railway sirve ambas). Solo se usa otra URL si:
//   1) se eligió en el botón "servidor" estando en modo desarrollo (?dev), o
//   2) web/config.js → window.APP_CONFIG.API_URL la define (generado desde entornos.env).
const LS_API = 'envios.api_url';
const LS_PERFIL = 'envios.perfil';
const LS_TOKEN = 'envios.token';
const LS_CLAVE = 'envios.demo_clave';

function leerLS(clave) { try { return localStorage.getItem(clave); } catch { return null; } }
function escribirLS(clave, valor) {
  try { valor === null ? localStorage.removeItem(clave) : localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

const enDesarrollo = () => leerLS('envios.dev') === '1';
export function urlApi() {
  const elegida = enDesarrollo() ? leerLS(LS_API) : null;
  return (elegida ?? window.APP_CONFIG?.API_URL ?? '').replace(/\/+$/, '');
}
export function fijarUrlApi(url) { escribirLS(LS_API, url === null ? null : url.replace(/\/+$/, '')); }
export function perfilActual() { const v = Number(leerLS(LS_PERFIL)); return Number.isInteger(v) && v > 0 ? v : null; }
export function fijarPerfil(id) { escribirLS(LS_PERFIL, id ? String(id) : null); }
export function fijarClaveDemo(clave) { escribirLS(LS_CLAVE, clave || null); }
// Sesión real (AUTH_MODE=jwt): el token dura 30 días en este dispositivo (RF-03).
export function tokenActual() { return leerLS(LS_TOKEN); }
export function fijarToken(token) { escribirLS(LS_TOKEN, token || null); }
export function hayToken() { return Boolean(leerLS(LS_TOKEN)); }

function cabeceras() {
  const h = {};
  const token = leerLS(LS_TOKEN);
  if (token) h.Authorization = `Bearer ${token}`;
  const clave = leerLS(LS_CLAVE);
  if (clave) h['X-Demo-Clave'] = clave;
  const perfil = perfilActual();
  if (perfil) h['X-Demo-Usuario'] = String(perfil);
  return h;
}

export class ErrorApi extends Error {
  constructor(status, datos) {
    super(datos?.error || `Error ${status}`);
    this.status = status;
    this.detalles = datos?.detalles || {};
  }
}

export async function api(ruta, { metodo = 'GET', json, form, blob = false } = {}) {
  const headers = cabeceras();
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  let res;
  try {
    res = await fetch(`${urlApi()}${ruta}`, { method: metodo, headers, body });
  } catch {
    throw new ErrorApi(0, { error: `No hay conexión con el servidor (${urlApi() || 'mismo origen'}). Revisa tu conexión a internet.` });
  }
  if (blob && res.ok) return res.blob();
  const tipo = res.headers.get('content-type') || '';
  // Un proxy o un corte de red puede responder JSON incompleto: se muestra un mensaje claro, no "Unexpected token".
  let datos;
  try { datos = tipo.includes('json') ? await res.json() : await res.text(); }
  catch { throw new ErrorApi(res.status || 0, { error: 'Respuesta incompleta del servidor. Revisa tu conexión e inténtalo de nuevo.' }); }
  // Sesión vencida o cerrada desde otro lado (p. ej. cambio de contraseña): se vuelve a la pantalla de ingreso.
  if (res.status === 401 && headers.Authorization && ruta !== '/api/auth/login') {
    fijarToken(null);
    window.dispatchEvent(new CustomEvent('sesion-expirada', { detail: datos?.error }));
  }
  if (!res.ok) throw new ErrorApi(res.status, typeof datos === 'string' ? { error: datos } : datos);
  return datos;
}

export const get = (r) => api(r);
export const post = (r, json) => api(r, { metodo: 'POST', json: json ?? {} });
export const put = (r, json) => api(r, { metodo: 'PUT', json });
export const patch = (r, json) => api(r, { metodo: 'PATCH', json });
export const enviarForm = (r, form) => api(r, { metodo: 'POST', form });
export const archivo = (r) => (r.startsWith('http') ? r : `${urlApi()}${r}`);
