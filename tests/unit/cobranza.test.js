import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compararProveedores, estimarCosto, fechaAbonoEstimada, validarConciliacion, verificarConfirmacion, PROVEEDORES_PAGO,
} from '../../server/lib/cobranza.js';

test('costo de cobro: comisión + IVA sobre la comisión, y neto', () => {
  assert.deepEqual(estimarCosto(3500, 'webpay'), { monto: 3500, comision: 103, iva: 20, costo: 123, neto: 3377, porcentaje_efectivo: 123 / 3500 });
  assert.equal(estimarCosto(3500, 'transferencia').costo, 0);
  assert.equal(estimarCosto(0, 'webpay').costo, 0);
  assert.equal(estimarCosto(3500, { porcentaje: 0, fijo: 100, iva: false }).costo, 100);
  assert.throws(() => estimarCosto(3500, 'inexistente'), /desconocido/);
});

test('comparador ordena del más barato al más caro, sin el simulador, y proyecta el mes', () => {
  const c = compararProveedores(3500, 300);
  assert.ok(!c.some((p) => p.proveedor === 'simulado'));
  assert.deepEqual(c.map((p) => p.costo), [...c.map((p) => p.costo)].sort((a, b) => a - b));
  const webpay = c.find((p) => p.proveedor === 'webpay');
  assert.equal(webpay.costo_mes, 123 * 300);
  assert.equal(webpay.lleva_iva, true);
  assert.equal(c.length, Object.keys(PROVEEDORES_PAGO).length - 1);
});

test('fecha de abono en días hábiles (salta fin de semana)', () => {
  assert.equal(fechaAbonoEstimada('2026-10-02T15:00:00Z', 0), '2026-10-02'); // viernes, inmediato
  assert.equal(fechaAbonoEstimada('2026-10-02T15:00:00Z', 1), '2026-10-05'); // viernes → lunes
  assert.equal(fechaAbonoEstimada('2026-10-05T15:00:00Z', 3), '2026-10-08');
});

const pago = { estado: 'iniciado', token: 'tok-1', monto: 3500 };
const ok = { estado: 'aprobado', token: 'tok-1', monto: 3500, moneda: 'CLP', transaccion_id: 'TX-1' };

test('verificación: solo se aprueba si calzan orden, monto exacto, CLP e id de transacción', () => {
  assert.deepEqual(verificarConfirmacion(pago, ok), { aprobado: true });
  assert.throws(() => verificarConfirmacion(pago, { ...ok, monto: 3000 }), (e) => e.status === 422 && Boolean(e.detalles.monto));
  assert.throws(() => verificarConfirmacion(pago, { ...ok, token: 'otro' }), (e) => Boolean(e.detalles.token));
  assert.throws(() => verificarConfirmacion(pago, { ...ok, moneda: 'USD' }), (e) => Boolean(e.detalles.moneda));
  assert.throws(() => verificarConfirmacion(pago, { ...ok, transaccion_id: '' }), (e) => Boolean(e.detalles.transaccion_id));
  assert.throws(() => verificarConfirmacion({ ...pago, estado: 'aprobado' }, ok), (e) => e.status === 409);
  assert.equal(verificarConfirmacion(pago, { estado: 'rechazado' }).aprobado, false);
});

test('conciliación: la comisión real es lo cobrado menos lo abonado', () => {
  const aprobado = { estado: 'aprobado', monto: 3500, abonado_en: null };
  const hoy = new Date('2026-10-10T12:00:00Z');
  assert.deepEqual(validarConciliacion(aprobado, { monto_abonado: 3377, abonado_en: '2026-10-08' }, hoy), { monto_abonado: 3377, comision_real: 123, abonado_en: '2026-10-08' });
  assert.throws(() => validarConciliacion(aprobado, { monto_abonado: 4000 }, hoy), (e) => Boolean(e.detalles.monto_abonado));
  assert.throws(() => validarConciliacion(aprobado, { monto_abonado: '' }, hoy), (e) => Boolean(e.detalles.monto_abonado));
  assert.throws(() => validarConciliacion(aprobado, { monto_abonado: 3377, abonado_en: '2026-12-01' }, hoy), (e) => Boolean(e.detalles.abonado_en));
  assert.throws(() => validarConciliacion({ ...aprobado, abonado_en: '2026-10-01' }, { monto_abonado: 3377 }, hoy), (e) => e.status === 409);
  assert.throws(() => validarConciliacion({ ...aprobado, estado: 'iniciado' }, { monto_abonado: 3377 }, hoy), (e) => e.status === 409);
});
