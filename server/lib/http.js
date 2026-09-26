import { ErrorNegocio } from './reglas.js';
import { query } from '../db/pool.js';

// Envuelve un handler async para que los errores lleguen al manejador central.
export const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function falla(status, mensaje, detalles) {
  return new ErrorNegocio(status, mensaje, detalles);
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
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}
