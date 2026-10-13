import { Router } from 'express';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import { enviarCorreo } from '../lib/correo.js';
import { siguienteFolio } from '../lib/envios.js';
import { borrarArchivos, conArchivo, leerArchivo, subida } from '../lib/archivos.js';
import { quitarExif } from '../lib/exif.js';
import { MIME_COMPROBANTE, validarMotivoRechazo } from '../lib/reglas.js';
import { ESTADOS_PEDIDO_BOLSAS, calcularPedidoBolsas, validarProductoBolsa } from '../lib/bolsas.js';
import { registrarEvento } from '../lib/seguridad.js';
import { autenticar, requiereRol } from '../middleware/auth.js';

// Bolsas de envío (pedido del cliente 11-10): el cliente las pide por color y medida, paga por transferencia con
// comprobante y administración aprueba el pago y las entrega. Los precios los define administración en el catálogo.
// Se activa en Tarifas y reglas (operacion.bolsas).
export const bolsas = Router();
bolsas.use(autenticar);
// En pausa (pedido 12-10): mientras esté apagada, solo administración entra (para dejar listos los precios).
bolsas.use(ruta(async (req, _res, next) => {
  if (req.usuario.rol !== 'admin' && !(await leerConfig()).operacion.bolsas) throw falla(404, 'La sección de bolsas aún no está disponible');
  next();
}));

const clp = (n) => `$${Number(n).toLocaleString('es-CL')}`;
const COLUMNAS_PRODUCTO = 'id, color, medida, unidades, precio, costo, activo, orden';

// Aviso por correo sin frenar la respuesta: si el correo falla, el pedido igual queda en la plataforma.
function avisar(para, asunto, texto) {
  if (!para) return;
  enviarCorreo({ para, asunto, texto }).catch((err) => console.error('[bolsas] no se pudo enviar el aviso por correo', err.message));
}

// ---------- Catálogo ----------
// El cliente ve solo lo disponible y sin el costo; administración ve todo (?todos=1 incluye los desactivados).
bolsas.get('/catalogo', ruta(async (req, res) => {
  const admin = req.usuario.rol === 'admin';
  const { rows } = await query(
    `SELECT ${COLUMNAS_PRODUCTO} FROM bolsa_producto ${admin && req.query.todos === '1' ? '' : 'WHERE activo'}
     ORDER BY color, orden, id`);
  res.json(admin ? rows : rows.map(({ costo, ...p }) => p));
}));

bolsas.post('/catalogo', requiereRol('admin'), ruta(async (req, res) => {
  const { datos: d, errores } = validarProductoBolsa(req.body || {});
  exigirSinErrores(errores, 'Revisa los datos de la bolsa');
  const p = await uno(
    `INSERT INTO bolsa_producto (color, medida, unidades, precio, costo, activo, orden)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), COALESCE($7, (SELECT COALESCE(max(orden), 0) + 1 FROM bolsa_producto WHERE color = $1)))
     ON CONFLICT (color, medida, unidades) DO NOTHING RETURNING ${COLUMNAS_PRODUCTO}`,
    [d.color, d.medida, d.unidades, d.precio, d.costo ?? null, d.activo ?? null, d.orden ?? null]);
  if (!p) throw falla(409, `Ya existe la bolsa ${d.color} ${d.medida} de ${d.unidades} unidades: edítala en la lista`, { medida: 'Ya existe' });
  await auditar(req, 'crear', 'bolsa_producto', p.id, d);
  res.status(201).json(p);
}));

bolsas.patch('/catalogo/:id', requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const { datos: d, errores } = validarProductoBolsa(req.body || {}, { parcial: true });
  exigirSinErrores(errores, 'Revisa los datos de la bolsa');
  if (!Object.keys(d).length) throw falla(422, 'No hay cambios');
  const campos = Object.keys(d);
  let p;
  try {
    p = await uno(
      `UPDATE bolsa_producto SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')}, actualizado_en = now()
       WHERE id = $1 RETURNING ${COLUMNAS_PRODUCTO}`, [id, ...campos.map((k) => d[k])]);
  } catch (err) {
    if (err.code === '23505') throw falla(409, 'Ya existe otra bolsa con ese color, medida y unidades', { medida: 'Ya existe' });
    throw err;
  }
  if (!p) throw falla(404, 'Bolsa no encontrada');
  await auditar(req, 'editar', 'bolsa_producto', id, d);
  res.json(p);
}));

