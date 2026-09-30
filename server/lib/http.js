import { ErrorNegocio } from './reglas.js';
import { query } from '../db/pool.js';
import { registrarEvento } from './seguridad.js';

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

export const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Fecha AAAA-MM-DD opcional de un filtro; si viene con otro formato es un error del cliente.
export function fechaFiltro(valor, nombre) {
  if (valor === undefined || valor === '') return null;
  if (!FECHA_ISO.test(String(valor)) || Number.isNaN(new Date(`${valor}T00:00:00Z`).getTime())) throw falla(400, `${nombre}: usa el formato AAAA-MM-DD`);
  return String(valor);
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
  if (err?.sondeo && req.usuario) registrarEvento(req, 'sondeo_ajeno', { detalle: err.sondeo });
  if (err?.archivoInvalido) registrarEvento(req, 'archivo_rechazado', { detalle: { tipo_declarado: req.file?.mimetype, nombre: String(req.file?.originalname || '').slice(0, 100) } });
  if (err instanceof ErrorNegocio) {
    return res.status(err.status).json({ error: err.message, detalles: err.detalles });
  }
  if (err?.archivoInvalido) {
    return res.status(422).json({ error: err.message, detalles: { archivo: 'Formato inválido' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido' });
  }
  if (err?.name === 'MulterError') {
    // Archivo en un campo que no corresponde, demasiados campos o partes, campo de texto demasiado largo.
    return res.status(400).json({ error: 'El formulario enviado no es válido', detalles: { formulario: err.code } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La petición es demasiado grande' });
  }
  if (err?.expose && err.status >= 400 && err.status < 500) {
    // Otros errores del lector de peticiones (codificación no soportada, cuerpo cortado…).
    return res.status(err.status).json({ error: 'La petición no es válida' });
  }
  if (err?.code === '23514' || err?.code === '23502') {
    // Violación de una restricción de la base (CHECK / NOT NULL): es una regla de negocio.
    return res.status(409).json({ error: 'La operación viola una regla del sistema', detalles: { restriccion: err.constraint || err.column } });
  }
  if (err?.code === '23503') {
    // Referencia a un registro que no existe (p. ej. un envío o comuna inexistente).
    return res.status(422).json({ error: 'Uno de los datos hace referencia a un registro que no existe', detalles: { restriccion: err.constraint } });
  }
  if (['22P02', '22007', '22008', '22003', '22001', '22021', '22025', '2201B', '54000'].includes(err?.code)) {
    // Texto donde va un número o una fecha, fecha imposible o número fuera de rango.
    return res.status(400).json({ error: 'Hay un dato con formato inválido o fuera de rango' });
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
