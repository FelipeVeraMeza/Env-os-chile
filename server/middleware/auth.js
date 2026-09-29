import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { uno } from '../db/pool.js';
import { falla, ruta } from '../lib/http.js';
import { ROLES } from '../lib/reglas.js';
import { registrarEvento } from '../lib/seguridad.js';

// En AUTH_MODE=demo no hay inicio de sesión: la interfaz envía el usuario elegido en
// X-Demo-Usuario (o solo el rol en X-Demo-Rol). En AUTH_MODE=jwt se exige Bearer token.
export const autenticar = ruta(async (req, _res, next) => {
  let usuario = null;
  const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];

  if (bearer) {
    let payload;
    try {
      // Algoritmo fijo: el token no puede elegir cómo se verifica (evita "alg: none" y confusión de algoritmos).
      payload = jwt.verify(bearer, config.jwtSecret, { algorithms: ['HS256'] });
    } catch (err) {
      // Un token vencido es normal; uno con firma inválida puede ser un intento de falsificarlo.
      if (err.name !== 'TokenExpiredError') await registrarEvento(req, 'token_invalido', { usuarioId: null, detalle: { motivo: err.message } });
      throw falla(401, 'Sesión inválida o expirada', { sesion: 'expirada' });
    }
    usuario = await uno('SELECT id, nombre, correo, rol, activo, sesion_version, debe_cambiar_clave FROM usuario WHERE id = $1', [payload.sub]);
    // Tras cambiar la contraseña, las sesiones abiertas con la clave anterior dejan de servir.
    if (usuario && (payload.v ?? 0) !== usuario.sesion_version) throw falla(401, 'Tu sesión expiró: vuelve a iniciar sesión', { sesion: 'expirada' });
  } else if (config.authMode === 'demo') {
    try { exigirClaveDemo(req); } catch (err) {
      if (req.get('x-demo-clave')) await registrarEvento(req, 'clave_demo_fallida', { usuarioId: null });
      throw err;
    }
    const id = Number(req.get('x-demo-usuario'));
    const rol = req.get('x-demo-rol');
    if (Number.isInteger(id) && id > 0) {
      usuario = await uno('SELECT id, nombre, correo, rol, activo FROM usuario WHERE id = $1', [id]);
    } else if (ROLES.includes(rol)) {
      usuario = await uno('SELECT id, nombre, correo, rol, activo FROM usuario WHERE rol = $1 AND activo ORDER BY id LIMIT 1', [rol]);
    }
  }

  if (!usuario) throw falla(401, config.authMode === 'demo' ? 'Selecciona un perfil de demostración' : 'Debes iniciar sesión', { sesion: 'requerida' });
  if (!usuario.activo) throw falla(403, 'Usuario desactivado');
  delete usuario.sesion_version;
  req.usuario = usuario;
  next();
});

export function firmarSesion(u) {
  return jwt.sign({ sub: u.id, rol: u.rol, v: u.sesion_version ?? 0 }, config.jwtSecret, { algorithm: 'HS256', expiresIn: `${config.jwtDias}d` });
}

export function requiereRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario?.rol)) {
      registrarEvento(req, 'acceso_denegado', { detalle: { rol: req.usuario?.rol, requiere: roles } });
      return next(falla(403, 'No tienes permiso para esta acción'));
    }
    next();
  };
}

// Si DEMO_CLAVE está definida, la demo publicada pide esa clave una vez (se guarda en el navegador).
export function exigirClaveDemo(req) {
  if (!config.demoClave) return;
  const dada = Buffer.from(String(req.get('x-demo-clave') || ''));
  const esperada = Buffer.from(config.demoClave);
  if (dada.length !== esperada.length || !crypto.timingSafeEqual(dada, esperada)) {
    throw falla(401, 'Ingresa la clave de acceso a la demo', { demo_clave: true });
  }
}
