import { config } from '../config.js';
import { query, transaccion } from '../db/pool.js';
import { enviarCorreo, correoConfigurado } from './correo.js';
import { registrarEstado } from './envios.js';
import { cerrarCobrosAbiertos } from './pagos.js';

// Envíos sin pagar se anulan solos (pedido del cliente 03-10): si a las 24 horas de confirmado (o de reactivado) el
// envío sigue con el pago pendiente, pasa a "anulado" con el motivo en su historial. No se tocan los que tienen un
// comprobante en revisión (el cliente ya pagó y falta que administración lo apruebe) ni los que ya tienen repartidor.
export const MOTIVO_VENCIDO = 'Anulado automáticamente: sin pago 24 horas después de creado';
export const PREFIJO_VENCIDO = 'Anulado automáticamente';
// Desde cuándo corre el plazo de pago (SQL): al reactivar un envío el plazo empieza de nuevo.
export const INICIO_PLAZO = 'COALESCE(e.reactivado_en, e.confirmado_en, e.creado_en)';
export const HORAS_AVISO = 2;
const POR_VENCER = "e.estado = 'creado' AND e.estado_pago = 'pendiente' AND e.repartidor_id IS NULL";

export async function anularVencidos(horas = config.horasSinPago) {
  return transaccion(async (db) => {
    const { rows } = await db.query(
      `UPDATE envio e SET estado = 'anulado', actualizado_en = now()
        WHERE ${POR_VENCER} AND ${INICIO_PLAZO} < now() - make_interval(hours => $1)
        RETURNING id`, [horas]);
    for (const { id } of rows) {
      await registrarEstado(db, { envioId: id, anterior: 'creado', nuevo: 'anulado', motivo: horas === 24 ? MOTIVO_VENCIDO : `${PREFIJO_VENCIDO}: sin pago ${horas} horas después de creado`, usuarioId: null });
      await cerrarCobrosAbiertos(db, id, 'El envío se anuló por falta de pago');
    }
    return rows.map((r) => r.id);
  });
}

// Aviso por correo al cliente 2 horas antes de la anulación (si hay SMTP configurado). Se marca el envío para no
// repetir el aviso; sin correo configurado no se marca nada y administración recuerda por WhatsApp desde Cobranza.
export async function avisarPorVencer(horas = config.horasSinPago) {
  if (!correoConfigurado()) return [];
  const { rows } = await query(
    `SELECT e.id, e.folio, e.tarifa_total, u.correo, u.nombre, ${INICIO_PLAZO} + make_interval(hours => $1) AS vence_en
       FROM envio e JOIN usuario u ON u.id = e.cliente_id
      WHERE ${POR_VENCER} AND e.aviso_vencimiento_en IS NULL AND u.correo IS NOT NULL
        AND ${INICIO_PLAZO} < now() - make_interval(hours => $2)
      ORDER BY e.id LIMIT 200`, [horas, Math.max(horas - HORAS_AVISO, 0)]);
  const avisados = [];
  for (const e of rows) {
    // Se marca antes de enviar: con dos instancias del servidor, solo una toma cada envío.
    const { rowCount } = await query('UPDATE envio SET aviso_vencimiento_en = now() WHERE id = $1 AND aviso_vencimiento_en IS NULL', [e.id]);
    if (!rowCount) continue;
    const hora = new Date(e.vence_en).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
    try {
      await enviarCorreo({
        para: e.correo,
        asunto: `Tu envío ${e.folio} se anula a las ${hora} si no se paga`,
        texto: `Hola ${e.nombre}:\n\nTu envío ${e.folio} sigue sin pagar ($${Number(e.tarifa_total).toLocaleString('es-CL')}). Si no se paga antes del ${hora}, se anulará automáticamente.\n\nPaga desde la app (Por pagar) o sube el comprobante de tu transferencia.\n`,
      });
      avisados.push(e.id);
    } catch (err) {
      await query('UPDATE envio SET aviso_vencimiento_en = NULL WHERE id = $1', [e.id]);
      console.error(`[vencimientos] no se pudo avisar el envío ${e.folio}:`, err.message);
    }
  }
  return avisados;
}

// Se revisa al iniciar y cada 10 minutos. Con varias instancias no hay doble anulación: el UPDATE solo toma
// envíos que siguen en "creado".
export function programarVencimientos() {
  const correr = async () => {
    try {
      const avisados = await avisarPorVencer();
      if (avisados.length) console.log(`[vencimientos] ${avisados.length} aviso(s) de vencimiento enviados por correo`);
      const ids = await anularVencidos();
      if (ids.length) console.log(`[vencimientos] ${ids.length} envío(s) sin pago anulados (ids ${ids.join(', ')})`);
    } catch (err) { console.error('[vencimientos] no se pudo revisar los envíos por vencer:', err.message); }
  };
  setTimeout(correr, 15_000).unref();
  setInterval(correr, 10 * 60_000).unref();
}
