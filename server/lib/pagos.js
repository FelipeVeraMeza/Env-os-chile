import crypto from 'node:crypto';
import { transaccion, uno } from '../db/pool.js';
import { estimarCosto, fechaAbonoEstimada, PROVEEDORES_PAGO, verificarConfirmacion } from './cobranza.js';
import { leerConfig } from './configuracion.js';
import { ErrorNegocio } from './reglas.js';
import { registrarEvento } from './seguridad.js';

const falla = (status, mensaje, detalles) => new ErrorNegocio(status, mensaje, detalles);

// Bitácora de pagos: cada cosa que informa la pasarela o hace administración queda registrada.
export async function registrarEventoPago(db, { pagoId, tipo, estado = null, monto = null, firmaValida = null, datos = null, usuarioId = null }) {
  await db.query(
    `INSERT INTO pago_evento (pago_id, tipo, estado_informado, monto_informado, firma_valida, datos, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [pagoId, tipo, estado, monto, firmaValida, datos ? JSON.stringify(datos) : null, usuarioId],
  );
}

// Cuando el envío queda pagado (por cualquier medio), los cobros en línea que quedaron abiertos ya no sirven: se anulan.
// Si no, Cobranza los mostraba para siempre como "pagos sin respuesta de la pasarela".
export async function cerrarCobrosAbiertos(db, envioId, motivo = 'El envío se pagó por otro medio') {
  const { rows } = await db.query(
    "UPDATE pago SET estado = 'anulado', actualizado_en = now() WHERE envio_id = $1 AND estado = 'iniciado' RETURNING id, monto", [envioId]);
  for (const p of rows) {
    await registrarEventoPago(db, { pagoId: p.id, tipo: 'rechazo', estado: 'anulado', monto: p.monto, datos: { motivo } });
  }
}

// Comisión y neto estimados al momento de cobrar, con la tabla de costos del proveedor.
export function costoDelCobro(monto, proveedor) {
  const p = PROVEEDORES_PAGO[proveedor] || PROVEEDORES_PAGO.transferencia;
  const e = estimarCosto(monto, p);
  return { comision_estimada: e.costo, neto_estimado: e.neto, abono_estimado_en: fechaAbonoEstimada(new Date(), p.dias_abono) };
}

// Inicia (o reutiliza) el cobro en línea de un envío. Lo usan la app (cliente/admin) y el link de pago público.
export async function iniciarPago(envio, usuarioId) {
  if (['borrador', 'anulado'].includes(envio.estado)) throw falla(409, 'Confirma el envío antes de pagar');
  if (envio.estado_pago === 'pagado') throw falla(409, 'El envío ya está pagado');
  if (envio.estado_pago === 'en_revision') throw falla(409, COMPROBANTE_EN_REVISION);
  if (!(envio.tarifa_total > 0)) throw falla(409, 'Este envío no tiene monto a pagar: administración debe registrarlo como pagado');
  const conf = await leerConfig();
  if (!conf.pagos.en_linea) throw falla(409, PAGO_EN_LINEA_APAGADO);
  // Pulsar "Pagar" varias veces reutiliza el pago abierto en vez de acumular cobros iniciados.
  const abierto = await uno(
    `SELECT id, proveedor, monto, estado, token FROM pago WHERE envio_id = $1 AND estado = 'iniciado' AND proveedor = $2 AND monto = $3
     AND creado_en > now() - interval '1 day' ORDER BY id DESC LIMIT 1`, [envio.id, conf.pagos.proveedor, envio.tarifa_total]);
  if (abierto) return abierto;
  const costo = costoDelCobro(envio.tarifa_total, conf.pagos.proveedor);
  return transaccion(async (db) => {
    const { rows: [p] } = await db.query(
      `INSERT INTO pago (envio_id, proveedor, medio, monto, token, comision_estimada, neto_estimado, creado_por)
       VALUES ($1, $2, 'en_linea', $3, $4, $5, $6, $7) RETURNING id, proveedor, monto, estado, token`,
      [envio.id, conf.pagos.proveedor, envio.tarifa_total, crypto.randomBytes(18).toString('base64url'), costo.comision_estimada, costo.neto_estimado, usuarioId]);
    await registrarEventoPago(db, { pagoId: p.id, tipo: 'inicio', estado: 'iniciado', monto: p.monto, usuarioId });
    return p;
  });
}

// Confirma un pago simulado aplicando la misma verificación que se exigirá a la pasarela real
// (token, monto exacto en CLP, id de transacción). `autorizar(p)` decide quién puede confirmarlo.
export async function confirmarPago(req, tokenPago, resultado, autorizar) {
  // Un pago abierto antes de apagar el pago en línea tampoco se puede confirmar.
  if (!(await leerConfig()).pagos.en_linea) throw falla(409, PAGO_EN_LINEA_APAGADO);
  const envioId = await transaccion(async (db) => {
    const { rows: [p] } = await db.query(
      `SELECT p.*, e.cliente_id, e.repartidor_id, e.estado_pago, e.estado AS envio_estado, e.tarifa_total
       FROM pago p JOIN envio e ON e.id = p.envio_id WHERE p.token = $1 FOR UPDATE OF p, e`, [String(tokenPago)]);
    if (!p) throw falla(404, 'Pago no encontrado');
    autorizar(p);
    if (p.proveedor !== 'simulado') throw falla(409, 'Este pago lo confirma la pasarela');
    // Si el envío se anuló o cambió de monto mientras el pago estaba abierto, ese pago ya no sirve.
    if (p.estado === 'iniciado' && (['anulado', 'borrador'].includes(p.envio_estado) || p.monto !== p.tarifa_total)) {
      await db.query("UPDATE pago SET estado = 'anulado', actualizado_en = now() WHERE id = $1", [p.id]);
      await registrarEventoPago(db, { pagoId: p.id, tipo: 'rechazo', estado: 'anulado', monto: p.monto, datos: { motivo: 'Envío anulado o con otro monto' }, usuarioId: req.usuario?.id ?? null });
      return { anulado: true };
    }
    const transaccionId = `SIM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const informe = { estado: resultado, token: p.token, monto: p.monto, moneda: 'CLP', transaccion_id: transaccionId };
    let aprobado;
    try {
      ({ aprobado } = verificarConfirmacion(p, informe));
    } catch (err) {
      if (err.status === 422) await registrarEvento(req, 'pago_no_calza', { detalle: { pago: p.id, errores: err.detalles } });
      throw err;
    }
    if (!aprobado) {
      await db.query("UPDATE pago SET estado = 'rechazado', referencia = $1, actualizado_en = now() WHERE id = $2", [transaccionId, p.id]);
      await registrarEventoPago(db, { pagoId: p.id, tipo: 'rechazo', estado: 'rechazado', monto: p.monto, datos: informe, usuarioId: req.usuario?.id ?? null });
      return p.envio_id;
    }
    if (p.estado_pago === 'pagado') throw falla(409, 'El envío ya estaba pagado');
    // Un comprobante de transferencia en revisión podría ser un pago real: no se cobra dos veces.
    if (p.estado_pago === 'en_revision') throw falla(409, COMPROBANTE_EN_REVISION);
    const costo = costoDelCobro(p.monto, p.proveedor);
    await db.query(
      `UPDATE pago SET estado = 'aprobado', referencia = $1, transaccion_id = $1, verificacion = 'simulado', verificado_en = now(),
         comision_estimada = $2, neto_estimado = $3, abono_estimado_en = $4, actualizado_en = now() WHERE id = $5`,
      [transaccionId, costo.comision_estimada, costo.neto_estimado, costo.abono_estimado_en, p.id]);
    await registrarEventoPago(db, { pagoId: p.id, tipo: 'verificacion', estado: 'aprobado', monto: p.monto, firmaValida: true, datos: informe, usuarioId: req.usuario?.id ?? null });
    // Segundo resguardo ante dos pagos simultáneos: solo marca el envío si sigue sin pagar.
    const r = await db.query(
      `UPDATE envio SET estado_pago = 'pagado', pago_medio = 'en_linea', pago_referencia = $1, pagado_en = now(), actualizado_en = now()
       WHERE id = $2 AND estado_pago <> 'pagado'`, [transaccionId, p.envio_id]);
    if (!r.rowCount) throw falla(409, 'El envío ya estaba pagado');
    await cerrarCobrosAbiertos(db, p.envio_id);
    return p.envio_id;
  });
  if (envioId?.anulado) throw falla(409, 'El envío fue anulado o cambió su monto: este pago ya no es válido');
  return envioId;
}

