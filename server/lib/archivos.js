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

// Guarda el archivo en disco (en Railway: un Volume montado en UPLOAD_DIR).
// Próxima etapa: reemplazar por almacenamiento de objetos (S3 / R2) sin cambiar la interfaz.
export async function guardarArchivo(buffer, mime) {
  const ahora = new Date();
  const carpeta = path.join(String(ahora.getFullYear()), String(ahora.getMonth() + 1).padStart(2, '0'));
  const nombre = `${crypto.randomUUID()}.${EXT[mime] || 'bin'}`;
  await fs.mkdir(path.join(config.uploadDir, carpeta), { recursive: true });
  const relativa = path.join(carpeta, nombre);
  await fs.writeFile(path.join(config.uploadDir, relativa), buffer);
  return { ruta: relativa, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), tamano: buffer.length };
}

export function rutaAbsoluta(relativa) {
  const abs = path.resolve(config.uploadDir, relativa);
  if (!abs.startsWith(config.uploadDir)) throw new Error('Ruta fuera del directorio de archivos');
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
