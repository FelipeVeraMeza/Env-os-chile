import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import { enviarCorreo } from '../lib/correo.js';
import { siguienteFolio } from '../lib/envios.js';
import { conArchivo, leerArchivo, subida } from '../lib/archivos.js';
import { quitarExif } from '../lib/exif.js';
import { MIME_COMPROBANTE } from '../lib/reglas.js';
import {
  EMAIL, ESTADOS_SOPORTE, MOTIVOS_SOPORTE, correoAvisoAdmin, correoCasoCreado, correoRespuestaSoporte, validarCasoSoporte, validarMensajeConversacion,
} from '../lib/soporte.js';
import { registrarEvento } from '../lib/seguridad.js';
import { autenticar, requiereRol, usuarioOpcional } from '../middleware/auth.js';

// Soporte (pedidos 09-10 y 13-10). Cada mensaje es un "caso" con número (SOP-2026-000045) y una conversación de ida y
// vuelta entre quien escribió y administración, con foto o PDF y notas internas que el cliente no ve. Quien escribió
// sin cuenta sigue su caso con un enlace privado (/#/soporte/caso/<token>) que le llega por correo.
export const soporte = Router();

const enlaceCaso = (c) => `${config.publicBaseUrl}/#/soporte/caso/${c.token}`;
const enlaceAdmin = (c) => `${config.publicBaseUrl}/#/soporte/${c.id}`;
const correoDelCliente = (c) => (EMAIL.test(c.contacto || '') ? c.contacto : EMAIL.test(c.usuario_correo || '') ? c.usuario_correo : null);
const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;

const SELECT_CASO = `
  SELECT m.id, m.folio_caso, m.token, m.usuario_id, m.nombre, m.contacto, m.folio, m.motivo, m.mensaje, m.estado, m.respuesta,
    m.respondido_en, m.creado_en, m.actualizado_en, m.no_leido_cliente, u.rol AS usuario_rol, u.correo AS usuario_correo, r.nombre AS respondido_por
  FROM mensaje_soporte m LEFT JOIN usuario u ON u.id = m.usuario_id LEFT JOIN usuario r ON r.id = m.respondido_por`;

// Lo que ve cada uno del caso: el token y el correo de la cuenta solo los ve administración.
function presentarCaso(c, { admin }) {
  const { token, usuario_correo: _correo, ...resto } = c;
  return { ...resto, motivo_texto: MOTIVOS_SOPORTE[c.motivo] || MOTIVOS_SOPORTE.otro, estado_texto: ESTADOS_SOPORTE[c.estado], ...(admin ? { token, enlace: enlaceCaso(c) } : {}) };
}

async function mensajesDelCaso(casoId, { admin }) {
  const { rows } = await query(
    `SELECT s.id, s.autor, s.texto, s.interno, s.creado_en, s.adjunto_mime, s.adjunto_nombre, s.adjunto_ruta IS NOT NULL AS tiene_adjunto,
       CASE WHEN $2::boolean THEN u.nombre END AS autor_nombre
     FROM soporte_mensaje s LEFT JOIN usuario u ON u.id = s.usuario_id
     WHERE s.caso_id = $1 AND ($2::boolean OR NOT s.interno) ORDER BY s.creado_en, s.id`, [casoId, admin]);
  return rows;
}

// Responde 404 (no 403) si el caso es de otra persona: no se confirma que exista.
async function casoAccesible(req) {
  const c = await uno(`${SELECT_CASO} WHERE m.id = $1`, [idNumerico(req.params.id)]);
  if (!c || (req.usuario.rol !== 'admin' && c.usuario_id !== req.usuario.id)) throw falla(404, 'Caso no encontrado');
  return c;
}

async function casoPorToken(req) {
  const token = String(req.params.token || '');
  const c = TOKEN.test(token) ? await uno(`${SELECT_CASO} WHERE m.token = $1`, [token]) : null;
  if (!c) {
    await registrarEvento(req, 'enlace_invalido', { usuarioId: null, detalle: { soporte: true } });
    throw falla(404, 'El enlace del caso no es válido');
  }
  return c;
}