// ---------- Pedidos ----------
const SELECT_PEDIDO = `
  SELECT p.id, p.folio, p.cliente_id, p.estado, p.total, p.entrega_direccion, p.entrega_comuna_id, c.nombre AS entrega_comuna,
    p.observaciones, p.comprobante_ruta IS NOT NULL AS tiene_comprobante, p.comprobante_referencia, p.comprobante_subido_en,
    p.motivo_rechazo, p.motivo_anulacion, p.pagado_en, p.entregado_en, p.anulado_en, p.creado_en,
    u.nombre AS cliente_nombre, u.telefono AS cliente_telefono, u.correo AS cliente_correo,
    COALESCE((SELECT json_agg(json_build_object('bolsa_id', i.bolsa_id, 'color', i.color, 'medida', i.medida, 'unidades', i.unidades,
        'precio_unitario', i.precio_unitario, 'cantidad', i.cantidad, 'subtotal', i.subtotal) ORDER BY i.id)
      FROM pedido_bolsas_item i WHERE i.pedido_id = p.id), '[]') AS items
  FROM pedido_bolsas p JOIN usuario u ON u.id = p.cliente_id JOIN comuna c ON c.id = p.entrega_comuna_id`;

const ABIERTOS = "('pendiente', 'en_revision', 'pagado')";

// Responde 404 (no 403) si el pedido es de otro cliente: no se confirma que exista.
async function pedidoAccesible(req, db = { query }) {
  const { rows: [p] } = await db.query(`${SELECT_PEDIDO} WHERE p.id = $1`, [idNumerico(req.params.id)]);
  if (!p || (req.usuario.rol !== 'admin' && p.cliente_id !== req.usuario.id)) throw falla(404, 'Pedido no encontrado');
  return p;
}

bolsas.get('/pedidos', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const params = [];
  const cond = [];
  if (req.usuario.rol === 'cliente') { params.push(req.usuario.id); cond.push(`p.cliente_id = $${params.length}`); }
  const estado = req.query.estado;
  if (estado === 'abiertos') cond.push(`p.estado IN ${ABIERTOS}`);
  else if (estado) {
    if (!Object.hasOwn(ESTADOS_PEDIDO_BOLSAS, estado)) throw falla(400, 'Estado inválido');
    params.push(estado);
    cond.push(`p.estado = $${params.length}`);
  }
  const { rows } = await query(`${SELECT_PEDIDO} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY p.creado_en DESC, p.id DESC LIMIT 200`, params);
  res.json(rows);
}));

// Pedidos que administración tiene que atender (por pagar, por revisar o por entregar): el menú muestra el número.
bolsas.get('/pedidos/abiertos', requiereRol('admin'), ruta(async (_req, res) => {
  res.json(await uno(`SELECT count(*)::int AS abiertos, count(*) FILTER (WHERE estado = 'en_revision')::int AS en_revision
                      FROM pedido_bolsas WHERE estado IN ${ABIERTOS}`));
}));

bolsas.post('/pedidos', requiereRol('cliente'), ruta(async (req, res) => {
  const b = req.body || {};
  const { rows: catalogo } = await query('SELECT id, color, medida, unidades, precio FROM bolsa_producto WHERE activo');
  const { lineas, total, errores } = calcularPedidoBolsas(b.items, catalogo);
  const direccion = String(b.entrega_direccion ?? '').trim();
  if (direccion.length < 5 || direccion.length > 200) errores.entrega_direccion = 'Escribe la dirección de entrega (calle, número y depto)';
  const comuna = Number.isInteger(Number(b.entrega_comuna_id)) ? await uno('SELECT id, nombre, en_cobertura FROM comuna WHERE id = $1', [Number(b.entrega_comuna_id)]) : null;
  if (!comuna) errores.entrega_comuna_id = 'Elige la comuna';
  else if (!comuna.en_cobertura) errores.entrega_comuna_id = `${comuna.nombre} está fuera de la zona de cobertura`;
  const observaciones = String(b.observaciones ?? '').trim();
  if (observaciones.length > 300) errores.observaciones = 'Máximo 300 caracteres';
  exigirSinErrores(errores, 'Revisa el pedido');

  const pedido = await transaccion(async (db) => {
    const folio = await siguienteFolio(db, 'BOL');
    const { rows: [p] } = await db.query(
      `INSERT INTO pedido_bolsas (folio, cliente_id, total, entrega_direccion, entrega_comuna_id, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [folio, req.usuario.id, total, direccion, comuna.id, observaciones || null]);
    for (const l of lineas) {
      await db.query(
        `INSERT INTO pedido_bolsas_item (pedido_id, bolsa_id, color, medida, unidades, precio_unitario, cantidad, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [p.id, l.bolsa_id, l.color, l.medida, l.unidades, l.precio_unitario, l.cantidad, l.subtotal]);
    }
    return (await db.query(`${SELECT_PEDIDO} WHERE p.id = $1`, [p.id])).rows[0];
  });
  await auditar(req, 'crear', 'pedido_bolsas', pedido.id, { folio: pedido.folio, total });
  const conf = await leerConfig();
  avisar(conf.negocio.correo, `Nuevo pedido de bolsas ${pedido.folio} (${clp(total)})`,
    `${pedido.cliente_nombre} pidió:\n\n${lineas.map((l) => `· ${l.cantidad} paquete(s) ${l.color} ${l.medida} (${l.unidades} u.) — ${clp(l.subtotal)}`).join('\n')}\n\nTotal: ${clp(total)}\nEntrega: ${direccion}, ${comuna.nombre}${observaciones ? `\nObservaciones: ${observaciones}` : ''}\n\nRevísalo en Bolsas, en la plataforma.`);
  res.status(201).json(pedido);
}));

