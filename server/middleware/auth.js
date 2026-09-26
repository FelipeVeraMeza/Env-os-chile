import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { uno } from '../db/pool.js';
import { falla, ruta } from '../lib/http.js';
import { ROLES } from '../lib/reglas.js';

// En AUTH_MODE=demo no hay inicio de sesión: la interfaz envía el usuario elegido en
// X-Demo-Usuario (o solo el rol en X-Demo-Rol). En AUTH_MODE=jwt se exige Bearer token.
export const autenticar = ruta(async (req, _res, next) => {
  let usuario = null;
  const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];

  if (bearer) {
    let payload;
    try {
      payload = jwt.verify(bearer, config.jwtSecret);
    } catch {
      throw falla(401, 'Sesión inválida o expirada');
    }
    usuario = await uno('SELECT id, nombre, correo, rol, activo, password_cambiado_en FROM usuario WHERE id = $1', [payload.sub]);
    // Al cambiar la contraseña se cierran las sesiones abiertas antes (margen de 1 s por el redondeo de "iat").
    if (payload.tipo || (usuario?.password_cambiado_en && payload.iat * 1000 < new Date(usuario.password_cambiado_en).getTime() - 1000)) {
      throw falla(401, 'Tu sesión se cerró porque cambió la contraseña. Vuelve a ingresar.');
    }
    if (usuario) delete usuario.password_cambiado_en;
  } else if (config.authMode === 'demo') {
    exigirClaveDemo(req);
    const id = Number(req.get('x-demo-usuario'));
    const rol = req.get('x-demo-rol');
    if (Number.isInteger(id) && id > 0) {
      usuario = await uno('SELECT id, nombre, correo, rol, activo FROM usuario WHERE id = $1', [id]);
    } else if (ROLES.includes(rol)) {
      usuario = await uno('SELECT id, nombre, correo, rol, activo FROM usuario WHERE rol = $1 AND activo ORDER BY id LIMIT 1', [rol]);
    }
  }

  if (!usuario) throw falla(401, config.authMode === 'demo' ? 'Selecciona un perfil de demostración' : 'Debes iniciar sesión');
  if (!usuario.activo) throw falla(403, 'Usuario desactivado');
  req.usuario = usuario;
  next();
});

export function requiereRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario?.rol)) return next(falla(403, 'No tienes permiso para esta acción'));
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