// ---------- Transferencia con comprobante (revisión de administración) ----------
// El cliente transfiere, sube la imagen y el pago queda "en revisión". Administración la mira y
// aprueba (el envío queda pagado: ticket, asignación y retiro) o rechaza con motivo (se sube otra).

export const PAGO_EN_LINEA_APAGADO = 'El pago se hace por transferencia: transfiere y sube el comprobante para que administración lo apruebe';

export const COMPROBANTE_EN_REVISION = 'Hay un comprobante de transferencia en revisión: espera a que administración lo apruebe o lo rechace';

export async function registrarComprobante(envio, archivo, { referencia, usuarioId }) {
  const { pagos: [p], comprobante_adjunto_id: adjunto } = await registrarComprobanteLote([envio], archivo, { referencia, usuarioId });
  return { ...p, comprobante_adjunto_id: adjunto };
}

// Carrito (pedido 01-10): un solo comprobante paga varios envíos. Se crea un pago por envío, todos con el mismo
// comprobante y el mismo "lote", y administración los aprueba o rechaza juntos.
export async function registrarComprobanteLote(envios, archivo, { referencia, usuarioId }) {
  return transaccion(async (db) => {
    // Se bloquean los envíos (en orden, para no trabarse con otra subida simultánea): ninguno queda con dos comprobantes.
    const ids = envios.map((e) => e.id).sort((a, b) => a - b);
    const { rows: vigentes } = await db.query(
      `SELECT id, folio FROM envio WHERE id = ANY($1) AND estado_pago = 'pendiente' AND estado NOT IN ('borrador', 'anulado') ORDER BY id FOR UPDATE`, [ids]);
    if (vigentes.length !== ids.length) {
      throw falla(409, 'Algún envío ya no está pendiente de pago. Recarga para ver su estado actual.', { envios_no_pendientes: ids.filter((id) => !vigentes.some((v) => v.id === id)) });
    }
    const { rows: [adj] } = await db.query(
      `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
       VALUES ($1, 'comprobante_pago', $2, $3, $4, $5, $6, $7) RETURNING id`,
      [envios[0].id, archivo.nombre, archivo.mime, archivo.tamano, archivo.ruta, archivo.sha256, usuarioId]);
    const lote = envios.length > 1 ? crypto.randomUUID() : null;
    const pagos = [];
    for (const envio of envios) {
      const { rows: [p] } = await db.query(
        `INSERT INTO pago (envio_id, proveedor, medio, monto, estado, token, referencia, comprobante_adjunto_id, comision_estimada, neto_estimado, creado_por, lote)
         VALUES ($1, 'transferencia', 'transferencia', $2, 'en_revision', $3, $4, $5, 0, $2, $6, $7) RETURNING id, envio_id, monto, estado, referencia, creado_en, lote`,
        [envio.id, envio.tarifa_total, crypto.randomBytes(18).toString('base64url'), referencia, adj.id, usuarioId, lote]);
      await registrarEventoPago(db, { pagoId: p.id, tipo: 'inicio', estado: 'en_revision', monto: p.monto, datos: { comprobante: adj.id, referencia, lote }, usuarioId });
      pagos.push(p);
    }
    await db.query("UPDATE envio SET estado_pago = 'en_revision', actualizado_en = now() WHERE id = ANY($1)", [ids]);
    return { pagos, lote, comprobante_adjunto_id: adj.id, total: pagos.reduce((t, x) => t + x.monto, 0) };
  });
}