// El cliente sube el comprobante de la transferencia; administración lo revisa.
bolsas.post('/pedidos/:id/comprobante', requiereRol('cliente'), subida.single('archivo'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  if (p.estado === 'en_revision') throw falla(409, 'Ya enviaste un comprobante: está en revisión');
  if (p.estado !== 'pendiente') throw falla(409, `El pedido está "${ESTADOS_PEDIDO_BOLSAS[p.estado]}": ya no se sube comprobante`);
  if (!req.file) throw falla(422, 'Adjunta la imagen del comprobante de la transferencia', { archivo: 'Obligatorio' });
  if (!MIME_COMPROBANTE.includes(req.file.mimetype)) throw falla(422, 'El comprobante debe ser una imagen (JPG, PNG, WebP) o un PDF', { archivo: 'Formato inválido' });
  const referencia = String(req.body.referencia || '').trim().slice(0, 60) || null;
  const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
  const anterior = await uno('SELECT comprobante_ruta FROM pedido_bolsas WHERE id = $1', [p.id]);
  const act = await conArchivo(buffer, req.file.mimetype, async (guardado) => {
    const r = await uno(
      `UPDATE pedido_bolsas SET estado = 'en_revision', comprobante_ruta = $2, comprobante_mime = $3, comprobante_nombre = $4,
         comprobante_referencia = $5, comprobante_subido_en = now(), actualizado_en = now()
       WHERE id = $1 AND estado = 'pendiente' RETURNING id`,
      [p.id, guardado.ruta, req.file.mimetype, String(req.file.originalname || '').slice(0, 150), referencia]);
    if (!r) throw falla(409, 'El pedido cambió mientras subías el comprobante. Recarga para ver su estado actual.');
    return r;
  });
  // El comprobante rechazado antes ya no sirve: se borra para no dejar archivos sin uso.
  if (anterior?.comprobante_ruta) borrarArchivos([anterior.comprobante_ruta]).catch((err) => console.error('[bolsas] no se pudo borrar el comprobante anterior', err.message));
  await auditar(req, 'comprobante_pago', 'pedido_bolsas', act.id, { referencia });
  const conf = await leerConfig();
  avisar(conf.negocio.correo, `Comprobante del pedido de bolsas ${p.folio}`,
    `${p.cliente_nombre} subió el comprobante de ${clp(p.total)} del pedido ${p.folio}${referencia ? ` (operación ${referencia})` : ''}.\n\nApruébalo o recházalo en Bolsas, en la plataforma.`);
  res.status(201).json(await pedidoAccesible(req));
}));

bolsas.get('/pedidos/:id/comprobante', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  const a = await uno('SELECT comprobante_ruta AS ruta, comprobante_mime AS mime, comprobante_nombre AS nombre FROM pedido_bolsas WHERE id = $1', [p.id]);
  if (!a?.ruta) throw falla(404, 'Este pedido no tiene comprobante');
  const contenido = await leerArchivo(a.ruta);
  if (!contenido) throw falla(410, 'El archivo ya no está disponible');
  await registrarEvento(req, 'descarga_archivo', { registros: 1, detalle: { pedido_bolsas: p.id, tipo: 'comprobante_bolsas' } });
  // Mismas protecciones que los adjuntos de envíos: el archivo lo subió un usuario.
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[a.mime] || 'jpg';
  res.setHeader('Content-Disposition', `${a.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="comprobante-${p.folio}.${ext}"`);
  res.send(contenido);
}));

