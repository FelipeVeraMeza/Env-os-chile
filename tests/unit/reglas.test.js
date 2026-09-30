import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularTarifa, enlacesMapa, esperaCumplida, formatearFolio, normalizarRut, normalizarTelefono, ocultarMontos,
  normalizarLista, puedeTransicionar, rolPuedeTransicionar, validarDestino, validarMotivoRechazo, validarPaquete, validarReclamo, validarSubidaComprobante,
  validarTransicion, validarUbicacion, CONFIG_POR_DEFECTO,
} from '../../server/lib/reglas.js';

test('teléfono móvil chileno se normaliza a +56 9 XXXX XXXX', () => {
  assert.equal(normalizarTelefono('987654321'), '+56 9 8765 4321');
  assert.equal(normalizarTelefono('+56 9 8765 4321'), '+56 9 8765 4321');
  assert.equal(normalizarTelefono('56987654321'), '+56 9 8765 4321');
  assert.equal(normalizarTelefono('87654321'), '+56 9 8765 4321');
  assert.equal(normalizarTelefono('22345678'), '+56 9 2234 5678');
  assert.equal(normalizarTelefono('123'), null);
  assert.equal(normalizarTelefono(''), null);
});

test('RUT valida dígito verificador', () => {
  assert.equal(normalizarRut('11.111.111-1'), '11.111.111-1');
  assert.equal(normalizarRut('12345678-5'), '12.345.678-5');
  assert.equal(normalizarRut('12345678-9'), null);
  assert.equal(normalizarRut('10000013-K'), '10.000.013-K');
});

test('tarifa: estándar $3.500 sin importar los bultos, sobredimensionado +$2.000, horario especial +$1.000', () => {
  const t = CONFIG_POR_DEFECTO.tarifas;
  const estandar = { peso_kg: 10, largo_cm: 40, ancho_cm: 40, alto_cm: 40 };
  assert.equal(calcularTarifa(estandar, t).tarifa_total, 3500, '10 kg y 40×40×40 exactos son estándar');
  assert.equal(calcularTarifa({ ...estandar, bultos: 7 }, t).tarifa_total, 3500, 'la cantidad de bultos no cambia el precio');
  assert.equal(calcularTarifa({ ...estandar, horario_especial: true }, t).tarifa_total, 4500);
  const pesado = calcularTarifa({ ...estandar, peso_kg: 10.1 }, t);
  assert.equal(pesado.recargo_sobredimension, 2000);
  assert.equal(pesado.tarifa_total, 5500);
  assert.equal(calcularTarifa({ ...estandar, alto_cm: 41 }, t).tarifa_total, 5500, 'un lado sobre 40 cm');
  assert.equal(calcularTarifa({ peso_kg: 20, largo_cm: 60, ancho_cm: 60, alto_cm: 60, bultos: 4 }, t).tarifa_total, 5500);
  assert.equal(calcularTarifa({ ...estandar, peso_kg: 15, horario_especial: true }, t).tarifa_total, 6500);
  assert.equal(calcularTarifa(estandar, t, 4000).tarifa_total, 4000, 'tarifa propia de la comuna');
  assert.equal(calcularTarifa({ ...estandar, peso_kg: 12 }, t, 4000).tarifa_total, 6000);
});

test('paquete: sobre 20 kg o 60×60×60 cm no se recibe', () => {
  const ok = { descripcion_producto: 'x', bultos: 1, peso_kg: 20, largo_cm: 60, ancho_cm: 60, alto_cm: 60 };
  assert.deepEqual(validarPaquete(ok), {});
  assert.ok(validarPaquete({ ...ok, peso_kg: 20.01 }).peso_kg);
  assert.ok(validarPaquete({ ...ok, ancho_cm: 61 }).ancho_cm);
  assert.ok(validarPaquete({ ...ok, descripcion_producto: ' ' }).descripcion_producto);
  assert.ok(validarPaquete({ ...ok, bultos: 0 }).bultos);
});

test('máquina de estados', () => {
  assert.ok(puedeTransicionar('borrador', 'creado'));
  assert.ok(puedeTransicionar('en_ruta', 'entregado'));
  assert.ok(!puedeTransicionar('creado', 'entregado'));
  assert.ok(!puedeTransicionar('entregado', 'en_ruta'));
  assert.ok(!puedeTransicionar('anulado', 'creado'));
});

