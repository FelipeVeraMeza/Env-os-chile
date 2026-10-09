import { Router } from 'express';
import { query, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import { enviarCorreo } from '../lib/correo.js';
import { autenticar, requiereRol, usuarioOpcional } from '../middleware/auth.js';

// Soporte (pedido 09-10): cualquiera escribe desde el inicio de la página (sin sesión, dejando cómo contactarlo) o
// desde su cuenta; los mensajes llegan a administración, que responde ahí mismo. El cliente ve la respuesta en su cuenta.
export const soporte = Router();

const LARGO = { nombre: 80, contacto: 120, mensaje: 2000, respuesta: 2000 };
const texto = (v) => String(v ?? '').trim();

export function validarMensajeSoporte(b, { conSesion }) {
  const d = { nombre: texto(b.nombre), contacto: texto(b.contacto), folio: texto(b.folio).toUpperCase(), mensaje: texto(b.mensaje) };
  const errores = {};
  if (!conSesion) {
    if (d.nombre.length < 2) errores.nombre = 'Escribe tu nombre';
    // Sin sesión es la única forma de responderle: correo o teléfono.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.contacto) && d.contacto.replace(/\D/g, '').length < 8) errores.contacto = 'Escribe tu correo o tu teléfono para responderte';
  }
  for (const k of ['nombre', 'contacto', 'mensaje']) if (d[k].length > LARGO[k]) errores[k] = `Máximo ${LARGO[k]} caracteres`;
  if (d.folio && !/^ENV-\d{4}-\d{6,9}$/.test(d.folio)) errores.folio = 'Folio con formato inválido (ej. ENV-2026-000123)';
  if (d.mensaje.length < 5) errores.mensaje = 'Cuéntanos en qué te podemos ayudar';
  return { datos: d, errores };
}

soporte.post('/', ruta(async (req, res) => {
  const usuario = await usuarioOpcional(req);
  const { datos: d, errores } = validarMensajeSoporte(req.body || {}, { conSesion: Boolean(usuario) });
  exigirSinErrores(errores, 'Revisa el mensaje');
  const m = await uno(
    `INSERT INTO mensaje_soporte (usuario_id, nombre, contacto, folio, mensaje) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, nombre, contacto, folio, mensaje, estado, creado_en`,
    [usuario?.id ?? null, usuario ? usuario.nombre : d.nombre, d.contacto || usuario?.correo || null, d.folio || null, d.mensaje]);
  await auditar(req, 'mensaje_soporte', 'mensaje_soporte', m.id);
  // Aviso por correo a la empresa si hay correo configurado; si falla, el mensaje igual queda en la bandeja.
  const conf = await leerConfig();
  if (conf.negocio.correo) {
    enviarCorreo({
      para: conf.negocio.correo,
      asunto: `Soporte: nuevo mensaje de ${m.nombre}`,
      texto: `${m.nombre}${m.contacto ? ` (${m.contacto})` : ''}${m.folio ? ` · envío ${m.folio}` : ''} escribió:\n\n${m.mensaje}\n\nRespóndelo desde Soporte en la plataforma.`,
    }).catch((err) => console.error('[soporte] no se pudo avisar por correo', err.message));
  }
  res.status(201).json(m);
}));

// Administración ve todos (con filtro por estado); el cliente y el repartidor, solo los suyos.
soporte.get('/', autenticar, ruta(async (req, res) => {
  const params = [];
  const cond = [];
  if (req.usuario.rol !== 'admin') { params.push(req.usuario.id); cond.push(`m.usuario_id = $${params.length}`); }
  if (req.query.estado) {
    if (!['nuevo', 'respondido', 'cerrado', 'abiertos'].includes(req.query.estado)) throw falla(400, 'Estado inválido');
    if (req.query.estado === 'abiertos') cond.push("m.estado <> 'cerrado'");
    else { params.push(req.query.estado); cond.push(`m.estado = $${params.length}`); }
  }
  const { rows } = await query(
    `SELECT m.id, m.nombre, m.contacto, m.folio, m.mensaje, m.estado, m.respuesta, m.respondido_en, m.creado_en, m.usuario_id,
            u.rol AS usuario_rol, r.nombre AS respondido_por
     FROM mensaje_soporte m LEFT JOIN usuario u ON u.id = m.usuario_id LEFT JOIN usuario r ON r.id = m.respondido_por
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY m.creado_en DESC, m.id DESC LIMIT 200`, params);
  res.json(rows);
}));

// Cantidad de mensajes sin responder: el menú de administración la muestra junto a "Soporte".
soporte.get('/nuevos', autenticar, requiereRol('admin'), ruta(async (_req, res) => {
  res.json(await uno("SELECT count(*)::int AS nuevos FROM mensaje_soporte WHERE estado = 'nuevo'"));
}));

soporte.post('/:id/responder', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const respuesta = texto(req.body?.respuesta);
  if (!respuesta) throw falla(422, 'Escribe la respuesta', { respuesta: 'Escribe la respuesta' });
  if (respuesta.length > LARGO.respuesta) throw falla(422, `Máximo ${LARGO.respuesta} caracteres`, { respuesta: `Máximo ${LARGO.respuesta} caracteres` });
  const m = await uno(
    `UPDATE mensaje_soporte SET respuesta = $2, estado = 'respondido', respondido_por = $3, respondido_en = now() WHERE id = $1
     RETURNING id, estado, nombre, contacto, folio, mensaje, respuesta, respondido_en`, [id, respuesta, req.usuario.id]);
  if (!m) throw falla(404, 'Mensaje no encontrado');
  await auditar(req, 'responder_soporte', 'mensaje_soporte', id);
  // Si dejó un correo (o es el de su cuenta) y hay correo configurado, la respuesta también le llega por correo.
  let correoEnviado = false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.contacto || '')) {
    const conf = await leerConfig();
    correoEnviado = await enviarCorreo({
      para: m.contacto,
      asunto: `Respuesta de ${conf.negocio.nombre}${m.folio ? ` · envío ${m.folio}` : ''}`,
      texto: `Hola ${m.nombre}:\n\n${m.respuesta}\n\n— ${conf.negocio.nombre}\n\nTu mensaje:\n${m.mensaje}`,
    }).catch((err) => { console.error('[soporte] no se pudo enviar la respuesta por correo', err.message); return false; });
  }
  res.json({ id: m.id, estado: m.estado, respuesta: m.respuesta, respondido_en: m.respondido_en, correo_enviado: correoEnviado });
}));

// Cerrar (ya atendido, p. ej. por WhatsApp o teléfono) o volver a abrir un mensaje.
soporte.patch('/:id', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const estado = req.body?.estado;
  if (!['cerrado', 'nuevo'].includes(estado)) throw falla(422, 'Estado inválido');
  const m = await uno(
    `UPDATE mensaje_soporte SET estado = CASE WHEN $2::text = 'nuevo' AND respuesta IS NOT NULL THEN 'respondido' ELSE $2::text END WHERE id = $1
     RETURNING id, estado`, [id, estado]);
  if (!m) throw falla(404, 'Mensaje no encontrado');
  await auditar(req, estado === 'cerrado' ? 'cerrar_soporte' : 'reabrir_soporte', 'mensaje_soporte', id);
  res.json(m);
}));
