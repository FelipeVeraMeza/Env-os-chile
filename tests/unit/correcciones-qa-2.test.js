// Pruebas de la segunda ronda del plan QA (QA-53 a QA-102, docs/18-plan-qa-50-errores.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizarRut, ocultarMontos, validarDestinatario, validarDestino, validarDireccion, validarPaquete, vistaDisponible } from '../../server/lib/reglas.js';
import { validarConciliacion } from '../../server/lib/cobranza.js';
import { leerArchivoEnv } from '../../qa/entornos.js';
import { conArchivo } from '../../server/lib/archivos.js';
import { config } from '../../server/config.js';

const paquete = { descripcion_producto: 'Libros', bultos: 1, peso_kg: 2, largo_cm: 30, ancho_cm: 20, alto_cm: 10 };

test('QA-83/QA-84 · el repartidor no ve el correo del destinatario ni datos personales de envíos que aún no toma', () => {
  const e = { folio: 'ENV-2026-000001', comuna_nombre: 'Ñuñoa', calle: 'Irarrázaval', numero: '10', bultos: 2, destinatario_nombre: 'Ana', destinatario_telefono: '+56 9 1111 2222',
    destinatario_correo: 'ana@x.cl', depto: '5B', referencia: 'Portón verde', cliente_rut: '11.111.111-1', tarifa_total: 3500 };
  assert.equal(ocultarMontos(e).destinatario_correo, undefined);
  assert.equal(ocultarMontos(e).destinatario_nombre, 'Ana', 'una vez asignado sí ve a quién entregar');
  const d = vistaDisponible(e);
  for (const c of ['destinatario_nombre', 'destinatario_telefono', 'destinatario_correo', 'depto', 'referencia', 'cliente_rut', 'tarifa_total']) assert.equal(d[c], undefined, c);
  for (const c of ['folio', 'comuna_nombre', 'calle', 'numero', 'bultos']) assert.ok(d[c] !== undefined, c);
});

test('QA-87/QA-88 · textos del envío y de la libreta tienen largo máximo', () => {
  assert.ok(validarPaquete({ ...paquete, descripcion_producto: 'x'.repeat(201) }).descripcion_producto);
  assert.ok(validarPaquete({ ...paquete, observaciones: 'x'.repeat(301) }).observaciones);
  assert.deepEqual(validarPaquete(paquete), {});
  assert.ok(validarDestino({ tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'x'.repeat(121) },
    { couriers: ['Starken'], franjas: [] }, true).courier_punto);
  assert.ok(validarDestinatario({ nombre: 'x'.repeat(121), telefono: '+56 9 1111 2222' }).nombre);
  assert.ok(validarDireccion({ calle: 'x'.repeat(121), numero: '1', comuna_id: 1 }).calle);
  assert.ok(validarDireccion({ calle: 'Los Leones', numero: '1'.repeat(21), comuna_id: 1 }).numero);
  assert.deepEqual(validarDireccion({ calle: 'Los Leones', numero: '1180', comuna_id: 1 }), {});
});

test('QA-89 · el RUT "0-0" no es válido', () => {
  assert.equal(normalizarRut('0-0'), null);
  assert.equal(normalizarRut('00000000-0'), null);
  assert.equal(normalizarRut('11.111.111-1'), '11.111.111-1');
});

test('QA-76/QA-77/QA-78 · conciliación: fecha real, no anterior al pago y solo para pasarelas', () => {
  const pago = { estado: 'aprobado', monto: 10000, proveedor: 'webpay', verificado_en: '2026-09-10T15:00:00Z' };
  const hoy = new Date('2026-09-20T12:00:00Z');
  assert.throws(() => validarConciliacion(pago, { monto_abonado: 9650, abonado_en: '2026-02-31' }, hoy), (e) => Boolean(e.detalles.abonado_en));
  assert.throws(() => validarConciliacion(pago, { monto_abonado: 9650, abonado_en: '2026-09-05' }, hoy), /Revisa/);
  assert.equal(validarConciliacion(pago, { monto_abonado: 9650, abonado_en: '2026-09-12' }, hoy).abonado_en, '2026-09-12');
  for (const proveedor of ['transferencia', 'manual', 'simulado']) {
    assert.throws(() => validarConciliacion({ ...pago, proveedor }, { monto_abonado: 9650 }, hoy), /pasarela/, proveedor);
  }
});

test('QA-93/QA-94 · el lector de archivos .env quita comillas, espacios finales y comentarios', () => {
  const v = leerArchivoEnv([
    'URL_RAILWAY=https://app.up.railway.app   ',
    'URL_VERCEL=https://web.vercel.app # interfaz',
    'JWT_SECRET="abc # no es comentario"',
    "DEMO_CLAVE='hola'",
    '# comentario',
    'export API_OBJETIVO=railway',
  ].join('\n'));
  assert.equal(v.URL_RAILWAY, 'https://app.up.railway.app');
  assert.equal(v.URL_VERCEL, 'https://web.vercel.app');
  assert.equal(v.JWT_SECRET, 'abc # no es comentario');
  assert.equal(v.DEMO_CLAVE, 'hola');
  assert.equal(v.API_OBJETIVO, 'railway');
});

test('QA-75 · si la operación falla después de subir el archivo, el archivo se borra', async () => {
  if (config.almacenamiento.driver !== 'local') return;
  const pdf = Buffer.from('%PDF-1.4\n% prueba de archivo huerfano\n%%EOF\n');
  let ruta;
  await assert.rejects(conArchivo(pdf, 'application/pdf', async (a) => { ruta = a.ruta; throw new Error('conflicto simulado'); }), /conflicto simulado/);
  assert.ok(ruta);
  assert.equal(fs.existsSync(path.join(config.uploadDir, ruta)), false, 'no queda archivo huérfano');
  const ok = await conArchivo(pdf, 'application/pdf', async (a) => a.ruta);
  assert.equal(fs.existsSync(path.join(config.uploadDir, ok)), true);
  fs.unlinkSync(path.join(config.uploadDir, ok));
});

test('QA-99 · CORS_ORIGINS con barra final igual permite la interfaz publicada', async () => {
  const { origenesCors } = await import('../../server/config.js');
  const o = origenesCors({ CORS_ORIGINS: 'https://envios.vercel.app/, https://envios.cl//' }, 'https://api.up.railway.app');
  assert.ok(o.includes('https://envios.vercel.app'));
  assert.ok(o.includes('https://envios.cl'));
  assert.ok(o.includes('https://api.up.railway.app'));
});

test('QA-95/QA-100 · los archivos generados están al día (SQL de Supabase y configuración de la interfaz)', async () => {
  const { CONFIG_POR_DEFECTO } = await import('../../server/lib/reglas.js');
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'base-de-datos-completa.sql'), 'utf8');
  assert.match(sql, new RegExp(`${Object.keys(CONFIG_POR_DEFECTO).length} claves de configuración`));
  const migraciones = fs.readdirSync(path.join(process.cwd(), 'server', 'db', 'migrations')).filter((f) => f.endsWith('.sql'));
  for (const m of migraciones) assert.ok(sql.includes(`Migración ${m}`), `falta ${m} en el SQL de Supabase`);
  const { cargarEntornos } = await import('../../qa/entornos.js');
  const railway = (cargarEntornos().URL_RAILWAY || '').replace(/\/+$/, '');
  const web = fs.readFileSync(path.join(process.cwd(), 'web', 'config.js'), 'utf8');
  if (railway && !railway.includes('CAMBIAR')) assert.ok(web.includes(`"URL_RAILWAY": "${railway}"`), 'web/config.js no tiene la URL de Railway: npm run build:web');
});
