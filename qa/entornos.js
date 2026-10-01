import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lee un archivo KEY=valor. Quita espacios al final, un comentario al final de la línea ("URL=… # nota") y las comillas
// que envuelven el valor. Antes quedaban los espacios y el comentario pegados a las URLs.
export function leerArchivoEnv(contenido) {
  const vars = {};
  for (const linea of contenido.split(/\r?\n/)) {
    const m = linea.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const comillas = /^(["'])(.*)\1$/.exec(v);
    if (comillas) v = comillas[2];
    else v = v.replace(/\s+#.*$/, '').trim();
    vars[m[1]] = v;
  }
  return vars;
}

function leer(archivo) {
  const ruta = path.join(raiz, archivo);
  if (!fs.existsSync(ruta)) return {};
  return leerArchivoEnv(fs.readFileSync(ruta, 'utf8'));
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
