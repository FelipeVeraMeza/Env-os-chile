import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function leer(archivo) {
  const ruta = path.join(raiz, archivo);
  if (!fs.existsSync(ruta)) return {};
  const vars = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

// Prioridad: variables de entorno > entornos.local.env > entornos.env
export function cargarEntornos() {
  return { ...leer('entornos.env'), ...leer('entornos.local.env'), ...pick(process.env) };
}

function pick(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => /^(URL_|QA_|API_OBJETIVO)/.test(k)));
}

const sinBarra = (u) => (u || '').replace(/\/+$/, '');

// Resuelve la URL de la API y de la web para un objetivo (local, railway, vercel, produccion).
export function resolverObjetivo(objetivo, vars = cargarEntornos()) {
  const urls = {
    local: sinBarra(vars.URL_LOCAL || 'http://localhost:3000'),
    railway: sinBarra(vars.URL_RAILWAY),
    vercel: sinBarra(vars.URL_VERCEL),
    produccion: sinBarra(vars.URL_PRODUCCION),
  };
  if (!(objetivo in urls)) throw new Error(`Objetivo desconocido "${objetivo}". Usa: ${Object.keys(urls).join(', ')}`);
  const web = urls[objetivo];
  // En Vercel solo vive la interfaz: la API sigue en Railway.
  const api = objetivo === 'vercel' ? urls.railway : web;
  for (const [nombre, url] of [['web', web], ['api', api]]) {
    if (!url || url.includes('CAMBIAR-POR')) {
      throw new Error(`Falta la URL (${nombre}) para "${objetivo}". Edítala en entornos.env`);
    }
  }
  return { objetivo, web, api };
}