// Pagos que se revisan juntos: los del mismo lote (carrito) o solo el indicado.
async function pagosDelLote(db, pagoId) {
  const { rows } = await db.query(
    `SELECT p.id FROM pago p WHERE p.id = $1 OR (p.lote IS NOT NULL AND p.estado = 'en_revision' AND p.lote = (SELECT lote FROM pago WHERE id = $1))
     ORDER BY p.envio_id`, [pagoId]);
  return rows.map((r) => r.id);
}

// Lee y bloquea el pago en revisión junto a su envío. Si ya lo revisó otra persona, 409.
async function pagoEnRevision(db, pagoId) {
  const { rows: [p] } = await db.query(
    `SELECT p.*, e.estado AS envio_estado, e.estado_pago, e.tarifa_total, e.folio
     FROM pago p JOIN envio e ON e.id = p.envio_id WHERE p.id = $1 FOR UPDATE OF p, e`, [pagoId]);
  if (!p || !p.comprobante_adjunto_id) throw falla(404, 'Comprobante no encontrado');
  if (p.estado !== 'en_revision') throw falla(409, 'Este comprobante ya fue revisado. Recarga para ver su estado actual.');
  return p;
}

export async function aprobarComprobante(pagoId, { referencia, usuarioId }) {
  return transaccion(async (db) => {
    const envioIds = [];
    for (const id of await pagosDelLote(db, pagoId)) envioIds.push(await aprobarUno(db, id, { referencia, usuarioId }));
    return envioIds;
  });
}