// Administración aprueba el pago (con o sin comprobante: p. ej. si pagó en efectivo).
bolsas.post('/pedidos/:id/aprobar', requiereRol('admin'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  const r = await uno(
    `UPDATE pedido_bolsas SET estado = 'pagado', pagado_en = now(), motivo_rechazo = NULL, revisado_por = $2, actualizado_en = now()
     WHERE id = $1 AND estado IN ('pendiente', 'en_revision') RETURNING id`, [p.id, req.usuario.id]);
  if (!r) throw falla(409, `El pedido está "${ESTADOS_PEDIDO_BOLSAS[p.estado]}": no se puede aprobar el pago`);
  await auditar(req, 'aprobar_pago', 'pedido_bolsas', p.id, { total: p.total });
  const conf = await leerConfig();
  avisar(p.cliente_correo, `Pago aprobado · pedido de bolsas ${p.folio}`,
    `Hola ${p.cliente_nombre}:\n\nAprobamos el pago de tu pedido de bolsas ${p.folio} (${clp(p.total)}). Te las llevamos a ${p.entrega_direccion}, ${p.entrega_comuna}.\n\n— ${conf.negocio.nombre}`);
  res.json(await pedidoAccesible(req));
}));

bolsas.post('/pedidos/:id/rechazar', requiereRol('admin'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  const motivo = validarMotivoRechazo(req.body?.motivo);
  const r = await uno(
    `UPDATE pedido_bolsas SET estado = 'pendiente', motivo_rechazo = $2, revisado_por = $3, actualizado_en = now()
     WHERE id = $1 AND estado = 'en_revision' RETURNING id`, [p.id, motivo, req.usuario.id]);
  if (!r) throw falla(409, 'Este comprobante ya fue revisado. Recarga para ver su estado actual.');
  await auditar(req, 'rechazar_pago', 'pedido_bolsas', p.id, { motivo });
  const conf = await leerConfig();
  avisar(p.cliente_correo, `Revisa el pago de tu pedido de bolsas ${p.folio}`,
    `Hola ${p.cliente_nombre}:\n\nNo pudimos aprobar el comprobante de tu pedido de bolsas ${p.folio}: ${motivo}\n\nSube uno nuevo desde Bolsas, en la plataforma.\n\n— ${conf.negocio.nombre}`);
  res.json(await pedidoAccesible(req));
}));

// El pago manda: solo se entrega un pedido pagado.
bolsas.post('/pedidos/:id/entregar', requiereRol('admin'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  const r = await uno(
    `UPDATE pedido_bolsas SET estado = 'entregado', entregado_en = now(), actualizado_en = now()
     WHERE id = $1 AND estado = 'pagado' RETURNING id`, [p.id]);
  if (!r) throw falla(409, p.estado === 'entregado' ? 'El pedido ya fue entregado' : 'Solo se entrega un pedido con el pago aprobado');
  await auditar(req, 'entregar', 'pedido_bolsas', p.id);
  res.json(await pedidoAccesible(req));
}));

// El cliente anula su pedido mientras no lo haya pagado; administración, mientras no esté entregado.
bolsas.post('/pedidos/:id/anular', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const p = await pedidoAccesible(req);
  const admin = req.usuario.rol === 'admin';
  const motivo = String(req.body?.motivo ?? '').trim().slice(0, 300) || (admin ? 'Anulado por administración' : 'Anulado por el cliente');
  const permitidos = admin ? ['pendiente', 'en_revision', 'pagado'] : ['pendiente'];
  const r = await uno(
    `UPDATE pedido_bolsas SET estado = 'anulado', anulado_en = now(), motivo_anulacion = $2, actualizado_en = now()
     WHERE id = $1 AND estado = ANY($3) RETURNING id`, [p.id, motivo, permitidos]);
  if (!r) {
    throw falla(409, admin || p.estado === 'anulado' || p.estado === 'entregado'
      ? `El pedido está "${ESTADOS_PEDIDO_BOLSAS[p.estado]}": no se puede anular`
      : 'El pedido ya tiene un pago en revisión o aprobado: escríbenos a soporte para anularlo');
  }
  await auditar(req, 'anular', 'pedido_bolsas', p.id, { motivo });
  res.json(await pedidoAccesible(req));
}));
