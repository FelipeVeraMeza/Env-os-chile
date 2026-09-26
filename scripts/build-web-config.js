// Genera web/config.js a partir de entornos.env (o de variables de entorno en Vercel).
//   API_URL (variable de Vercel) tiene prioridad; si no, se usa API_OBJETIVO de entornos.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEntornos } from '../qa/entornos.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vars = cargarEntornos();
const limpio = (u) => (u && !u.includes('CAMBIAR-POR') ? u.replace(/\/+$/, '') : '');
const urls = {
  local: limpio(vars.URL_LOCAL || 'http://localhost:3000'),
  railway: limpio(vars.URL_RAILWAY),
  produccion: limpio(vars.URL_PRODUCCION),
  mismo_origen: '',
};
const objetivo = process.env.API_OBJETIVO || vars.API_OBJETIVO || 'mismo_origen';
const apiUrl = limpio(process.env.API_URL) || urls[objetivo] || '';
if (objetivo !== 'mismo_origen' && !apiUrl) {
  console.warn(`[config] API_OBJETIVO=${objetivo} pero su URL no está definida en entornos.env; se usará el mismo origen.`);
}

const config = { API_URL: apiUrl, URL_LOCAL: urls.local, URL_RAILWAY: urls.railway, URL_PRODUCCION: urls.produccion };
const contenido = `// Archivo generado por "npm run build:web" desde entornos.env. No editar a mano.\nwindow.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync(path.join(raiz, 'web', 'config.js'), contenido);
console.log(`[config] web/config.js → API_URL = ${apiUrl || '(mismo origen)'}`);
