// Pruebas de las correcciones del plan QA de 50 errores (docs/18-plan-qa-50-errores.md).
// Cada prueba indica el N° del error (QA-NN) que protege.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTelefono, ocultarMontos, validarReclamo } from '../../server/lib/reglas.js';
import { numeroEnv, validarSecreto } from '../../server/config.js';
import { fechaFiltro, patronBusqueda, rangoFechas } from '../../server/lib/http.js';
import { quitarExif, tieneExif } from '../../server/lib/exif.js';

test('QA-01 · el repartidor no ve el recargo por sobredimensión ni otros montos', () => {
  const e = ocultarMontos({ folio: 'x', tarifa_total: 5500, recargo_sobredimension: 2000, reembolso_monto: 5500, pago_referencia: 'T-1' });
  assert.equal(e.recargo_sobredimension, undefined);
  assert.equal(e.reembolso_monto, undefined);
  assert.equal(e.pago_referencia, undefined);
  assert.equal(e.folio, 'x');
});

test('QA-02 · "localhost" dentro de otro dominio no se trata como este equipo', () => {
  const base = { AUTH_MODE: 'jwt', JWT_SECRET: 'corta' };
  assert.equal(validarSecreto({ ...base, PUBLIC_BASE_URL: 'http://localhost:3000' }), null);
  assert.match(validarSecreto({ ...base, PUBLIC_BASE_URL: 'https://localhost.atacante.cl' }), /JWT_SECRET/);
  assert.match(validarSecreto({ ...base, PUBLIC_BASE_URL: 'https://mi-localhost-app.cl' }), /JWT_SECRET/);
});

test('QA-04 / QA-39 · variables numéricas vacías o inválidas usan el valor por defecto', () => {
  assert.equal(numeroEnv('', 600), 600);
  assert.equal(numeroEnv(undefined, 600), 600);
  assert.equal(numeroEnv('abc', 30, { min: 1 }), 30);
  assert.equal(numeroEnv('0', 30, { min: 1 }), 30);
  assert.equal(numeroEnv('0', 600), 0, 'un 0 explícito sí desactiva el límite');
  assert.equal(numeroEnv('15', 30, { min: 1 }), 15);
});

test('QA-06 · la búsqueda escapa los comodines y limita el largo', () => {
  assert.equal(patronBusqueda(' 50% '), '%50\\%%');
  assert.equal(patronBusqueda('a_b'), '%a\\_b%');
  assert.equal(patronBusqueda('x'.repeat(500)).length, 102);
});

test('QA-08 · se quita el EXIF aunque haya bytes de relleno antes del marcador', () => {
  const app1 = Buffer.from([0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xff]), app1, sos]);
  assert.equal(tieneExif(jpeg), true);
  const limpio = quitarExif(jpeg);
  assert.equal(tieneExif(limpio), false);
  assert.ok(limpio.includes(sos), 'los datos de la imagen se conservan');
});

test('QA-16 · el seguro se reclama solo cuando el envío ya fue retirado', () => {
  const datos = { motivo: 'perdida', boleta_numero: '1', boleta_fecha: '2026-09-01', boleta_monto: 10000, monto_reclamado: 5000 };
  const boleta = { mime: 'application/pdf' };
  for (const estado of ['creado', 'asignado']) {
    assert.throws(() => validarReclamo({ envio: { valor_declarado: 20000, estado }, boleta, datos }), /retirado/, estado);
  }
  for (const estado of ['en_ruta', 'entregado', 'fallido', 'reagendado', 'devuelto']) {
    assert.doesNotThrow(() => validarReclamo({ envio: { valor_declarado: 20000, estado }, boleta, datos }), estado);
  }
});

test('QA-19 · fechas imposibles y rangos invertidos se rechazan', () => {
  assert.throws(() => fechaFiltro('2026-02-31', 'desde'), /fecha válida/);
  assert.equal(fechaFiltro('2028-02-29', 'desde'), '2028-02-29');
  assert.throws(() => rangoFechas({ desde: '2026-09-10', hasta: '2026-09-01' }), /posterior/);
  const r = rangoFechas({});
  assert.match(r.desde, /^\d{4}-\d{2}-01$/);
  assert.ok(r.desde <= r.hasta);
});

test('QA-50 · teléfono con prefijo internacional 0056 y números de 8 dígitos que empiezan con 56', () => {
  assert.equal(normalizarTelefono('0056 9 8765 4321'), '+56 9 8765 4321');
  assert.equal(normalizarTelefono('5678 1234'), '+56 9 5678 1234');
  assert.equal(normalizarTelefono('+56 9 5678 1234'), '+56 9 5678 1234');
});
