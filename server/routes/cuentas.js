import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { config } from '../config.js';
import { query, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, limitador, ruta } from '../lib/http.js';
import { normalizarRut, normalizarTelefono, ROLES } from '../lib/reglas.js';
import { autenticar, exigirClaveDemo, requiereRol } from '../middleware/auth.js';
import { leerConfig } from '../lib/configuracion.js';
import { correoConfigurado, enviarCorreo } from '../lib/correo.js';

export const auth = Router();

// Límite de intentos de inicio de sesión por IP (10 por 15 min).
const limiteLogin = limitador({ nombre: 'login', max: 10, ventanaMs: 15 * 60 * 1000, mensaje: 'Demasiados intentos. Espera unos minutos.' });

auth.post('/login', limiteLogin, ruta(async (req, res) => {
  const { correo, password } = req.body || {};
  const u = await uno('SELECT * FROM usuario WHERE correo = $1', [String(correo || '').toLowerCase().trim()]);
  if (!u || !u.activo || !u.password_hash || !(await bcrypt.compare(String(password || ''), u.password_hash))) {
    throw falla(401, 'Correo o contraseña incorrectos');
  }
  const token = jwt.sign({ sub: u.id, rol: u.rol }, config.jwtSecret, { expiresIn: `${config.jwtDias}d` });
  req.usuario = u;
  await auditar(req, 'login', 'usuario', u.id);
  res.json({ token, usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol } });
}));

auth.get('/yo', autenticar, (req, res) => res.json(req.usuario));

// ---------- Contraseñas (RF-02) ----------
const MINIMO_PASSWORD = 8;
const validarNueva = (password) => (String(password || '').length < MINIMO_PASSWORD ? `Mínimo ${MINIMO_PASSWORD} caracteres` : null);
const sello = (u) => (u.password_cambiado_en ? new Date(u.password_cambiado_en).getTime() : 0);

// Enlace de un solo uso (1 hora): deja de servir cuando la contraseña cambia.
function enlaceRestablecer(u) {
  const token = jwt.sign({ sub: u.id, tipo: 'restablecer', pc: sello(u) }, config.jwtSecret, { expiresIn: '1h' });
  return `${config.publicBaseUrl}/#/restablecer/${token}`;
}

async function fijarPassword(db, id, password) {
  await db.query('UPDATE usuario SET password_hash = $1, password_cambiado_en = now() WHERE id = $2', [await bcrypt.hash(password, 10), id]);
}

auth.post('/cambiar-password', autenticar, ruta(async (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = await uno('SELECT id, password_hash FROM usuario WHERE id = $1', [req.usuario.id]);
  if (u.password_hash && !(await bcrypt.compare(String(actual || ''), u.password_hash))) throw falla(422, 'La contraseña actual no es correcta', { actual: 'Incorrecta' });
  const error = validarNueva(nueva);
  if (error) throw falla(422, error, { nueva: error });
  await fijarPassword({ query }, u.id, nueva);
  await auditar(req, 'cambiar_password', 'usuario', u.id);
  // Las demás sesiones abiertas quedan cerradas; esta recibe un token nuevo.
  const token = jwt.sign({ sub: u.id, rol: req.usuario.rol }, config.jwtSecret, { expiresIn: `${config.jwtDias}d` });
  res.json({ ok: true, token });
}));

// Siempre responde lo mismo, exista o no el correo (no revela qué cuentas existen).
const limiteRecuperar = limitador({ nombre: 'recuperar', max: 10, ventanaMs: 15 * 60 * 1000, mensaje: 'Demasiadas solicitudes. Espera unos minutos.' });
const limiteRestablecer = limitador({ nombre: 'restablecer', max: 20, ventanaMs: 15 * 60 * 1000, mensaje: 'Demasiados intentos. Espera unos minutos.' });
auth.post('/recuperar', limiteRecuperar, ruta(async (req, res) => {
  const correo = String(req.body?.correo || '').toLowerCase().trim();
  const u = correo ? await uno('SELECT id, nombre, correo, activo, password_cambiado_en FROM usuario WHERE correo = $1', [correo]) : null;
  if (u?.activo && correoConfigurado()) {
    const conf = await leerConfig();
    await enviarCorreo({
      para: u.correo,
      asunto: `${conf.negocio.nombre}: restablecer tu contraseña`,
      texto: `Hola ${u.nombre}:\n\nPara crear una nueva contraseña abre este enlace (vale por 1 hora y una sola vez):\n${enlaceRestablecer(u)}\n\nSi no lo pediste, ignora este correo.`,
    }).catch((err) => console.error('[correo] no se pudo enviar', err.message));
    req.usuario = u;
    await auditar(req, 'recuperar_password', 'usuario', u.id);
  }
  res.json({
    ok: true,
    mensaje: correoConfigurado()
      ? 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña.'
      : 'Pide a administración un enlace para restablecer tu contraseña.',
  });
}));

