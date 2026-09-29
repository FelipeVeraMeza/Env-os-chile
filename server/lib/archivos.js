import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';

export const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
});

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MIMES = Object.keys(EXT);
const PREFIJO_SUPABASE = 'sb:';

// ---------- Supabase Storage (bucket privado) ----------
// Las fotos y boletas nunca quedan públicas: el servidor las lee con la clave secreta
// y las entrega solo mediante enlaces firmados temporales (RNF-06).
function cabecerasSupabase(extra = {}) {
  const clave = config.almacenamiento.supabaseKey;
  const h = { apikey: clave, ...extra };
  // Las claves antiguas (service_role) son JWT y también van en Authorization; las nuevas sb_secret_ solo en apikey.
  if (clave.startsWith('eyJ')) h.Authorization = `Bearer ${clave}`;
  return h;
}

function urlStorage(ruta) {
  return `${config.almacenamiento.supabaseUrl}/storage/v1${ruta}`;
}

async function errorSupabase(res, accion) {
  const cuerpo = await res.text().catch(() => '');
  return new Error(`Supabase Storage (${accion}) respondió ${res.status}: ${cuerpo.slice(0, 300)}`);
}

// Crea el bucket privado si no existe. Se llama al iniciar el servidor.
export async function asegurarAlmacenamiento() {
  if (config.almacenamiento.driver === 'local') {
    await fs.mkdir(config.uploadDir, { recursive: true });
    return { driver: 'local', destino: config.uploadDir };
  }
  const { bucket, supabaseUrl, supabaseKey } = config.almacenamiento;
  if (!supabaseUrl || !supabaseKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY');
  let existe = await fetch(urlStorage(`/bucket/${bucket}`), { headers: cabecerasSupabase() });
  for (const alternativa of config.almacenamiento.clavesAlternativas) {
    if (existe.status !== 401 && existe.status !== 403) break;
    if (alternativa === config.almacenamiento.supabaseKey) continue;
    config.almacenamiento.supabaseKey = alternativa;
    existe = await fetch(urlStorage(`/bucket/${bucket}`), { headers: cabecerasSupabase() });
    if (existe.status !== 401 && existe.status !== 403) console.log('[archivos] se usa la clave alternativa de Supabase');
  }
  if (existe.ok) {
    const info = await existe.json();
    if (info.public) console.warn(`[archivos] ATENCIÓN: el bucket "${bucket}" es público. Márcalo como privado en Supabase.`);
    return { driver: 'supabase', destino: bucket };
  }
  if (existe.status === 401 || existe.status === 403) throw await errorSupabase(existe, 'autorización: revisa la clave secreta');
  const crear = await fetch(urlStorage('/bucket'), {
    method: 'POST',
    headers: cabecerasSupabase({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: config.maxUploadMb * 1024 * 1024, allowed_mime_types: MIMES }),
  });
  if (!crear.ok && crear.status !== 409) throw await errorSupabase(crear, 'crear bucket');
  console.log(`[archivos] bucket privado "${bucket}" creado en Supabase Storage`);
  return { driver: 'supabase', destino: bucket };
}

// El tipo que declara el navegador se puede falsear: se confirma mirando los primeros bytes.
export function contenidoCoincide(buffer, mime) {
  if (!buffer || buffer.length < 12) return false;
  const txt = (a, b) => buffer.subarray(a, b).toString('latin1');
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return txt(0, 4) === 'RIFF' && txt(8, 12) === 'WEBP';
  if (mime === 'application/pdf') return txt(0, 5) === '%PDF-';
  return false;
}

export async function guardarArchivo(buffer, mime) {
  if (!contenidoCoincide(buffer, mime)) {
    throw Object.assign(new Error('El archivo no es una imagen o PDF válido'), { archivoInvalido: true });
  }
  const ahora = new Date();
  const carpeta = `${ahora.getFullYear()}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const relativa = `${carpeta}/${crypto.randomUUID()}.${EXT[mime] || 'bin'}`;
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  if (config.almacenamiento.driver === 'supabase') {
    const res = await fetch(urlStorage(`/object/${config.almacenamiento.bucket}/${relativa}`), {
      method: 'POST',
      headers: cabecerasSupabase({ 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': 'private, max-age=300' }),
      body: buffer,
    });
    if (!res.ok) throw await errorSupabase(res, 'subir archivo');
    return { ruta: `${PREFIJO_SUPABASE}${relativa}`, sha256, tamano: buffer.length };
  }

  await fs.mkdir(path.join(config.uploadDir, carpeta), { recursive: true });
  await fs.writeFile(rutaLocal(relativa), buffer);
  return { ruta: relativa, sha256, tamano: buffer.length };
}

// Devuelve el contenido del archivo o null si ya no existe.
export async function leerArchivo(ruta) {
  if (ruta.startsWith(PREFIJO_SUPABASE)) {
    const res = await fetch(urlStorage(`/object/authenticated/${config.almacenamiento.bucket}/${ruta.slice(PREFIJO_SUPABASE.length)}`), {
      headers: cabecerasSupabase(),
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw await errorSupabase(res, 'leer archivo');
    return Buffer.from(await res.arrayBuffer());
  }
  try {
    return await fs.readFile(rutaLocal(ruta));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function rutaLocal(relativa) {
  const abs = path.resolve(config.uploadDir, relativa);
  if (!abs.startsWith(config.uploadDir + path.sep)) throw new Error('Ruta fuera del directorio de archivos');
  return abs;
}

// Enlaces temporales firmados: los archivos nunca son públicos (RNF-06).
export function firmarEnlace(adjuntoId, segundos = 600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${adjuntoId}.${exp}`).digest('base64url');
  return `/api/adjuntos/${adjuntoId}/archivo?exp=${exp}&sig=${sig}`;
}

export function verificarFirma(adjuntoId, exp, sig) {
  if (!exp || !sig || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const esperado = crypto.createHmac('sha256', config.jwtSecret).update(`${adjuntoId}.${exp}`).digest('base64url');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
