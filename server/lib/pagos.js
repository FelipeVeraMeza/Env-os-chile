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
  if (!(envio.tarifa_total > 0)) throw falla(409, 'Este envío no tiene monto a pagar: administración debe registrarlo como pagado');
  const conf = await leerConfig();
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
    return p.envio_id;
  });
  if (envioId?.anulado) throw falla(409, 'El envío fue anulado o cambió su monto: este pago ya no es válido');
  return envioId;
}
