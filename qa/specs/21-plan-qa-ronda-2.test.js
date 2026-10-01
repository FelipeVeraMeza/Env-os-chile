// Casos QA de la segunda ronda del plan (QA-53 a QA-102, docs/18-plan-qa-50-errores.md).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conPagoEnLinea, datosEnvio, envioEnRuta, escenario, formulario, pagarPorTransferencia, pdfPrueba, peticion,
} from '../cliente.js';

let esc;
const crear = (extra = {}, sesion = esc.cliente) => peticion('POST', '/api/envios', { sesion, json: { ...datosEnvio(esc.comuna.id), confirmar: true, ...extra } });

before(async () => { esc = await escenario(); });

test('CP-220 · QA-62 · El resumen del inicio cuenta todos los envíos del cliente (no solo los últimos 100)', async () => {
  const pagado = await crear();
  await pagarPorTransferencia(esc, pagado.datos.id);
  await crear();
  const r = await peticion('GET', '/api/envios/resumen', { sesion: esc.cliente });
  assert.equal(r.status, 200);
  const lista = await peticion('GET', '/api/envios?limite=100', { sesion: esc.cliente });
  assert.equal(r.datos.total, lista.datos.total);
  const pendientes = lista.datos.items.filter((e) => e.estado_pago === 'pendiente' && !['borrador', 'anulado'].includes(e.estado));
  assert.equal(r.datos.por_pagar, pendientes.length);
  assert.equal(r.datos.monto_por_pagar, pendientes.reduce((s, e) => s + e.tarifa_total, 0));
  const otro = await peticion('GET', '/api/envios/resumen', { sesion: esc.clienteB });
  assert.equal(otro.datos.total, 0, 'cada cliente ve solo lo suyo');
});

test('CP-221 · QA-64/QA-72 · Un destinatario anonimizado no aparece en la libreta ni recibe envíos nuevos', async () => {
  const d = await peticion('POST', '/api/destinatarios', { sesion: esc.cliente, json: { nombre: 'QA Para Anonimizar', telefono: '+56 9 2222 3333' } });
  assert.equal(d.status, 201);
  assert.equal((await peticion('POST', `/api/destinatarios/${d.datos.id}/anonimizar`, { sesion: esc.admin })).status, 200);
  const libreta = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  assert.ok(!libreta.datos.some((x) => x.id === d.datos.id));
  const admin = await peticion('GET', `/api/destinatarios?cliente_id=${esc.cliente.usuario.id}&anonimizados=1`, { sesion: esc.admin });
  assert.ok(admin.datos.some((x) => x.id === d.datos.id), 'administración puede consultarlos');
  const envio = await crear({ destinatario_id: d.datos.id, destinatario: undefined });
  assert.equal(envio.status, 409);
});

test('CP-222 · QA-96/QA-97 · No se crean envíos para un cliente desactivado ni destinatarios a nombre de quien no es cliente', async () => {
  const datos = { nombre: 'QA Inactivo', correo: `qa-inactivo-${Date.now()}@qa.test`, rol: 'cliente', password: `Qa.${Date.now()}.x` };
  const u = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: datos });
  assert.equal((await peticion('PATCH', `/api/usuarios/${u.datos.id}`, { sesion: esc.admin, json: { activo: false } })).status, 200);
  const r = await crear({ cliente_id: u.datos.id }, esc.admin);
  assert.equal(r.status, 422);
  const dest = await peticion('POST', '/api/destinatarios', { sesion: esc.admin, json: { cliente_id: esc.repartidor.usuario.id, nombre: 'QA', telefono: '+56 9 2222 3333' } });
  assert.equal(dest.status, 422);
});

test('CP-223 · QA-83/QA-84 · Envíos disponibles: el repartidor no ve a quién entregar hasta que lo toma; nunca el correo', async () => {
  const c = await crear({ destinatario: { nombre: 'QA Privada', telefono: '+56 9 4444 5555', correo: 'privada@qa.test' } });
  await pagarPorTransferencia(esc, c.datos.id);
  const disp = await peticion('GET', '/api/envios/disponibles', { sesion: esc.repartidor });
  const item = disp.datos.items.find((e) => e.id === c.datos.id);
  assert.ok(item, 'aparece como disponible');
  for (const campo of ['destinatario_nombre', 'destinatario_telefono', 'destinatario_correo', 'referencia', 'depto', 'tarifa_total']) assert.equal(item[campo], undefined, campo);
  assert.ok(item.comuna_nombre && item.calle);
  assert.equal((await peticion('POST', `/api/envios/${c.datos.id}/tomar`, { sesion: esc.repartidor })).status, 200);
  const propio = await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.repartidor });
  assert.equal(propio.datos.destinatario_nombre, 'QA Privada');
  assert.equal(propio.datos.destinatario_correo, undefined);
});

