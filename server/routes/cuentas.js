import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { config } from '../config.js';
import { query, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, limitador, ruta } from '../lib/http.js';
import { normalizarRut, normalizarTelefono, ROLES } from '../lib/reglas.js';
import { autenticar, exigirClaveDemo, firmarSesion, requiereRol } from '../middleware/auth.js';
import { exigirClaveSegura, registrarEvento } from '../lib/seguridad.js';
import { leerConfig } from '../lib/configuracion.js';
import { correoConfigurado, enviarCorreo } from '../lib/correo.js';

export const auth = Router();

// Límite de intentos FALLIDOS de inicio de sesión cada 15 minutos: 5 por correo (protege cada cuenta)
// y 50 por IP (una oficina comparte IP: no se bloquea a todos por los errores de uno).
// Un inicio correcto limpia el contador de ese correo.
const VENTANA = 15 * 60 * 1000;
const fallidos = new Map();
function contar(clave) {
  const ahora = Date.now();
  const reg = fallidos.get(clave);
  return reg && ahora - reg.desde < VENTANA ? reg : null;
}
function registrarFallo(clave) {
  const reg = contar(clave) || { n: 0, desde: Date.now() };
  reg.n += 1;
  fallidos.set(clave, reg);
}
setInterval(() => { for (const [k, r] of fallidos) if (Date.now() - r.desde > VENTANA) fallidos.delete(k); }, VENTANA).unref();

// Hash de relleno: con un correo inexistente se compara igual, para no revelar qué correos existen por el tiempo de respuesta.
const HASH_RELLENO = bcrypt.hashSync('relleno-no-es-una-clave', 10);

auth.post('/login', ruta(async (req, res) => {
  const correo = String(req.body?.correo || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  const claves = [`ip:${req.ip}`, `correo:${correo}`];
  if ((contar(claves[0])?.n || 0) >= 50 || (contar(claves[1])?.n || 0) >= 5) {
    await registrarEvento(req, 'cuenta_bloqueada', { usuarioId: null, correo });
    throw falla(429, 'Demasiados intentos fallidos. Espera 15 minutos o pide a administración una nueva contraseña.');
  }
  if (!correo || !password) throw falla(422, 'Ingresa tu correo y tu contraseña', { ...(correo ? {} : { correo: 'Obligatorio' }), ...(password ? {} : { password: 'Obligatoria' }) });
  const u = await uno('SELECT * FROM usuario WHERE correo = $1', [correo]);
  const ok = await bcrypt.compare(password, u?.password_hash || HASH_RELLENO);
  if (!u || !u.password_hash || !ok) {
    claves.forEach(registrarFallo);
    await registrarEvento(req, 'login_fallido', { usuarioId: u?.id ?? null, correo, detalle: { motivo: !u ? 'correo_inexistente' : !u.password_hash ? 'sin_contraseña' : 'contraseña_incorrecta' } });
    throw falla(401, 'Correo o contraseña incorrectos');
  }
  if (!u.activo) {
    await registrarEvento(req, 'login_fallido', { usuarioId: u.id, correo, detalle: { motivo: 'cuenta_desactivada' } });
    throw falla(403, 'Tu cuenta está desactivada. Contacta a administración.');
  }
  fallidos.delete(claves[1]);
  await query('UPDATE usuario SET ultimo_acceso = now() WHERE id = $1', [u.id]);
  req.usuario = u;
  await auditar(req, 'login', 'usuario', u.id);
  await registrarEvento(req, 'login_ok', { usuarioId: u.id, correo });
  res.json({ token: firmarSesion(u), usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, debe_cambiar_clave: u.debe_cambiar_clave } });
}));

auth.get('/yo', autenticar, (req, res) => res.json(req.usuario));

// Cambio de la propia contraseña: exige la actual. Cierra las demás sesiones y entrega una nueva.
async function cambiarClavePropia(req, res) {
  const { actual, nueva } = req.body || {};
  const u = await uno('SELECT * FROM usuario WHERE id = $1', [req.usuario.id]);
  const errores = {};
  if (!u.password_hash || !(await bcrypt.compare(String(actual || ''), u.password_hash))) errores.actual = 'La contraseña actual no es correcta';
  if (String(nueva) === String(actual)) errores.nueva = 'Debe ser distinta a la actual';
  exigirSinErrores(errores, 'Revisa las contraseñas');
  exigirClaveSegura(nueva, u, 'nueva');
  const act = await fijarPassword(u.id, nueva);
  await auditar(req, 'cambiar_clave', 'usuario', u.id);
  await registrarEvento(req, 'cambio_clave');
  res.json({ ok: true, token: firmarSesion(act) });
}
auth.post('/cambiar-clave', autenticar, ruta(cambiarClavePropia));
auth.post('/cambiar-password', autenticar, ruta(cambiarClavePropia)); // nombre usado por versiones anteriores de la interfaz