auth.post('/restablecer', limiteRestablecer, ruta(async (req, res) => {
  const { token, password } = req.body || {};
  let datos;
  try { datos = jwt.verify(String(token || ''), config.jwtSecret); } catch { datos = null; }
  if (datos?.tipo !== 'restablecer') throw falla(400, 'El enlace no es válido o ya venció. Pide uno nuevo.');
  const u = await uno('SELECT id, rol, activo, password_cambiado_en FROM usuario WHERE id = $1', [datos.sub]);
  if (!u?.activo || sello(u) !== datos.pc) throw falla(400, 'El enlace ya fue usado o venció. Pide uno nuevo.');
  const error = validarNueva(password);
  if (error) throw falla(422, error, { password: error });
  await fijarPassword({ query }, u.id, password);
  req.usuario = u;
  await auditar(req, 'restablecer_password', 'usuario', u.id);
  res.json({ ok: true });
}));

// Registro de clientes por su cuenta (RF-56): solo si administración lo habilita en Tarifas y reglas.
const limiteRegistro = limitador({ nombre: 'registro', max: 30, ventanaMs: 60 * 60 * 1000, mensaje: 'Demasiados registros desde esta conexión. Intenta más tarde.' });
auth.post('/registro', limiteRegistro, ruta(async (req, res) => {
  const conf = await leerConfig();
  if (!conf.operacion.registro_clientes) throw falla(403, 'El registro está cerrado: pide tu cuenta a administración');
  const b = { ...(req.body || {}), rol: 'cliente' };
  exigirSinErrores(validarUsuario(b, true));
  if (!normalizarTelefono(b.telefono)) exigirSinErrores({ telefono: 'Teléfono móvil chileno obligatorio (+56 9…)' });
  const error = validarNueva(b.password);
  if (error) exigirSinErrores({ password: error });
  if (await uno('SELECT id FROM usuario WHERE correo = $1', [b.correo.toLowerCase()])) throw falla(409, 'Ya existe una cuenta con ese correo', { correo: 'Ya registrado' });
  const u = await uno(
    `INSERT INTO usuario (nombre, correo, password_hash, rol, telefono, rut, password_cambiado_en) VALUES ($1, $2, $3, 'cliente', $4, $5, now())
     RETURNING id, nombre, correo, rol`,
    [b.nombre.trim(), b.correo.toLowerCase(), await bcrypt.hash(b.password, 10), normalizarTelefono(b.telefono), normalizarRut(b.rut)]);
  req.usuario = u;
  await auditar(req, 'registro', 'usuario', u.id);
  const token = jwt.sign({ sub: u.id, rol: u.rol }, config.jwtSecret, { expiresIn: `${config.jwtDias}d` });
  res.status(201).json({ token, usuario: u });
}));

// Perfiles para el modo demostración (sin inicio de sesión).
export const demo = Router();
demo.get('/usuarios', ruta(async (req, res) => {
  if (config.authMode !== 'demo') throw falla(404, 'No disponible');
  exigirClaveDemo(req);
  const { rows } = await query("SELECT id, nombre, rol FROM usuario WHERE activo AND correo NOT LIKE 'qa-%' ORDER BY CASE rol WHEN 'admin' THEN 0 WHEN 'cliente' THEN 1 ELSE 2 END, id");
  res.json(rows);
}));

export const usuarios = Router();
usuarios.use(autenticar);

usuarios.get('/', requiereRol('admin'), ruta(async (req, res) => {
  const params = [];
  let where = '';
  if (ROLES.includes(req.query.rol)) { params.push(req.query.rol); where = 'WHERE rol = $1'; }
  const { rows } = await query(`SELECT id, nombre, correo, rol, telefono, rut, activo, creado_en FROM usuario ${where} ORDER BY rol, nombre`, params);
  res.json(rows);
}));

