import { config } from '../config.js';
import { transaccion } from '../db/pool.js';
import { registrarEstado } from './envios.js';
import { cerrarCobrosAbiertos } from './pagos.js';

// Envíos sin pagar se anulan solos (pedido del cliente 03-10): si a las 24 horas de confirmado el envío sigue con el
// pago pendiente, pasa a "anulado" con el motivo en su historial. No se tocan los que tienen un comprobante en
// revisión (el cliente ya pagó y falta que administración lo apruebe) ni los que ya tienen repartidor.
export const MOTIVO_VENCIDO = 'Anulado automáticamente: sin pago 24 horas después de creado';

export async function anularVencidos(horas = config.horasSinPago) {
  return transaccion(async (db) => {
    const { rows } = await db.query(
      `UPDATE envio SET estado = 'anulado', actualizado_en = now()
        WHERE estado = 'creado' AND estado_pago = 'pendiente' AND repartidor_id IS NULL
          AND COALESCE(confirmado_en, creado_en) < now() - make_interval(hours => $1)
        RETURNING id`, [horas]);
    for (const { id } of rows) {
      await registrarEstado(db, { envioId: id, anterior: 'creado', nuevo: 'anulado', motivo: horas === 24 ? MOTIVO_VENCIDO : `Anulado automáticamente: sin pago ${horas} horas después de creado`, usuarioId: null });
      await cerrarCobrosAbiertos(db, id, 'El envío se anuló por falta de pago');
    }
    return rows.map((r) => r.id);
  });
}

// Se revisa al iniciar y cada 10 minutos. Con varias instancias no hay doble anulación: el UPDATE solo toma
// envíos que siguen en "creado".
export function programarVencimientos() {
  const correr = () => anularVencidos()
    .then((ids) => { if (ids.length) console.log(`[vencimientos] ${ids.length} envío(s) sin pago anulados (ids ${ids.join(', ')})`); })
    .catch((err) => console.error('[vencimientos] no se pudieron anular los envíos vencidos:', err.message));
  setTimeout(correr, 15_000).unref();
  setInterval(correr, 10 * 60_000).unref();
}