test('no se retira sin pago', () => {
  assert.throws(() => validarTransicion({ actual: 'asignado', nuevo: 'en_ruta', estadoPago: 'pendiente', intentos: 0 }), /pagado/);
  assert.doesNotThrow(() => validarTransicion({ actual: 'asignado', nuevo: 'en_ruta', estadoPago: 'pagado', intentos: 0 }));
});

test('máximo 3 intentos', () => {
  assert.doesNotThrow(() => validarTransicion({ actual: 'fallido', nuevo: 'reagendado', estadoPago: 'pagado', intentos: 2 }));
  assert.throws(() => validarTransicion({ actual: 'fallido', nuevo: 'reagendado', estadoPago: 'pagado', intentos: 3 }), /3 intentos/);
  assert.doesNotThrow(() => validarTransicion({ actual: 'fallido', nuevo: 'devuelto', estadoPago: 'pagado', intentos: 3 }));
});

test('espera máxima de 5 minutos', () => {
  const llegada = new Date('2026-10-01T12:00:00Z');
  assert.equal(esperaCumplida(llegada, 5, new Date('2026-10-01T12:04:59Z')), false);
  assert.equal(esperaCumplida(llegada, 5, new Date('2026-10-01T12:05:00Z')), true);
  assert.equal(esperaCumplida(null, 5), false);
  assert.throws(() => validarTransicion({ actual: 'en_ruta', nuevo: 'fallido', estadoPago: 'pagado', intentos: 0, motivo: 'espera_excedida', llegadaEn: llegada, ahora: new Date('2026-10-01T12:03:00Z') }));
  assert.doesNotThrow(() => validarTransicion({ actual: 'en_ruta', nuevo: 'fallido', estadoPago: 'pagado', intentos: 0, motivo: 'espera_excedida', llegadaEn: llegada, ahora: new Date('2026-10-01T12:06:00Z') }));
});

test('permisos por rol en transiciones', () => {
  assert.ok(rolPuedeTransicionar('repartidor', 'asignado', 'en_ruta', { esAsignado: true }));
  assert.ok(!rolPuedeTransicionar('repartidor', 'asignado', 'en_ruta', { esAsignado: false }));
  assert.ok(!rolPuedeTransicionar('repartidor', 'fallido', 'reagendado', { esAsignado: true }));
  assert.ok(rolPuedeTransicionar('cliente', 'creado', 'anulado', { esDueno: true, estadoPago: 'pendiente' }));
  assert.ok(!rolPuedeTransicionar('cliente', 'creado', 'anulado', { esDueno: true, estadoPago: 'pagado' }));
  assert.ok(!rolPuedeTransicionar('cliente', 'asignado', 'anulado', { esDueno: true }));
});

test('GPS obligatorio y coordenadas válidas', () => {
  assert.throws(() => validarUbicacion({}, true), /GPS/);
  assert.equal(validarUbicacion({}, false), null);
  assert.throws(() => validarUbicacion({ lat: 100, lon: 0 }), /inválidas/);
  assert.deepEqual(validarUbicacion({ lat: '-33.4', lon: '-70.6' }), { lat: -33.4, lon: -70.6 });
});

test('seguro: la boleta es obligatoria y el monto tiene tope', () => {
  const envio = { valor_declarado: 50000, estado: 'entregado' };
  const datos = { motivo: 'dano', boleta_numero: '1', boleta_fecha: '2026-09-01', boleta_monto: 45000, monto_reclamado: 40000 };
  const boleta = { mime: 'application/pdf' };
  assert.doesNotThrow(() => validarReclamo({ envio, boleta, datos }));
  assert.throws(() => validarReclamo({ envio, boleta: null, datos }), (e) => e.detalles.boleta.includes('obligatoria'));
  assert.throws(() => validarReclamo({ envio, boleta: { mime: 'text/plain' }, datos }), (e) => Boolean(e.detalles.boleta));
  assert.throws(() => validarReclamo({ envio, boleta, datos: { ...datos, monto_reclamado: 45001 } }), (e) => Boolean(e.detalles.monto_reclamado));
  assert.throws(() => validarReclamo({ envio: { ...envio, valor_declarado: 0 }, boleta, datos }), /no está asegurado/);
  assert.throws(() => validarReclamo({ envio, boleta, datos, reclamosPrevios: [{ estado: 'solicitado' }] }), /activo/);
  assert.doesNotThrow(() => validarReclamo({ envio, boleta, datos, reclamosPrevios: [{ estado: 'rechazado' }] }));
  assert.throws(() => validarReclamo({ envio, boleta, datos: { ...datos, boleta_fecha: '2999-01-01' } }), (e) => Boolean(e.detalles.boleta_fecha));
});

