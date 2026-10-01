import { uno, query } from '../db/pool.js';
import { falla } from './http.js';
import { enlacesMapa, ocultarMontos } from './reglas.js';
import { firmarEnlace } from './archivos.js';
import { urlQr } from './ticket.js';

export const SELECT_ENVIO = `
  SELECT e.*,
    d.nombre AS destinatario_nombre, d.telefono AS destinatario_telefono, d.correo AS destinatario_correo,
    di.calle, di.numero, di.depto, di.referencia, di.lat, di.lon, di.alias AS direccion_alias,
    c.nombre AS comuna_nombre, c.region, c.provincia,
    cli.nombre AS cliente_nombre, cli.telefono AS cliente_telefono, cli.rut AS cliente_rut, rep.nombre AS repartidor_nombre
  FROM envio e
  JOIN destinatario d ON d.id = e.destinatario_id
  JOIN direccion di ON di.id = e.direccion_id
  JOIN comuna c ON c.id = e.comuna_id
  JOIN usuario cli ON cli.id = e.cliente_id
  LEFT JOIN usuario rep ON rep.id = e.repartidor_id`;

export async function cargarEnvio(id, db = { query }) {
  const { rows } = await db.query(`${SELECT_ENVIO} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw Object.assign(falla(404, 'Envío no encontrado'), { sondeo: { entidad: 'envio', id, existe: false } });
  return rows[0];
}

export function puedeVer(usuario, envio) {
  if (usuario.rol === 'admin') return true;
  if (usuario.rol === 'cliente') return envio.cliente_id === usuario.id;
  if (usuario.rol === 'repartidor') return envio.repartidor_id === usuario.id;
  return false;
}

// Responde 404 (no 403) para no confirmar que el registro existe; el intento queda registrado como sondeo.
export function exigirAcceso(usuario, envio) {
  if (!puedeVer(usuario, envio)) throw Object.assign(falla(404, 'Envío no encontrado'), { sondeo: { entidad: 'envio', id: envio.envio_id ?? envio.id, existe: true } });
}

// Representación pública para la API según el rol (el repartidor no ve montos).
export function presentar(envio, usuario) {
  const salida = {
    ...envio,
    mapas: enlacesMapa({ calle: envio.calle, numero: envio.numero, comuna: envio.comuna_nombre, region: envio.region, lat: envio.lat, lon: envio.lon }),
    qr_url: envio.folio ? urlQr(envio) : null,
  };
  if (usuario?.rol === 'repartidor') return ocultarMontos(salida);
  return salida;
}

export async function detalleCompleto(envio, usuario) {
  const [historial, adjuntos, reclamos, pagos] = await Promise.all([
    query(`SELECT h.*, u.nombre AS usuario_nombre FROM envio_estado h LEFT JOIN usuario u ON u.id = h.usuario_id
           WHERE h.envio_id = $1 ORDER BY h.fecha, h.id`, [envio.id]),
    query('SELECT id, tipo, nombre_original, mime, tamano, subido_en FROM adjunto WHERE envio_id = $1 ORDER BY id', [envio.id]),
    usuario.rol === 'repartidor' ? { rows: [] } : query('SELECT * FROM reclamo_seguro WHERE envio_id = $1 ORDER BY id DESC', [envio.id]),
    usuario.rol === 'repartidor' ? { rows: [] } : query(
      `SELECT id, proveedor, medio, monto, estado, referencia, creado_en, comprobante_adjunto_id, motivo_rechazo, revisado_en, verificado_en
       FROM pago WHERE envio_id = $1 ORDER BY id DESC`, [envio.id]),
  ]);
  // El repartidor no ve montos: ni la boleta de compra ni el comprobante de pago.
  const visibles = usuario.rol === 'repartidor' ? adjuntos.rows.filter((a) => !['boleta', 'comprobante_pago'].includes(a.tipo)) : adjuntos.rows;
  const urls = new Map(visibles.map((a) => [a.id, firmarEnlace(a.id, usuario.id)]));
  const comprobantes = adjuntos.rows.filter((a) => a.tipo === 'comprobante_pago');
  return {
    ...presentar(envio, usuario),
    historial: historial.rows,
    adjuntos: visibles.map((a) => ({ ...a, url: urls.get(a.id) })),
    reclamos: reclamos.rows,
    pagos: pagos.rows.map((p) => {
      const c = p.comprobante_adjunto_id && comprobantes.find((a) => a.id === p.comprobante_adjunto_id);
      return c ? { ...p, comprobante: { mime: c.mime, nombre: c.nombre_original, url: urls.get(c.id) } } : p;
    }),
  };
}

// Varias personas pueden operar el mismo envío a la vez (admin, cliente, repartidor). Cada cambio se
// aplica solo si el envío sigue como estaba al leerlo (bloqueo optimista); si no, 409 sin pisar nada.
export const MENSAJE_CONFLICTO = 'Otra persona modificó este envío al mismo tiempo. Recarga para ver su estado actual.';
export function exigirSinConflicto(resultado) {
  if (!resultado.rowCount) throw falla(409, MENSAJE_CONFLICTO, { conflicto: true });
  return resultado;
}

export async function registrarEstado(db, { envioId, anterior, nuevo, motivo = null, usuarioId, lat = null, lon = null }) {
  await db.query(
    `INSERT INTO envio_estado (envio_id, estado_anterior, estado_nuevo, motivo, usuario_id, lat, lon)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [envioId, anterior, nuevo, motivo, usuarioId, lat, lon],
  );
}

export async function siguienteFolio(db, prefijo) {
  const anio = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', year: 'numeric' }));
  const { rows: [fila] } = await db.query(
    `INSERT INTO folio_contador (prefijo, anio, ultimo) VALUES ($1, $2, 1)
     ON CONFLICT (prefijo, anio) DO UPDATE SET ultimo = folio_contador.ultimo + 1
     RETURNING anio, ultimo`,
    [prefijo, anio],
  );
  return `${prefijo}-${fila.anio}-${String(fila.ultimo).padStart(6, '0')}`;
}

export async function tarifaDeComuna(comunaId) {
  return uno(
    `SELECT c.id, c.nombre, c.en_cobertura, COALESCE(c.tarifa_base, z.tarifa) AS tarifa
     FROM comuna c LEFT JOIN zona z ON z.id = c.zona_id WHERE c.id = $1`,
    [comunaId],
  );
}
