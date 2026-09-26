import { ErrorNegocio } from './reglas.js';
import { query } from '../db/pool.js';

// Envuelve un handler async para que los errores lleguen al manejador central.
export const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function falla(status, mensaje, detalles) {
  return new ErrorNegocio(status, mensaje, detalles);
}

// Límite de solicitudes por IP en una ventana de tiempo (RNF-16). max = 0 lo desactiva.
// En memoria: suficiente para un solo servidor (Railway); con varias instancias usar un almacén compartido.
export function limitador({ nombre, max, ventanaMs = 60_000, mensaje = 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' }) {
  const registros = new Map();
  return (req, res, next) => {
    if (!max) return next();
    const ahora = Date.now();
    const clave = `${nombre}:${req.ip}`;
    let reg = registros.get(clave);
    if (!reg || ahora - reg.desde >= ventanaMs) {
      reg = { n: 0, desde: ahora };
      registros.set(clave, reg);
      if (registros.size > 10_000) for (const [k, v] of registros) if (ahora - v.desde >= ventanaMs) registros.delete(k);
    }
    reg.n += 1;
    const restantes = Math.max(0, max - reg.n);
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(restantes));
    res.set('RateLimit-Reset', String(Math.ceil((reg.desde + ventanaMs - ahora) / 1000)));
    if (reg.n > max) {
      res.set('Retry-After', String(Math.ceil((reg.desde + ventanaMs - ahora) / 1000)));
      return next(falla(429, mensaje));
    }
    next();
  };
}

export function exigirSinErrores(errores, mensaje = 'Revisa los campos marcados') {
  if (Object.keys(errores).length) throw falla(422, mensaje, errores);
}

export function idNumerico(valor, nombre = 'id') {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw falla(400, `${nombre} inválido`);
  return n;
}

// Registro de auditoría de acciones sensibles (RF-40). Nunca debe romper la operación principal.
export async function auditar(req, accion, entidad, entidadId, datos, db = { query }) {
  try {
    await db.query(
      'INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, datos, ip) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.usuario?.id || null, accion, entidad, entidadId != null ? String(entidadId) : null, datos ? JSON.stringify(datos) : null, req.ip],
    );
  } catch (err) {
    console.error('[auditoria] no se pudo registrar', err.message);
  }
}

export function manejadorErrores(err, req, res, _next) {
  if (err instanceof ErrorNegocio) {
    return res.status(err.status).json({ error: err.message, detalles: err.detalles });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (err?.code === '23514' || err?.code === '23502') {
    // Violación de una restricción de la base (CHECK / NOT NULL): es una regla de negocio.
    return res.status(409).json({ error: 'La operación viola una regla del sistema', detalles: { restriccion: err.constraint || err.column } });
  }
  if (err?.code === '23505') {
    // Registro duplicado (índice único): típico de dos personas haciendo lo mismo a la vez.
    return res.status(409).json({ error: 'Ya existe un registro igual (posiblemente creado por otra persona al mismo tiempo)', detalles: { restriccion: err.constraint } });
  }
  if (err?.code === '40P01' || err?.code === '40001') {
    return res.status(409).json({ error: 'Operación simultánea con otra persona. Inténtalo de nuevo.', detalles: { conflicto: true } });
  }
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}
