// Pedido 07-10: cambiar el destino antes del retiro (aunque esté pagado) y reagendar el retiro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumarDias, validarCambioDestino, validarReagendarRetiro, MAX_CAMBIOS_CLIENTE } from '../../server/lib/reglas.js';

const envio = (extra = {}) => ({ estado: 'asignado', estado_pago: 'pagado', tipo_destino: 'domicilio', tarifa_total: 3500, destino_cambiado: 0, retiro_reagendado: 0, retiro_fecha: null, ...extra });
const codigo = (fn) => { try { fn(); } catch (err) { return err.status; } return 200; };

test('el destino se cambia antes del retiro, también si ya está pagado', () => {
  assert.deepEqual(validarCambioDestino(envio(), 3500), { actualizarTarifa: false }, 'pagado: el monto no cambia');
  assert.deepEqual(validarCambioDestino(envio({ estado: 'creado', estado_pago: 'pendiente' }), 4500), { actualizarTarifa: true }, 'por pagar: la tarifa se actualiza');
  assert.deepEqual(validarCambioDestino(envio(), 3000), { actualizarTarifa: false }, 'más barata: se mantiene lo pagado');
});

test('el destino no se cambia después del retiro, con comprobante en revisión ni en envíos inactivos', () => {
  for (const estado of ['en_ruta', 'entregado', 'fallido', 'reagendado', 'devuelto', 'anulado', 'borrador']) {
    assert.equal(codigo(() => validarCambioDestino(envio({ estado }), 3500)), 409, estado);
  }
  assert.equal(codigo(() => validarCambioDestino(envio({ estado_pago: 'en_revision' }), 3500)), 409);
  assert.equal(codigo(() => validarCambioDestino(envio({ tipo_destino: 'punto_courier' }), 3500)), 409);
});

test('pagado: la nueva dirección no puede costar más (salvo administración); hay un máximo de cambios del cliente', () => {
  assert.equal(codigo(() => validarCambioDestino(envio(), 4500)), 409);
  assert.deepEqual(validarCambioDestino(envio(), 4500, { rol: 'admin' }), { actualizarTarifa: false });
  assert.equal(codigo(() => validarCambioDestino(envio({ destino_cambiado: MAX_CAMBIOS_CLIENTE }), 3500)), 409);
  assert.equal(codigo(() => validarCambioDestino(envio({ destino_cambiado: MAX_CAMBIOS_CLIENTE }), 3500, { rol: 'admin' })), 200);
});

test('reagendar el retiro: desde mañana hasta 14 días, solo antes del retiro', () => {
  const hoy = '2026-10-07';
  assert.equal(sumarDias(hoy, 1), '2026-10-08');
  assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
  assert.equal(validarReagendarRetiro(envio(), '2026-10-08', { hoy }), '2026-10-08');
  assert.equal(validarReagendarRetiro(envio({ estado: 'creado', estado_pago: 'pendiente' }), '2026-10-21', { hoy }), '2026-10-21');
  assert.equal(codigo(() => validarReagendarRetiro(envio(), '2026-10-07', { hoy })), 422, 'hoy no');
  assert.equal(codigo(() => validarReagendarRetiro(envio(), '2026-10-22', { hoy })), 422, 'más de 14 días no');
  assert.equal(codigo(() => validarReagendarRetiro(envio(), '2026-02-30', { hoy })), 422, 'fecha inexistente');
  assert.equal(codigo(() => validarReagendarRetiro(envio(), 'mañana', { hoy })), 422);
  assert.equal(codigo(() => validarReagendarRetiro(envio({ retiro_fecha: '2026-10-09' }), '2026-10-09', { hoy })), 422, 'mismo día');
  assert.equal(codigo(() => validarReagendarRetiro(envio({ estado: 'en_ruta' }), '2026-10-08', { hoy })), 409);
  assert.equal(codigo(() => validarReagendarRetiro(envio({ retiro_reagendado: MAX_CAMBIOS_CLIENTE }), '2026-10-08', { hoy })), 409);
  assert.equal(codigo(() => validarReagendarRetiro(envio({ retiro_reagendado: MAX_CAMBIOS_CLIENTE }), '2026-10-08', { hoy, rol: 'admin' })), 200);
});

test('seguimiento público: cada paso dice el intento y la devolución explica por qué (sin el detalle del repartidor)', async () => {
  const { historialPublico } = await import('../../server/lib/reglas.js');
  const h = historialPublico([
    { estado: 'creado' }, { estado: 'asignado' },
    { estado: 'en_ruta' }, { estado: 'fallido', motivo: 'nadie_en_domicilio — vecino dice que llega tarde' },
    { estado: 'reagendado' }, { estado: 'en_ruta' }, { estado: 'fallido', motivo: 'direccion_incorrecta' },
    { estado: 'reagendado' }, { estado: 'en_ruta' }, { estado: 'fallido', motivo: 'otro' },
    { estado: 'devuelto' },
  ], 3);
  assert.match(h[2].label, /intento 1 de 3/);
  assert.equal(h[3].label, 'Intento 1 de 3: no se pudo entregar');
  assert.equal(h[3].detalle, 'Nadie en el domicilio', 'solo el motivo general');
  assert.equal(h[4].label, 'Reagendado para el intento 2 de 3');
  assert.equal(h[5].label, 'En ruta: intento 2 de 3');
  assert.equal(h[9].label, 'Intento 3 de 3: no se pudo entregar');
  assert.equal(h[10].label, 'Devuelto al remitente');
  assert.equal(h[10].detalle, 'Después de 3 intentos de entrega sin éxito');
  assert.ok(!JSON.stringify(h).includes('vecino'), 'el texto libre del repartidor no es público');
  const ok = historialPublico([{ estado: 'en_ruta' }, { estado: 'fallido', motivo: 'otro' }, { estado: 'reagendado' }, { estado: 'en_ruta' }, { estado: 'entregado' }], 3);
  assert.equal(ok.at(-1).label, 'Entregado en el intento 2');
});