async function aprobarUno(db, pagoId, { referencia, usuarioId }) {
  {
    const p = await pagoEnRevision(db, pagoId);
    if (['borrador', 'anulado'].includes(p.envio_estado)) throw falla(409, `El envío ${p.folio || ''} fue anulado: rechaza el comprobante en vez de aprobarlo`);
    if (p.estado_pago !== 'en_revision') throw falla(409, 'El envío ya no espera este pago. Recarga para ver su estado actual.');
    if (p.monto !== p.tarifa_total) throw falla(409, 'El monto del envío cambió: rechaza el comprobante y pide uno por el monto correcto');
    const ref = referencia || p.referencia;
    await db.query(
      `UPDATE pago SET estado = 'aprobado', referencia = $1, verificacion = 'manual', verificado_en = now(), verificado_por = $2,
         revisado_en = now(), revisado_por = $2, actualizado_en = now() WHERE id = $3`, [ref, usuarioId, p.id]);
    await registrarEventoPago(db, { pagoId: p.id, tipo: 'verificacion', estado: 'aprobado', monto: p.monto, datos: { comprobante: p.comprobante_adjunto_id, referencia: ref }, usuarioId });
    await db.query(
      `UPDATE envio SET estado_pago = 'pagado', pago_medio = 'transferencia', pago_referencia = $1, pagado_en = now(), actualizado_en = now()
       WHERE id = $2`, [ref, p.envio_id]);
    await cerrarCobrosAbiertos(db, p.envio_id);
    // Pendiente a futuro (D-13): emitir aquí la boleta electrónica en el SII por este pago.
    return p.envio_id;
  }
}

export async function rechazarComprobante(pagoId, { motivo, usuarioId }) {
  return transaccion(async (db) => {
    const envioIds = [];
    for (const id of await pagosDelLote(db, pagoId)) envioIds.push(await rechazarUno(db, id, { motivo, usuarioId }));
    return envioIds;
  });
}

async function rechazarUno(db, pagoId, { motivo, usuarioId }) {
  {
    const p = await pagoEnRevision(db, pagoId);
    await db.query(
      `UPDATE pago SET estado = 'rechazado', motivo_rechazo = $1, revisado_en = now(), revisado_por = $2, actualizado_en = now() WHERE id = $3`,
      [motivo, usuarioId, p.id]);
    await registrarEventoPago(db, { pagoId: p.id, tipo: 'rechazo', estado: 'rechazado', monto: p.monto, datos: { comprobante: p.comprobante_adjunto_id, motivo }, usuarioId });
    // El envío vuelve a "pendiente": el cliente ve el motivo y sube un comprobante nuevo.
    await db.query("UPDATE envio SET estado_pago = 'pendiente', actualizado_en = now() WHERE id = $1 AND estado_pago = 'en_revision'", [p.envio_id]);
    return p.envio_id;
  }
}