test('CP-224 · QA-73 · El seguimiento público no dice si el envío está pagado', async () => {
  const c = await crear();
  const r = await peticion('GET', `/api/seguimiento/${c.datos.folio}`);
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado_pago, undefined);
});

test('CP-225 · QA-74 · El reembolso queda en la bitácora del pago y Cobranza lo descuenta', async () => {
  const c = await crear();
  await pagarPorTransferencia(esc, c.datos.id);
  await peticion('POST', `/api/envios/${c.datos.id}/estado`, { sesion: esc.admin, json: { estado: 'anulado', motivo: 'QA reembolso' } });
  const antes = (await peticion('GET', '/api/cobranza/resumen', { sesion: esc.admin })).datos;
  assert.equal((await peticion('POST', `/api/envios/${c.datos.id}/reembolso`, { sesion: esc.admin, json: { medio: 'transferencia' } })).status, 200);
  const pago = (await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.admin })).datos.pagos.find((p) => p.estado === 'aprobado');
  const eventos = await peticion('GET', `/api/cobranza/pagos/${pago.id}/eventos`, { sesion: esc.admin });
  assert.ok(eventos.datos.some((ev) => ev.tipo === 'reembolso' && ev.monto_informado === c.datos.tarifa_total));
  const despues = (await peticion('GET', '/api/cobranza/resumen', { sesion: esc.admin })).datos;
  assert.equal(despues.reembolsos.monto - antes.reembolsos.monto, c.datos.tarifa_total);
});

test('CP-226 · QA-78 · Una transferencia aprobada no es un "abono por llegar" ni se puede conciliar', async () => {
  const c = await crear();
  const comp = await pagarPorTransferencia(esc, c.datos.id);
  const porConciliar = await peticion('GET', '/api/cobranza/pagos?conciliado=no', { sesion: esc.admin });
  assert.ok(!porConciliar.datos.some((p) => p.id === comp.id));
  const r = await peticion('POST', `/api/cobranza/pagos/${comp.id}/conciliar`, { sesion: esc.admin, json: { monto_abonado: 1000 } });
  assert.equal(r.status, 409);
});

test('CP-227 · QA-86 · Si el envío se paga por otro medio, el cobro en línea abierto se anula', async (t) => {
  await conPagoEnLinea(t, esc, async () => {
    const c = await crear();
    const enLinea = await peticion('POST', `/api/envios/${c.datos.id}/pago`, { sesion: esc.cliente });
    assert.equal(enLinea.status, 201);
    assert.equal((await peticion('POST', `/api/envios/${c.datos.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'efectivo' } })).status, 200);
    const pagos = (await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.admin })).datos.pagos;
    assert.equal(pagos.find((p) => p.id === enLinea.datos.id).estado, 'anulado');
  });
});

test('CP-228 · QA-82 · El CSV escribe el peso con coma decimal (Excel en español)', async () => {
  await crear({ peso_kg: 2.5 });
  const r = await peticion('GET', '/api/envios/exportar.csv', { sesion: esc.cliente, crudo: true });
  assert.match(await r.text(), /"2,5"/);
});

test('CP-229 · QA-85/QA-87/QA-88/QA-89 · Largos máximos y RUT 0-0', async () => {
  assert.equal((await crear({ descripcion_producto: 'x'.repeat(201) })).status, 422);
  assert.equal((await crear({ destinatario: { nombre: 'x'.repeat(121), telefono: '+56 9 2222 3333' } })).status, 422);
  assert.equal((await peticion('POST', '/api/destinatarios', { sesion: esc.cliente, json: { nombre: 'QA', telefono: '+56 9 2222 3333', rut: '0-0' } })).status, 422);
  const e = await envioEnRuta(esc, { valor_declarado: 20000 });
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const rec = await peticion('POST', `/api/reclamos/envio/${e.id}`, {
    sesion: esc.cliente,
    form: formulario({ motivo: 'dano', monto_reclamado: 5000, boleta_numero: '1', boleta_fecha: hoy, boleta_monto: 10000 }, { boleta: [pdfPrueba(), 'b.pdf'] }),
  });
  assert.equal(rec.status, 201);
  const nota = await peticion('POST', `/api/reclamos/${rec.datos.id}/resolver`, { sesion: esc.admin, json: { decision: 'rechazar', nota: 'n'.repeat(501) } });
  assert.equal(nota.status, 422);
});
