import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { config } from '../config.js';
import { query, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { normalizarRut, normalizarTelefono, ROLES } from '../lib/reglas.js';
import { autenticar, exigirClaveDemo, firmarSesion, requiereRol } from '../middleware/auth.js';
import { exigirClaveSegura, registrarEvento } from '../lib/seguridad.js';

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
auth.post('/cambiar-clave', autenticar, ruta(async (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = await uno('SELECT * FROM usuario WHERE id = $1', [req.usuario.id]);
  const errores = {};
  if (!u.password_hash || !(await bcrypt.compare(String(actual || ''), u.password_hash))) errores.actual = 'La contraseña actual no es correcta';
  if (String(nueva) === String(actual)) errores.nueva = 'Debe ser distinta a la actual';
  exigirSinErrores(errores, 'Revisa las contraseñas');
  exigirClaveSegura(nueva, u, 'nueva');
  const act = await uno(
    'UPDATE usuario SET password_hash = $1, sesion_version = sesion_version + 1, debe_cambiar_clave = false WHERE id = $2 RETURNING id, rol, sesion_version',
    [await bcrypt.hash(String(nueva), 10), u.id]);
  await auditar(req, 'cambiar_clave', 'usuario', u.id);
  await registrarEvento(req, 'cambio_clave');
  res.json({ token: firmarSesion(act) });
}));

// Cerrar la sesión en todos los dispositivos (por ejemplo, si se perdió el teléfono).
auth.post('/cerrar-sesiones', autenticar, ruta(async (req, res) => {
  const act = await uno('UPDATE usuario SET sesion_version = sesion_version + 1 WHERE id = $1 RETURNING id, rol, sesion_version', [req.usuario.id]);
  await registrarEvento(req, 'sesiones_cerradas', { detalle: { alcance: 'propias' } });
  res.json({ token: firmarSesion(act) });
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

usuarios.patch('/:id', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const b = req.body || {};
  exigirSinErrores(validarUsuario(b, false));
  if (id === req.usuario.id && (b.activo === false || (b.rol && b.rol !== 'admin'))) throw falla(409, 'No puedes quitarte tu propio acceso de administrador');
  // Un repartidor con envíos en curso no se desactiva ni cambia de perfil: sus envíos quedarían sin nadie.
  const actual = await uno('SELECT rol, correo, nombre FROM usuario WHERE id = $1', [id]);
  if (!actual) throw falla(404, 'Usuario no encontrado');
  if (b.password) exigirClaveSegura(b.password, actual);
  if (actual?.rol === 'repartidor' && (b.activo === false || (b.rol && b.rol !== 'repartidor'))) {
    const { n } = await uno("SELECT count(*)::int AS n FROM envio WHERE repartidor_id = $1 AND estado IN ('asignado','en_ruta','fallido','reagendado')", [id]);
    if (n) throw falla(409, `Este repartidor tiene ${n} envío(s) en curso: reasígnalos antes de desactivarlo`);
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
    // Clave asignada por administración: se cierran las sesiones abiertas y se pide cambiarla al entrar.
    set('password_hash', await bcrypt.hash(String(b.password), 10));
    sets.push('sesion_version = sesion_version + 1');
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