function validarArchivo(file) {
  if (!file) return null;
  if (!MIME_COMPROBANTE.includes(file.mimetype)) throw falla(422, 'Adjunta una imagen (JPG, PNG, WebP) o un PDF', { archivo: 'Formato inválido' });
  return { buffer: file.mimetype === 'image/jpeg' ? quitarExif(file.buffer) : file.buffer, mime: file.mimetype, nombre: String(file.originalname || '').slice(0, 150) };
}

// Guarda un mensaje (con su archivo, si viene) y actualiza el estado del caso:
//   · el cliente escribe → "Por responder" (también reabre un caso cerrado)
//   · administración responde → "Respondido" y el cliente ve el aviso de respuesta nueva
//   · nota interna → no cambia nada para el cliente
async function agregarMensaje(caso, { autor, usuarioId, texto, interno = false, archivo }) {
  const guardar = (guardado) => transaccion(async (db) => {
    const { rows: [m] } = await db.query(
      `INSERT INTO soporte_mensaje (caso_id, autor, usuario_id, texto, interno, adjunto_ruta, adjunto_mime, adjunto_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, autor, texto, interno, creado_en, adjunto_mime, adjunto_nombre, adjunto_ruta IS NOT NULL AS tiene_adjunto`,
      [caso.id, autor, usuarioId ?? null, texto, interno, guardado?.ruta ?? null, archivo?.mime ?? null, archivo?.nombre ?? null]);
    if (autor === 'cliente') {
      await db.query("UPDATE mensaje_soporte SET estado = 'nuevo', actualizado_en = now() WHERE id = $1", [caso.id]);
    } else if (!interno) {
      // "respuesta" guarda la última respuesta (compatibilidad con la versión anterior y vista rápida en la lista).
      await db.query(
        `UPDATE mensaje_soporte SET estado = 'respondido', respuesta = COALESCE(NULLIF($2, ''), respuesta), respondido_por = $3, respondido_en = now(),
           no_leido_cliente = TRUE, actualizado_en = now() WHERE id = $1`, [caso.id, texto, usuarioId]);
    }
    return m;
  });
  return archivo ? conArchivo(archivo.buffer, archivo.mime, guardar) : guardar(null);
}

// Avisos por correo: si fallan, el mensaje igual queda en la plataforma.
function avisar(datos) {
  if (!datos?.para) return Promise.resolve(false);
  return enviarCorreo(datos).catch((err) => { console.error('[soporte] no se pudo enviar el correo', err.message); return false; });
}
async function avisarAdmin(caso, mensaje, esRespuesta) {
  const conf = await leerConfig();
  if (!conf.negocio.correo) return false;
  const c = correoAvisoAdmin({ caso, negocio: conf.negocio, enlace: enlaceAdmin(caso), texto: mensaje || '(adjuntó un archivo)', esRespuesta });
  return avisar({ para: conf.negocio.correo, ...c, responderA: correoDelCliente(caso) || undefined });
}
async function avisarCliente(caso, respuesta) {
  const conf = await leerConfig();
  const c = correoRespuestaSoporte({ caso, negocio: conf.negocio, enlace: enlaceCaso(caso), respuesta: respuesta || 'Te enviamos un archivo.' });
  return avisar({ para: correoDelCliente(caso), ...c, responderA: conf.negocio.correo || undefined });
}

