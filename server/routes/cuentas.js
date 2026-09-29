import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { config } from '../config.js';
import { query, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { normalizarRut, normalizarTelefono, ROLES } from '../lib/reglas.js';
import { autenticar, exigirClaveDemo, requiereRol } from '../middleware/auth.js';

export const auth = Router();

// Límite simple de intentos de inicio de sesión por IP (10 por 15 min).
const intentos = new Map();
function limitar(ip) {
  const ahora = Date.now();
  const reg = intentos.get(ip) || { n: 0, desde: ahora };
  if (ahora - reg.desde > 15 * 60 * 1000) Object.assign(reg, { n: 0, desde: ahora });
  reg.n += 1;
  intentos.set(ip, reg);
  if (reg.n > 10) throw falla(429, 'Demasiados intentos. Espera unos minutos.');
}

auth.post('/login', ruta(async (req, res) => {
  limitar(req.ip);
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

usuarios.patch('/:id', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const b = req.body || {};
  exigirSinErrores(validarUsuario(b, false));
  if (id === req.usuario.id && (b.activo === false || (b.rol && b.rol !== 'admin'))) throw falla(409, 'No puedes quitarte tu propio acceso de administrador');
  // Un repartidor con envíos en curso no se desactiva ni cambia de perfil: sus envíos quedarían sin nadie.
  const actual = await uno('SELECT rol FROM usuario WHERE id = $1', [id]);
  if (actual?.rol === 'repartidor' && (b.activo === false || (b.rol && b.rol !== 'repartidor'))) {
    const { n } = await uno("SELECT count(*)::int AS n FROM envio WHERE repartidor_id = $1 AND estado IN ('asignado','en_ruta','fallido','reagendado')", [id]);
    if (n) throw falla(409, `Este repartidor tiene ${n} envío(s) en curso: reasígnalos antes de desactivarlo`);
  }
  const sets = [];
  const params = [];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.nombre !== undefined) set('nombre', b.nombre.trim());
  if (b.rol !== undefined) set('rol', b.rol);
  if (b.telefono !== undefined) set('telefono', normalizarTelefono(b.telefono));
  if (b.rut !== undefined) set('rut', normalizarRut(b.rut));
  if (b.activo !== undefined) set('activo', Boolean(b.activo));
  if (b.password) set('password_hash', await bcrypt.hash(b.password, 10));
  if (!sets.length) throw falla(400, 'Nada que actualizar');
  params.push(id);
  const u = await uno(`UPDATE usuario SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, nombre, correo, rol, telefono, rut, activo`, params);
  if (!u) throw falla(404, 'Usuario no encontrado');
  await auditar(req, 'editar', 'usuario', id, { ...b, password: b.password ? '***' : undefined });
  res.json(u);
}));
