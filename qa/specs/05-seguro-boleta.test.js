import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { API, envioEnRuta, escenario, formulario, pdfPrueba, peticion } from '../cliente.js';

let esc;
let envio;
let reclamo;
const hoy = new Date().toISOString().slice(0, 10);
const datosReclamo = (extra = {}) => ({
  motivo: 'dano', descripcion: 'Llegó con la caja rota', monto_reclamado: 40000,
  boleta_numero: '000123', boleta_fecha: hoy, boleta_monto: 45000, ...extra,
});

before(async () => {
  esc = await escenario();
  envio = await envioEnRuta(esc, { valor_declarado: 50000 });
});

const reclamar = (campos, archivo = true, sesion = esc.cliente) => peticion('POST', `/api/reclamos/envio/${envio.id}`, {
  sesion, form: formulario(campos, archivo ? { boleta: [pdfPrueba(), 'boleta.pdf'] } : {}),
});

test('CP-50 · SIN boleta no se puede cobrar el seguro (obligatoria)', async () => {
  const r = await reclamar(datosReclamo(), false);
  assert.equal(r.status, 422);
  assert.match(r.datos.detalles.boleta, /obligatoria/);
});

test('CP-51 · Boleta sin número, fecha o monto es rechazada', async () => {
  const r = await reclamar(datosReclamo({ boleta_numero: '', boleta_fecha: '', boleta_monto: '' }));
  assert.equal(r.status, 422);
  for (const c of ['boleta_numero', 'boleta_fecha', 'boleta_monto']) assert.ok(r.datos.detalles[c], c);
});

test('CP-52 · El monto reclamado no puede superar el valor declarado ni la boleta', async () => {
  const sobreBoleta = await reclamar(datosReclamo({ monto_reclamado: 46000 }));
  assert.equal(sobreBoleta.status, 422);
  const sobreDeclarado = await reclamar(datosReclamo({ monto_reclamado: 55000, boleta_monto: 60000 }));
  assert.equal(sobreDeclarado.status, 422);
});

test('CP-53 · El repartidor no puede crear reclamos', async () => {
  const r = await reclamar(datosReclamo(), true, esc.repartidor);
  assert.equal(r.status, 403);
});

test('CP-54 · Con boleta válida se crea el reclamo SEG-AAAA-NNNNNN', async () => {
  const r = await reclamar(datosReclamo());
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  reclamo = r.datos;
  assert.match(reclamo.numero, /^SEG-\d{4}-\d{6}$/);
  assert.equal(reclamo.estado, 'solicitado');
  assert.ok(reclamo.boleta_adjunto_id);
});

test('CP-55 · No se permite un segundo reclamo activo para el mismo envío', async () => {
  const r = await reclamar(datosReclamo());
  assert.equal(r.status, 409);
});

test('CP-56 · La boleta se puede descargar solo con enlace firmado', async () => {
  const r = await peticion('GET', `/api/reclamos/${reclamo.id}`, { sesion: esc.cliente });
  const archivo = await fetch(`${API}${r.datos.boleta_url}`);
  assert.equal(archivo.status, 200);
  assert.match(archivo.headers.get('content-type'), /pdf/);
});

test('CP-57 · El cliente no puede aprobar su propio reclamo', async () => {
  const r = await peticion('POST', `/api/reclamos/${reclamo.id}/resolver`, { sesion: esc.cliente, json: { decision: 'aprobar', monto_aprobado: 40000 } });
  assert.equal(r.status, 403);
});

test('CP-58 · Administración revisa y aprueba dentro del tope', async () => {
  assert.equal((await peticion('POST', `/api/reclamos/${reclamo.id}/revision`, { sesion: esc.admin })).status, 200);
  const exceso = await peticion('POST', `/api/reclamos/${reclamo.id}/resolver`, { sesion: esc.admin, json: { decision: 'aprobar', monto_aprobado: 40001 } });
  assert.equal(exceso.status, 422);
  const ok = await peticion('POST', `/api/reclamos/${reclamo.id}/resolver`, { sesion: esc.admin, json: { decision: 'aprobar', monto_aprobado: 38000, nota: 'Aprobado con descuento' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.estado, 'aprobado');
});

test('CP-59 · Al pagar la indemnización se registra como costo "seguro"', async () => {
  const r = await peticion('POST', `/api/reclamos/${reclamo.id}/pagar`, { sesion: esc.admin });
  assert.equal(r.status, 200);
  assert.equal(r.datos.estado, 'pagado');
  const costos = await peticion('GET', '/api/costos', { sesion: esc.admin });
  assert.ok(costos.datos.some((c) => c.tipo === 'seguro' && c.reclamo_id === reclamo.id && c.monto === 38000));
});