// Lista mínima de repartidores para asignar (sin datos sensibles).
usuarios.get('/repartidores', requiereRol('admin'), ruta(async (_req, res) => {
  const { rows } = await query("SELECT id, nombre, telefono FROM usuario WHERE rol = 'repartidor' AND activo ORDER BY nombre");
  res.json(rows);
}));

function validarUsuario(b, nuevo) {
  const e = {};
  if (nuevo || b.nombre !== undefined) if (!String(b.nombre || '').trim()) e.nombre = 'Obligatorio';
  if (nuevo || b.correo !== undefined) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.correo || '')) e.correo = 'Correo inválido';
  if (nuevo || b.rol !== undefined) if (!ROLES.includes(b.rol)) e.rol = 'Rol inválido';
  if (b.telefono && !normalizarTelefono(b.telefono)) e.telefono = 'Teléfono inválido';
  if (b.rut && !normalizarRut(b.rut)) e.rut = 'RUT inválido';
  if (b.password !== undefined && String(b.password).length < 8) e.password = 'Mínimo 8 caracteres';
  return e;
}

usuarios.post('/', requiereRol('admin'), ruta(async (req, res) => {
  const b = req.body || {};
  exigirSinErrores(validarUsuario(b, true));
  const existe = await uno('SELECT id FROM usuario WHERE correo = $1', [b.correo.toLowerCase()]);
  if (existe) throw falla(409, 'Ya existe un usuario con ese correo', { correo: 'Duplicado' });
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const u = await uno(
    `INSERT INTO usuario (nombre, correo, password_hash, rol, telefono, rut) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, nombre, correo, rol, telefono, rut, activo, creado_en`,
    [b.nombre.trim(), b.correo.toLowerCase(), hash, b.rol, normalizarTelefono(b.telefono), normalizarRut(b.rut)],
  );
  await auditar(req, 'crear', 'usuario', u.id, { rol: u.rol });
  res.status(201).json(u);
}));

// Administración genera un enlace para que la persona cree una nueva contraseña (lo comparte por WhatsApp o correo).
usuarios.post('/:id/restablecer', requiereRol('admin'), ruta(async (req, res) => {
  const u = await uno('SELECT id, nombre, correo, activo, password_cambiado_en FROM usuario WHERE id = $1', [idNumerico(req.params.id)]);
  if (!u) throw falla(404, 'Usuario no encontrado');
  if (!u.activo) throw falla(409, 'El usuario está desactivado');
  await auditar(req, 'enlace_password', 'usuario', u.id);
  res.json({ enlace: enlaceRestablecer(u), vence_en_min: 60 });
}));

usuarios.patch('/:id', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const b = req.body || {};
  exigirSinErrores(validarUsuario(b, false));
  if (id === req.usuario.id && (b.activo === false || (b.rol && b.rol !== 'admin'))) throw falla(409, 'No puedes quitarte tu propio acceso de administrador');
  // Un repartidor con envíos en curso no se desactiva ni cambia de perfil: primero hay que reasignarlos.
  if (b.activo === false || (b.rol && b.rol !== 'repartidor')) {
    const pendientes = await uno(
      "SELECT count(*)::int AS n FROM envio WHERE repartidor_id = $1 AND estado IN ('asignado','en_ruta','fallido','reagendado')", [id]);
    if (pendientes.n) throw falla(409, `Tiene ${pendientes.n} envío(s) en curso. Reasígnalos antes de desactivarlo.`, { envios_pendientes: pendientes.n });
  }
  const sets = [];
  const params = [];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.nombre !== undefined) set('nombre', b.nombre.trim());
  if (b.rol !== undefined) set('rol', b.rol);
  if (b.telefono !== undefined) set('telefono', normalizarTelefono(b.telefono));
  if (b.rut !== undefined) set('rut', normalizarRut(b.rut));
  if (b.activo !== undefined) set('activo', Boolean(b.activo));
  if (b.password) { set('password_hash', await bcrypt.hash(b.password, 10)); sets.push('password_cambiado_en = now()'); }
  if (!sets.length) throw falla(400, 'Nada que actualizar');
  params.push(id);
  const u = await uno(`UPDATE usuario SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, nombre, correo, rol, telefono, rut, activo`, params);
  if (!u) throw falla(404, 'Usuario no encontrado');
  await auditar(req, 'editar', 'usuario', id, { ...b, password: b.password ? '***' : undefined });
  res.json(u);
}));