// Cerrar la sesión en todos los dispositivos (por ejemplo, si se perdió el teléfono).
auth.post('/cerrar-sesiones', autenticar, ruta(async (req, res) => {
  const act = await uno('UPDATE usuario SET sesion_version = sesion_version + 1 WHERE id = $1 RETURNING id, rol, sesion_version', [req.usuario.id]);
  await registrarEvento(req, 'sesiones_cerradas', { detalle: { alcance: 'propias' } });
  res.json({ token: firmarSesion(act) });
}));

// ---------- Recuperar la contraseña (RF-02) ----------
// Una contraseña nueva siempre: queda con hash, cierra todas las sesiones abiertas e invalida los enlaces anteriores.
async function fijarPassword(id, password, { debeCambiar = false } = {}) {
  return uno(
    `UPDATE usuario SET password_hash = $1, password_cambiado_en = now(), sesion_version = sesion_version + 1, debe_cambiar_clave = $2
     WHERE id = $3 RETURNING id, rol, sesion_version`, [await bcrypt.hash(String(password), 10), debeCambiar, id]);
}
const sello = (u) => (u.password_cambiado_en ? new Date(u.password_cambiado_en).getTime() : 0);

// Enlace de un solo uso (1 hora): deja de servir cuando la contraseña cambia. Nunca sirve como sesión (lleva "tipo").
function enlaceRestablecer(u) {
  const token = jwt.sign({ sub: u.id, tipo: 'restablecer', pc: sello(u) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  return `${config.publicBaseUrl}/#/restablecer/${token}`;
}

// Siempre responde lo mismo, exista o no el correo (no revela qué cuentas existen).
const limiteRecuperar = limitador({ nombre: 'recuperar', max: 10, ventanaMs: 15 * 60 * 1000, mensaje: 'Demasiadas solicitudes. Espera unos minutos.' });
const limiteRestablecer = limitador({ nombre: 'restablecer', max: 20, ventanaMs: 15 * 60 * 1000, mensaje: 'Demasiados intentos. Espera unos minutos.' });
auth.post('/recuperar', limiteRecuperar, ruta(async (req, res) => {
  const correo = String(req.body?.correo || '').toLowerCase().trim();
  const u = correo ? await uno('SELECT id, nombre, correo, activo, password_cambiado_en FROM usuario WHERE correo = $1', [correo]) : null;
  await registrarEvento(req, 'recuperacion_solicitada', { usuarioId: u?.id ?? null, correo, detalle: { existe: Boolean(u) } });
  if (u?.activo && correoConfigurado()) {
    const conf = await leerConfig();
    await enviarCorreo({
      para: u.correo,
      asunto: `${conf.negocio.nombre}: restablecer tu contraseña`,
      texto: `Hola ${u.nombre}:\n\nPara crear una nueva contraseña abre este enlace (vale por 1 hora y una sola vez):\n${enlaceRestablecer(u)}\n\nSi no lo pediste, ignora este correo y avisa a administración.`,
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
  try { datos = jwt.verify(String(token || ''), config.jwtSecret, { algorithms: ['HS256'] }); } catch { datos = null; }
  if (datos?.tipo !== 'restablecer') {
    await registrarEvento(req, 'enlace_invalido', { usuarioId: null, detalle: { motivo: 'enlace de contraseña inválido o vencido' } });
    throw falla(400, 'El enlace no es válido o ya venció. Pide uno nuevo.');
  }
  const u = await uno('SELECT id, rol, nombre, correo, activo, password_cambiado_en FROM usuario WHERE id = $1', [datos.sub]);
  if (!u?.activo || sello(u) !== datos.pc) throw falla(400, 'El enlace ya fue usado o venció. Pide uno nuevo.');
  exigirClaveSegura(password, u);
  await fijarPassword(u.id, password);
  req.usuario = u;
  await auditar(req, 'restablecer_password', 'usuario', u.id);
  await registrarEvento(req, 'cambio_clave', { detalle: { via: 'enlace' } });
  res.json({ ok: true });
}));

// Registro de clientes por su cuenta (RF-56): solo si administración lo habilita en Tarifas y reglas.
const limiteRegistro = limitador({ nombre: 'registro', max: 30, ventanaMs: 60 * 60 * 1000, mensaje: 'Demasiados registros desde esta conexión. Intenta más tarde.' });
auth.post('/registro', limiteRegistro, ruta(async (req, res) => {
  const conf = await leerConfig();
  if (!conf.operacion.registro_clientes) throw falla(403, 'El registro está cerrado: pide tu cuenta a administración');
  const b = { ...(req.body || {}), rol: 'cliente' };
  for (const k of ['nombre', 'correo', 'telefono', 'rut']) if (b[k] !== undefined && b[k] !== null) b[k] = String(b[k]);
  const errores = validarUsuario(b, true);
  if (!normalizarTelefono(b.telefono)) errores.telefono = 'Teléfono móvil chileno obligatorio (+56 9…)';
  if (!b.password) errores.password = 'Obligatoria';
  exigirSinErrores(errores);
  exigirClaveSegura(b.password, b);
  if (await uno('SELECT id FROM usuario WHERE correo = $1', [b.correo.toLowerCase().trim()])) throw falla(409, 'Ya existe una cuenta con ese correo', { correo: 'Ya registrado' });
  const u = await uno(
    `INSERT INTO usuario (nombre, correo, password_hash, rol, telefono, rut, password_cambiado_en, ultimo_acceso) VALUES ($1, $2, $3, 'cliente', $4, $5, now(), now())
     RETURNING id, nombre, correo, rol, sesion_version`,
    [b.nombre.trim(), b.correo.toLowerCase().trim(), await bcrypt.hash(String(b.password), 10), normalizarTelefono(b.telefono), normalizarRut(b.rut)]);
  req.usuario = u;
  await auditar(req, 'registro', 'usuario', u.id);
  await registrarEvento(req, 'usuario_creado', { usuarioId: u.id, correo: u.correo, detalle: { via: 'registro_propio', rol: 'cliente' } });
  res.status(201).json({ token: firmarSesion(u), usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol } });
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
  const { rows } = await query(`SELECT id, nombre, correo, rol, telefono, rut, activo, creado_en, ultimo_acceso, debe_cambiar_clave,
    password_hash IS NOT NULL AS tiene_clave FROM usuario ${where} ORDER BY rol, nombre`, params);
  res.json(rows);
}));

// Lista mínima de quienes pueden repartir, para asignar (sin datos sensibles). Administración también reparte.
usuarios.get('/repartidores', requiereRol('admin'), ruta(async (_req, res) => {
  const { rows } = await query("SELECT id, nombre, telefono, rol FROM usuario WHERE rol IN ('repartidor', 'admin') AND activo ORDER BY rol DESC, nombre");
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
  const errores = validarUsuario(b, true);
  if (config.authMode === 'jwt' && !b.password) errores.password = 'Obligatoria: sin contraseña no podrá iniciar sesión';
  exigirSinErrores(errores);
  if (b.password) exigirClaveSegura(b.password, b);
  const existe = await uno('SELECT id FROM usuario WHERE correo = $1', [b.correo.toLowerCase()]);
  if (existe) throw falla(409, 'Ya existe un usuario con ese correo', { correo: 'Duplicado' });
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const u = await uno(
    `INSERT INTO usuario (nombre, correo, password_hash, rol, telefono, rut, debe_cambiar_clave) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, nombre, correo, rol, telefono, rut, activo, creado_en`,
    [String(b.nombre).trim(), String(b.correo).toLowerCase().trim(), hash, b.rol, normalizarTelefono(b.telefono), normalizarRut(b.rut), Boolean(hash) && b.cambiar_al_entrar !== false],
  );
  await auditar(req, 'crear', 'usuario', u.id, { rol: u.rol });
  await registrarEvento(req, 'usuario_creado', { nivel: u.rol === 'admin' ? 'alerta' : 'info', detalle: { usuario: u.id, correo: u.correo, rol: u.rol } });
  res.status(201).json(u);
}));

// Administración genera un enlace para que la persona cree una nueva contraseña (lo comparte por WhatsApp o correo).
usuarios.post('/:id/restablecer', requiereRol('admin'), ruta(async (req, res) => {
  const u = await uno('SELECT id, nombre, correo, activo, password_cambiado_en FROM usuario WHERE id = $1', [idNumerico(req.params.id)]);
  if (!u) throw falla(404, 'Usuario no encontrado');
  if (!u.activo) throw falla(409, 'El usuario está desactivado');
  await auditar(req, 'enlace_password', 'usuario', u.id);
  await registrarEvento(req, 'enlace_restablecer', { detalle: { usuario: u.id, correo: u.correo } });
  res.json({ enlace: enlaceRestablecer(u), vence_en_min: 60 });
}));

usuarios.patch('/:id', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const b = req.body || {};
  exigirSinErrores(validarUsuario(b, false));
  if (id === req.usuario.id && (b.activo === false || (b.rol && b.rol !== 'admin'))) throw falla(409, 'No puedes quitarte tu propio acceso de administrador');
  // Un repartidor con envíos en curso no se desactiva ni cambia de perfil: sus envíos quedarían sin nadie.
  const actual = await uno('SELECT rol, correo, nombre FROM usuario WHERE id = $1', [id]);
  if (!actual) throw falla(404, 'Usuario no encontrado');
  if (b.password) exigirClaveSegura(b.password, actual);
  // Un cliente con envíos no cambia de perfil: sus envíos quedarían sin dueño visible.
  if (actual.rol === 'cliente' && b.rol && b.rol !== 'cliente') {
    const { n } = await uno('SELECT count(*)::int AS n FROM envio WHERE cliente_id = $1', [id]);
    if (n) throw falla(409, `Este cliente tiene ${n} envío(s): no se puede cambiar su perfil. Crea una cuenta nueva para el otro perfil`, { envios: n });
  }
  // Quien reparte (repartidor o administración) no se desactiva ni deja de poder repartir con envíos en curso.
  if (['repartidor', 'admin'].includes(actual.rol) && (b.activo === false || (b.rol && !['repartidor', 'admin'].includes(b.rol)))) {
    const { n } = await uno("SELECT count(*)::int AS n FROM envio WHERE repartidor_id = $1 AND estado IN ('asignado','en_ruta','fallido','reagendado')", [id]);
    if (n) throw falla(409, `Este repartidor tiene ${n} envío(s) en curso: reasígnalos antes de desactivarlo`, { envios_pendientes: n });
  }
  const sets = [];
  const params = [];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.nombre !== undefined) set('nombre', String(b.nombre).trim());
  if (b.rol !== undefined) set('rol', b.rol);
  if (b.telefono !== undefined) set('telefono', normalizarTelefono(b.telefono));
  if (b.rut !== undefined) set('rut', normalizarRut(b.rut));
  if (b.activo !== undefined) set('activo', Boolean(b.activo));
  if (b.password) {
    // Clave asignada por administración: se cierran las sesiones abiertas, se invalidan los enlaces de
    // recuperación anteriores y se pide cambiarla al entrar.
    set('password_hash', await bcrypt.hash(String(b.password), 10));
    sets.push('sesion_version = sesion_version + 1', 'password_cambiado_en = now()');
    if (id !== req.usuario.id) sets.push('debe_cambiar_clave = true');
  }
  if (b.activo === false) sets.push('sesion_version = sesion_version + 1');
  if (!sets.length) throw falla(400, 'Nada que actualizar');
  params.push(id);
  const u = await uno(`UPDATE usuario SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, nombre, correo, rol, telefono, rut, activo`, params);
  if (!u) throw falla(404, 'Usuario no encontrado');
  await auditar(req, 'editar', 'usuario', id, { ...b, password: b.password ? '***' : undefined });
  const cambios = Object.keys(b).filter((k) => k !== 'password');
  if (b.password) await registrarEvento(req, 'clave_asignada', { detalle: { usuario: id, correo: u.correo } });
  if (cambios.length) {
    const aAdmin = b.rol === 'admin' && actual.rol !== 'admin';
    await registrarEvento(req, 'usuario_modificado', { nivel: aAdmin ? 'alerta' : undefined, detalle: { usuario: id, correo: u.correo, cambios, rol_anterior: actual.rol, rol_nuevo: b.rol } });
  }
  res.json(u);
}));

// Cerrar las sesiones de un usuario (por ejemplo, un repartidor que perdió el teléfono).
usuarios.post('/:id/cerrar-sesiones', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const u = await uno('UPDATE usuario SET sesion_version = sesion_version + 1 WHERE id = $1 RETURNING id, correo', [id]);
  if (!u) throw falla(404, 'Usuario no encontrado');
  await registrarEvento(req, 'sesiones_cerradas', { detalle: { alcance: 'usuario', usuario: id, correo: u.correo } });
  res.json({ ok: true });
}));
