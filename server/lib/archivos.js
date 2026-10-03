import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';

export const subida = multer({
  storage: multer.memoryStorage(),
  // Los navegadores envían el nombre del archivo en UTF-8: leído como latin1 (el valor por defecto) "cañón.jpg"
  // quedaba guardado como "caÃ±Ã³n.jpg" en la ficha del envío y en la descarga.
  defParamCharset: 'utf8',
  // Límites también para los campos de texto: evita formularios gigantes que agoten la memoria.
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 40, fieldSize: 64 * 1024, parts: 45 },
});

// Entrega: la foto y, opcionalmente, la firma del destinatario (pedido 03-10). Mismos límites, dos archivos.
export const subidaEntrega = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 2, fields: 40, fieldSize: 64 * 1024, parts: 46 },
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

// Borra archivos (fotos, boletas, comprobantes) del disco o del bucket. Devuelve cuántos se borraron.
// Se usa al reiniciar la plataforma: no deben quedar datos personales sueltos en el almacenamiento.
export async function borrarArchivos(rutas) {
  const enSupabase = rutas.filter((r) => r.startsWith(PREFIJO_SUPABASE)).map((r) => r.slice(PREFIJO_SUPABASE.length));
  let borrados = 0;
  for (let i = 0; i < enSupabase.length; i += 500) {
    const res = await fetch(urlStorage(`/object/${config.almacenamiento.bucket}`), {
      method: 'DELETE',
      headers: cabecerasSupabase({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: enSupabase.slice(i, i + 500) }),
    });
    if (!res.ok) throw await errorSupabase(res, 'borrar archivos');
    borrados += (await res.json()).length;
  }
  for (const r of rutas.filter((x) => !x.startsWith(PREFIJO_SUPABASE))) {
    try { await fs.unlink(rutaLocal(r)); borrados++; } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  return borrados;
}

// Guarda el archivo y ejecuta la operación que lo registra. Si la operación falla (409 por otra persona, error de la
// base…), el archivo ya subido se borra: si no, quedaría en el almacenamiento sin ningún registro que lo use.
export async function conArchivo(buffer, mime, operacion) {
  const archivo = await guardarArchivo(buffer, mime);
  try {
    return await operacion(archivo);
  } catch (err) {
    await borrarArchivos([archivo.ruta]).catch((e) => console.error('[archivos] no se pudo borrar un archivo sin uso', e.message));
    throw err;
  }
}

function rutaLocal(relativa) {
  const abs = path.resolve(config.uploadDir, relativa);
  if (!abs.startsWith(config.uploadDir + path.sep)) throw new Error('Ruta fuera del directorio de archivos');
  return abs;
}

// Enlaces temporales firmados: los archivos nunca son públicos (RNF-06). La firma incluye a quién se le
// entregó el enlace, así cada descarga queda atribuida a un usuario en la bitácora de seguridad.
const firma = (adjuntoId, exp, usuarioId) => crypto.createHmac('sha256', config.jwtSecret).update(`${adjuntoId}.${exp}.${usuarioId}`).digest('base64url');

export function firmarEnlace(adjuntoId, usuarioId, segundos = 600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return `/api/adjuntos/${adjuntoId}/archivo?exp=${exp}&u=${usuarioId}&sig=${firma(adjuntoId, exp, usuarioId)}`;
}

export function verificarFirma(adjuntoId, exp, usuarioId, sig) {
  return firmaValida(firma(adjuntoId, exp, usuarioId), exp, usuarioId, sig);
}

function firmaValida(esperada, exp, usuarioId, sig) {
  if (!exp || !sig || !/^\d+$/.test(String(usuarioId || '')) || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Etiqueta por enlace firmado (pedido 03-10): el botón es un enlace normal y el celular abre el PDF en su visor.
// Antes la app descargaba el PDF y recién después abría una pestaña; los navegadores del celular bloquean esa
// pestaña (ya no cuenta como toque del usuario) y la etiqueta "no salía". El prefijo separa estas firmas de las de adjuntos.
const firmaRecurso = (recurso, exp, usuarioId) => crypto.createHmac('sha256', config.jwtSecret).update(`${recurso}.${exp}.${usuarioId}`).digest('base64url');

export function firmarTicket(envioId, usuarioId, segundos = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return `/api/tickets/${envioId}?exp=${exp}&u=${usuarioId}&sig=${firmaRecurso(`ticket.${envioId}`, exp, usuarioId)}`;
}

export function verificarTicket(envioId, exp, usuarioId, sig) {
  return firmaValida(firmaRecurso(`ticket.${envioId}`, exp, usuarioId), exp, usuarioId, sig);
}

// Etiquetas del día en lote (solo administración): la firma cubre la fecha, así el enlace no sirve para otro día.
export function firmarLote(fecha, usuarioId, segundos = 12 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + segundos;
  return `/api/tickets/lote?fecha=${fecha}&exp=${exp}&u=${usuarioId}&sig=${firmaRecurso(`lote.${fecha}`, exp, usuarioId)}`;
}

export function verificarLote(fecha, exp, usuarioId, sig) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) && firmaValida(firmaRecurso(`lote.${fecha}`, exp, usuarioId), exp, usuarioId, sig);
}
