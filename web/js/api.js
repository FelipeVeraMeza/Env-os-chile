// Cliente de la API. La URL del servidor se toma (en orden) de:
//   1) lo elegido en la interfaz (botón "servidor", se guarda en este navegador)
//   2) web/config.js → window.APP_CONFIG.API_URL (generado desde entornos.env)
//   3) mismo origen (cuando Railway sirve la interfaz y la API juntas)
const LS_API = 'envios.api_url';
const LS_PERFIL = 'envios.perfil';
const LS_TOKEN = 'envios.token';
const LS_CLAVE = 'envios.demo_clave';

function leerLS(clave) { try { return localStorage.getItem(clave); } catch { return null; } }
function escribirLS(clave, valor) {
  try { valor === null ? localStorage.removeItem(clave) : localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

export function urlApi() {
  return (leerLS(LS_API) ?? window.APP_CONFIG?.API_URL ?? '').replace(/\/+$/, '');
}
export function fijarUrlApi(url) { escribirLS(LS_API, url === null ? null : url.replace(/\/+$/, '')); }
export function perfilActual() { const v = Number(leerLS(LS_PERFIL)); return Number.isInteger(v) && v > 0 ? v : null; }
export function fijarPerfil(id) { escribirLS(LS_PERFIL, id ? String(id) : null); }
export function fijarClaveDemo(clave) { escribirLS(LS_CLAVE, clave || null); }

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
    throw new ErrorApi(0, { error: `No hay conexión con el servidor (${urlApi() || 'mismo origen'}). Revisa la URL en el botón de servidor.` });
  }
  if (blob && res.ok) return res.blob();
  const tipo = res.headers.get('content-type') || '';
  const datos = tipo.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ErrorApi(res.status, typeof datos === 'string' ? { error: datos } : datos);
  return datos;
}

export const get = (r) => api(r);
export const post = (r, json) => api(r, { metodo: 'POST', json: json ?? {} });
export const put = (r, json) => api(r, { metodo: 'PUT', json });
export const patch = (r, json) => api(r, { metodo: 'PATCH', json });
export const enviarForm = (r, form) => api(r, { metodo: 'POST', form });
export const archivo = (r) => (r.startsWith('http') ? r : `${urlApi()}${r}`);
