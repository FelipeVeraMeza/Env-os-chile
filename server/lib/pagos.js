import { estimarCosto, fechaAbonoEstimada, PROVEEDORES_PAGO } from './cobranza.js';

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