test('folio y enlaces de mapa', () => {
  assert.equal(formatearFolio('ENV', 2026, 4137), 'ENV-2026-004137');
  const m = enlacesMapa({ calle: 'Av. Providencia', numero: '1234', comuna: 'Providencia', region: 'Metropolitana' });
  assert.match(m.google, /destination=Av\.%20Providencia%201234%2C%20Providencia/);
  assert.match(m.waze, /navigate=yes/);
  const c = enlacesMapa({ calle: 'x', numero: '1', comuna: 'y', lat: -33.1, lon: -70.2 });
  assert.match(c.waze, /ll=-33\.1%2C-70\.2/);
});

test('el repartidor no recibe montos', () => {
  const e = ocultarMontos({ folio: 'x', tarifa_total: 3500, valor_declarado: 1000 });
  assert.equal(e.tarifa_total, undefined);
  assert.equal(e.valor_declarado, undefined);
  assert.equal(e.folio, 'x');
});

test('couriers y franjas editables: validación contra la lista configurada', () => {
  const listas = { couriers: ['Starken', 'Mi Courier'], franjas: ['09:00 – 12:00'] };
  const punto = { tipo_destino: 'punto_courier', courier_punto: 'Sucursal Centro' };
  assert.deepEqual(validarDestino({ ...punto, courier_empresa: 'Mi Courier' }, listas, true), {});
  assert.ok(validarDestino({ ...punto, courier_empresa: 'Blue Express' }, listas, true).courier_empresa);
  // Envío a otras compañías en pausa (por defecto): solo domicilio.
  assert.match(validarDestino({ ...punto, courier_empresa: 'Mi Courier' }, listas).tipo_destino, /pausa/);
  assert.deepEqual(validarDestino({ tipo_destino: 'domicilio' }, listas), {});
  assert.deepEqual(validarDestino({ horario_especial: true, franja_horaria: '09:00-12:00' }, listas), {});
  assert.ok(validarDestino({ horario_especial: true, franja_horaria: '19:00 – 21:00' }, listas).franja_horaria);
  // Por defecto sigue aceptando las listas originales.
  assert.deepEqual(validarDestino({ horario_especial: true, franja_horaria: '19:00 - 21:00' }), {});
});

test('listas de Ajustes: una opción por línea, sin vacíos ni duplicados', () => {
  assert.deepEqual(normalizarLista(' Starken \n\nStarken\nBlue Express '), { lista: ['Starken', 'Blue Express'] });
  assert.deepEqual(normalizarLista(['A', 'B']), { lista: ['A', 'B'] });
  assert.ok(normalizarLista('\n  \n').error);
  assert.ok(normalizarLista(Array.from({ length: 21 }, (_, i) => `C${i}`)).error);
  assert.ok(normalizarLista('x'.repeat(61)).error);
});

test('comprobante de transferencia: solo con el pago pendiente de un envío confirmado', () => {
  const envio = { estado: 'creado', estado_pago: 'pendiente', tarifa_total: 3500 };
  assert.doesNotThrow(() => validarSubidaComprobante(envio));
  assert.throws(() => validarSubidaComprobante({ ...envio, estado: 'borrador' }), /Confirma/);
  assert.throws(() => validarSubidaComprobante({ ...envio, estado: 'anulado' }), /Confirma/);
  assert.throws(() => validarSubidaComprobante({ ...envio, estado_pago: 'en_revision' }), /en revisión/);
  assert.throws(() => validarSubidaComprobante({ ...envio, estado_pago: 'pagado' }), /pagado/);
  assert.throws(() => validarSubidaComprobante({ ...envio, estado_pago: 'reembolsado' }), /pagado/);
  assert.throws(() => validarSubidaComprobante({ ...envio, tarifa_total: 0 }), /monto/);
});

test('rechazar un comprobante exige un motivo que el cliente pueda leer', () => {
  assert.equal(validarMotivoRechazo('  El monto no coincide '), 'El monto no coincide');
  for (const vacio of [undefined, null, '', '   ']) assert.throws(() => validarMotivoRechazo(vacio), (e) => e.status === 422 && Boolean(e.detalles.motivo));
  assert.throws(() => validarMotivoRechazo('x'.repeat(301)), /300/);
});