// Mismas protecciones que los demás archivos subidos por usuarios.
async function enviarAdjunto(req, res, m) {
  if (!m?.adjunto_ruta) throw falla(404, 'Archivo no encontrado');
  const contenido = await leerArchivo(m.adjunto_ruta);
  if (!contenido) throw falla(410, 'El archivo ya no está disponible');
  await registrarEvento(req, 'descarga_archivo', { usuarioId: req.usuario?.id ?? null, registros: 1, detalle: { soporte_mensaje: m.id } });
  res.setHeader('Content-Type', m.adjunto_mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[m.adjunto_mime] || 'jpg';
  res.setHeader('Content-Disposition', `${m.adjunto_mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="adjunto-soporte-${m.id}.${ext}"`);
  res.send(contenido);
}

// ---------- Crear un caso (con o sin sesión) ----------
soporte.post('/', subida.single('archivo'), ruta(async (req, res) => {
  const usuario = await usuarioOpcional(req);
  const { datos: d, errores } = validarCasoSoporte(req.body || {}, { conSesion: Boolean(usuario) });
  exigirSinErrores(errores, 'Revisa el mensaje');
  const archivo = validarArchivo(req.file);
  const token = crypto.randomBytes(24).toString('base64url');
  const crear = (guardado) => transaccion(async (db) => {
    const folioCaso = await siguienteFolio(db, 'SOP');
    const { rows: [c] } = await db.query(
      `INSERT INTO mensaje_soporte (usuario_id, nombre, contacto, folio, mensaje, motivo, folio_caso, token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [usuario?.id ?? null, usuario ? usuario.nombre : d.nombre, d.contacto || usuario?.correo || null, d.folio || null, d.mensaje, d.motivo, folioCaso, token]);
    await db.query(
      `INSERT INTO soporte_mensaje (caso_id, autor, usuario_id, texto, adjunto_ruta, adjunto_mime, adjunto_nombre) VALUES ($1, 'cliente', $2, $3, $4, $5, $6)`,
      [c.id, usuario?.id ?? null, d.mensaje, guardado?.ruta ?? null, archivo?.mime ?? null, archivo?.nombre ?? null]);
    return c.id;
  });
  const id = archivo ? await conArchivo(archivo.buffer, archivo.mime, crear) : await crear(null);
  const caso = await uno(`${SELECT_CASO} WHERE m.id = $1`, [id]);
  await auditar(req, 'mensaje_soporte', 'mensaje_soporte', id, { folio_caso: caso.folio_caso });
  avisarAdmin(caso, d.mensaje, false);
  // Sin cuenta, el enlace del caso es la única forma de ver la respuesta en la página: se le manda por correo.
  if (!usuario && EMAIL.test(caso.contacto || '')) {
    leerConfig().then((conf) => avisar({ para: caso.contacto, ...correoCasoCreado({ caso, negocio: conf.negocio, enlace: enlaceCaso(caso) }), responderA: conf.negocio.correo || undefined }));
  }
  res.status(201).json({ ...presentarCaso(caso, { admin: false }), token: caso.token, enlace: enlaceCaso(caso) });
}));

// ---------- Enlace privado del caso (sin sesión) ----------
soporte.get('/caso/:token', ruta(async (req, res) => {
  const c = await casoPorToken(req);
  if (c.no_leido_cliente) await query('UPDATE mensaje_soporte SET no_leido_cliente = FALSE WHERE id = $1', [c.id]);
  const { folio_caso, nombre, folio, motivo, estado, creado_en } = c;
  res.json({ caso: { folio_caso, nombre, folio, motivo, motivo_texto: MOTIVOS_SOPORTE[motivo], estado, estado_texto: ESTADOS_SOPORTE[estado], creado_en }, mensajes: await mensajesDelCaso(c.id, { admin: false }) });
}));

soporte.post('/caso/:token/mensajes', subida.single('archivo'), ruta(async (req, res) => {
  const c = await casoPorToken(req);
  const archivo = validarArchivo(req.file);
  const { texto, errores } = validarMensajeConversacion(req.body || {}, { conArchivo: Boolean(archivo) });
  exigirSinErrores(errores, 'Revisa el mensaje');
  const m = await agregarMensaje(c, { autor: 'cliente', usuarioId: null, texto, archivo });
  await auditar(req, 'mensaje_soporte', 'mensaje_soporte', c.id, { respuesta_cliente: true });
  avisarAdmin(c, texto, true);
  res.status(201).json(m);
}));

soporte.get('/caso/:token/adjuntos/:mensajeId', ruta(async (req, res) => {
  const c = await casoPorToken(req);
  const m = await uno('SELECT * FROM soporte_mensaje WHERE id = $1 AND caso_id = $2 AND NOT interno', [idNumerico(req.params.mensajeId), c.id]);
  await enviarAdjunto(req, res, m);
}));

// ---------- Respuestas rápidas (administración) ----------
soporte.get('/plantillas', autenticar, requiereRol('admin'), ruta(async (_req, res) => {
  res.json((await query('SELECT id, titulo, texto FROM soporte_plantilla ORDER BY titulo, id')).rows);
}));

soporte.post('/plantillas', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const titulo = String(req.body?.titulo ?? '').trim();
  const texto = String(req.body?.texto ?? '').trim();
  const errores = {};
  if (!titulo || titulo.length > 60) errores.titulo = 'Escribe un título (hasta 60 caracteres)';
  if (!texto || texto.length > 2000) errores.texto = 'Escribe el texto (hasta 2000 caracteres)';
  exigirSinErrores(errores, 'Revisa la respuesta rápida');
  const p = await uno('INSERT INTO soporte_plantilla (titulo, texto) VALUES ($1, $2) RETURNING id, titulo, texto', [titulo, texto]);
  await auditar(req, 'crear', 'soporte_plantilla', p.id);
  res.status(201).json(p);
}));

soporte.delete('/plantillas/:id', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const p = await uno('DELETE FROM soporte_plantilla WHERE id = $1 RETURNING id', [idNumerico(req.params.id)]);
  if (!p) throw falla(404, 'Respuesta rápida no encontrada');
  await auditar(req, 'borrar', 'soporte_plantilla', p.id);
  res.json({ ok: true });
}));

// ---------- Con sesión: lista, contadores y conversación ----------
// Administración ve todos (filtros por estado y motivo); el cliente y el repartidor, solo los suyos.
soporte.get('/', autenticar, ruta(async (req, res) => {
  const admin = req.usuario.rol === 'admin';
  const params = [admin];
  const cond = [];
  if (!admin) { params.push(req.usuario.id); cond.push(`m.usuario_id = $${params.length}`); }
  if (req.query.estado) {
    if (!['nuevo', 'respondido', 'cerrado', 'abiertos'].includes(req.query.estado)) throw falla(400, 'Estado inválido');
    if (req.query.estado === 'abiertos') cond.push("m.estado <> 'cerrado'");
    else { params.push(req.query.estado); cond.push(`m.estado = $${params.length}`); }
  }
  if (req.query.motivo) {
    if (!Object.hasOwn(MOTIVOS_SOPORTE, req.query.motivo)) throw falla(400, 'Motivo inválido');
    params.push(req.query.motivo);
    cond.push(`m.motivo = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT x.*,
       (SELECT s.texto FROM soporte_mensaje s WHERE s.caso_id = x.id AND ($1::boolean OR NOT s.interno) ORDER BY s.creado_en DESC, s.id DESC LIMIT 1) AS ultimo_texto,
       (SELECT s.autor FROM soporte_mensaje s WHERE s.caso_id = x.id AND ($1::boolean OR NOT s.interno) ORDER BY s.creado_en DESC, s.id DESC LIMIT 1) AS ultimo_autor,
       (SELECT count(*)::int FROM soporte_mensaje s WHERE s.caso_id = x.id AND ($1::boolean OR NOT s.interno)) AS mensajes
     FROM (${SELECT_CASO} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}) x
     ORDER BY x.actualizado_en DESC, x.id DESC LIMIT 200`, params);
  res.json(rows.map((c) => presentarCaso(c, { admin })));
}));

// Casos por responder: el menú de administración muestra el número junto a "Soporte".
soporte.get('/nuevos', autenticar, requiereRol('admin'), ruta(async (_req, res) => {
  res.json(await uno("SELECT count(*)::int AS nuevos FROM mensaje_soporte WHERE estado = 'nuevo'"));
}));

// Respuestas que el cliente aún no ha visto: su menú muestra el número junto a "Soporte".
soporte.get('/sin-leer', autenticar, ruta(async (req, res) => {
  res.json(await uno('SELECT count(*)::int AS sin_leer FROM mensaje_soporte WHERE usuario_id = $1 AND no_leido_cliente', [req.usuario.id]));
}));

soporte.get('/:id', autenticar, ruta(async (req, res) => {
  const c = await casoAccesible(req);
  const admin = req.usuario.rol === 'admin';
  if (!admin && c.no_leido_cliente) await query('UPDATE mensaje_soporte SET no_leido_cliente = FALSE WHERE id = $1', [c.id]);
  res.json({ caso: presentarCaso(c, { admin }), mensajes: await mensajesDelCaso(c.id, { admin }) });
}));

soporte.post('/:id/mensajes', autenticar, subida.single('archivo'), ruta(async (req, res) => {
  const c = await casoAccesible(req);
  const admin = req.usuario.rol === 'admin';
  const archivo = validarArchivo(req.file);
  const { texto, interno, errores } = validarMensajeConversacion(req.body || {}, { conArchivo: Boolean(archivo) });
  exigirSinErrores(errores, 'Revisa el mensaje');
  const m = await agregarMensaje(c, { autor: admin ? 'admin' : 'cliente', usuarioId: req.usuario.id, texto, interno: admin && interno, archivo });
  await auditar(req, admin ? (m.interno ? 'nota_soporte' : 'responder_soporte') : 'mensaje_soporte', 'mensaje_soporte', c.id);
  let correoEnviado = false;
  if (admin && !m.interno) correoEnviado = await avisarCliente(c, texto);
  if (!admin) avisarAdmin(c, texto, true);
  res.status(201).json({ ...m, correo_enviado: correoEnviado });
}));

// Compatibilidad con la versión anterior: responder = un mensaje de administración visible para el cliente.
soporte.post('/:id/responder', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const c = await casoAccesible(req);
  const { texto, errores } = validarMensajeConversacion({ texto: req.body?.respuesta });
  if (errores.texto) throw falla(422, 'Escribe la respuesta', { respuesta: errores.texto });
  await agregarMensaje(c, { autor: 'admin', usuarioId: req.usuario.id, texto });
  await auditar(req, 'responder_soporte', 'mensaje_soporte', c.id);
  const correoEnviado = await avisarCliente(c, texto);
  const act = await uno('SELECT id, estado, respuesta, respondido_en FROM mensaje_soporte WHERE id = $1', [c.id]);
  res.json({ ...act, correo_enviado: correoEnviado });
}));

soporte.get('/:id/adjuntos/:mensajeId', autenticar, ruta(async (req, res) => {
  const c = await casoAccesible(req);
  const m = await uno('SELECT * FROM soporte_mensaje WHERE id = $1 AND caso_id = $2', [idNumerico(req.params.mensajeId), c.id]);
  if (m?.interno && req.usuario.rol !== 'admin') throw falla(404, 'Archivo no encontrado');
  await enviarAdjunto(req, res, m);
}));

// Cerrar (ya atendido, p. ej. por WhatsApp o teléfono) o volver a abrir un caso.
soporte.patch('/:id', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const estado = req.body?.estado;
  if (!['cerrado', 'nuevo'].includes(estado)) throw falla(422, 'Estado inválido');
  const m = await uno(
    `UPDATE mensaje_soporte SET estado = CASE WHEN $2::text = 'nuevo' AND respuesta IS NOT NULL THEN 'respondido' ELSE $2::text END, actualizado_en = now()
     WHERE id = $1 RETURNING id, estado`, [id, estado]);
  if (!m) throw falla(404, 'Mensaje no encontrado');
  await auditar(req, estado === 'cerrado' ? 'cerrar_soporte' : 'reabrir_soporte', 'mensaje_soporte', id);
  res.json(m);
}));
