// Casos QA de las correcciones del plan de 50 errores (docs/18-plan-qa-50-errores.md).
// Cada caso indica el o los errores (QA-NN) que protege para que no vuelvan a aparecer.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API, datosEnvio, envioEnRuta, escenario, formulario, jpegPrueba, pagarPorTransferencia, pdfPrueba, peticion,
} from '../cliente.js';

let esc;
const sufijo = Date.now().toString(36);
const crear = (extra = {}, sesion = esc.cliente) => peticion('POST', '/api/envios', { sesion, json: { ...datosEnvio(esc.comuna.id), confirmar: true, ...extra } });
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

before(async () => { esc = await escenario(); });

test('CP-200 · QA-01/QA-49 · El repartidor no ve el recargo por sobredimensión ni puede cotizar o consultar pagos', async () => {
  const e = await envioEnRuta(esc, { peso_kg: 15 });
  const vista = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor });
  assert.equal(vista.status, 200);
  for (const campo of ['recargo_sobredimension', 'tarifa_total', 'tarifa_base', 'valor_declarado', 'pago_referencia']) {
    assert.equal(vista.datos[campo], undefined, campo);
  }
  const admin = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.admin });
  assert.equal(admin.datos.recargo_sobredimension, 2000, 'administración sí lo ve');
  assert.equal((await peticion('POST', '/api/envios/cotizar', { sesion: esc.repartidor, json: datosEnvio(esc.comuna.id) })).status, 403);
  assert.equal((await peticion('GET', '/api/pagos/cualquier-token', { sesion: esc.repartidor })).status, 403);
});

test('CP-201 · QA-03 · La configuración no acepta claves heredadas (constructor, __proto__, toString)', async () => {
  for (const clave of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.equal((await peticion('PUT', `/api/config/${clave}`, { sesion: esc.admin, json: {} })).status, 404, clave);
  }
  const r = await peticion('PUT', '/api/config/ticket', { sesion: esc.admin, json: { constructor: 'x', toString: 'y' } });
  assert.equal(r.status, 200);
  assert.ok(!Object.hasOwn(r.datos, 'constructor') && !Object.hasOwn(r.datos, 'toString'));
});

test('CP-202 · QA-11/QA-12 · Un número vacío en Ajustes no se guarda como 0 y la tarifa estándar no puede ser $0', async () => {
  const vacio = await peticion('PUT', '/api/config/tarifas', { sesion: esc.admin, json: { recargo_horario_especial: '' } });
  assert.equal(vacio.status, 422);
  assert.ok(vacio.datos.detalles.recargo_horario_especial);
  const cero = await peticion('PUT', '/api/config/tarifas', { sesion: esc.admin, json: { base: 0 } });
  assert.equal(cero.status, 422);
  assert.ok(cero.datos.detalles.base);
  const op = await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { intentos_max: '' } });
  assert.equal(op.status, 422);
});

test('CP-203 · QA-09 · Cambiar la tarifa estándar en Ajustes cambia lo que se cobra en las comunas en cobertura', async () => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.tarifas.base;
  const cotizar = async () => (await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: datosEnvio(esc.comuna.id) })).datos.tarifa_base;
  const original = await cotizar();
  if (original !== antes) return; // la comuna tiene una tarifa propia o de otra zona: no aplica
  try {
    assert.equal((await peticion('PUT', '/api/config/tarifas', { sesion: esc.admin, json: { base: antes + 100 } })).status, 200);
    assert.equal(await cotizar(), antes + 100);
  } finally {
    await peticion('PUT', '/api/config/tarifas', { sesion: esc.admin, json: { base: antes } });
  }
  assert.equal(await cotizar(), antes);
});

test('CP-204 · QA-37/QA-38 · Datos del negocio y pie del ticket se validan', async () => {
  const sinNombre = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { nombre: '   ' } });
  assert.equal(sinNombre.status, 422);
  const correo = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { correo: 'no-es-correo' } });
  assert.equal(correo.status, 422);
  const rut = await peticion('PUT', '/api/config/negocio', { sesion: esc.admin, json: { rut: '11.111.111-2' } });
  assert.equal(rut.status, 422);
  const pie = await peticion('PUT', '/api/config/ticket', { sesion: esc.admin, json: { pie: 'x'.repeat(201) } });
  assert.equal(pie.status, 422);
});

test('CP-205 · QA-13/QA-14/QA-15 · Zonas: tarifa vacía no es $0, nombre obligatorio y sin error 500', async () => {
  assert.equal((await peticion('POST', '/api/zonas', { sesion: esc.admin, json: { nombre: `QA zona ${sufijo}`, tarifa: '' } })).status, 422);
  assert.equal((await peticion('POST', '/api/zonas', { sesion: esc.admin, json: { nombre: '', tarifa: 3000 } })).status, 422);
  assert.equal((await peticion('POST', '/api/zonas', { sesion: esc.admin, json: { nombre: `QA zona ${sufijo}`, tarifa: 20_000_000 } })).status, 422);
  const num = await peticion('POST', '/api/zonas', { sesion: esc.admin, json: { nombre: 12345 + Number(Date.now() % 1000), tarifa: 3000 } });
  assert.equal(num.status, 201, 'un nombre numérico se guarda como texto (antes: error 500)');
  assert.equal((await peticion('PATCH', `/api/zonas/${num.datos.id}`, { sesion: esc.admin, json: { tarifa: null } })).status, 422);
  assert.equal((await peticion('PATCH', `/api/zonas/${num.datos.id}`, { sesion: esc.admin, json: { nombre: '  ' } })).status, 422);
  const ok = await peticion('PATCH', `/api/zonas/${num.datos.id}`, { sesion: esc.admin, json: { tarifa: 4000 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.datos.tarifa, 4000);
});

test('CP-206 · QA-06 · Buscar "%" o "_" no devuelve todos los envíos', async () => {
  assert.equal((await crear()).status, 201);
  const todos = await peticion('GET', '/api/envios', { sesion: esc.cliente });
  assert.ok(todos.datos.total > 0);
  for (const q of ['%', '_', '%%']) {
    const r = await peticion('GET', `/api/envios?q=${encodeURIComponent(q)}`, { sesion: esc.cliente });
    assert.equal(r.status, 200);
    assert.equal(r.datos.total, 0, q);
  }
  const comunas = await peticion('GET', '/api/comunas?q=%25');
  assert.equal(comunas.datos.length, 0);
});

test('CP-207 · QA-23/QA-24/QA-10 · confirmar:"false" no confirma, coordenadas fuera de rango y peso redondeado', async () => {
  const borrador = await crear({ confirmar: 'false' });
  assert.equal(borrador.status, 201);
  assert.equal(borrador.datos.estado, 'borrador');
  assert.equal(borrador.datos.folio, null);

  const malas = await crear({ direccion: { ...datosEnvio(esc.comuna.id).direccion, lat: 999, lon: -70.6 } });
  assert.equal(malas.status, 422);
  const buenas = await crear({ direccion: { ...datosEnvio(esc.comuna.id).direccion, lat: '-33.43', lon: '-70.61' } });
  assert.equal(buenas.status, 201);
  assert.equal(buenas.datos.lat, -33.43);

  // 10,004 kg se guarda como 10,00 kg: se cobra como paquete estándar (sin recargo), igual a lo guardado.
  const peso = await crear({ peso_kg: 10.004 });
  assert.equal(peso.status, 201);
  assert.equal(peso.datos.peso_kg, 10);
  assert.equal(peso.datos.recargo_sobredimension, 0);
});

let entregado;
test('CP-208 · QA-25/QA-26 · La entrega rechaza una precisión GPS inválida y limpia el nombre de quien recibe', async () => {
  const e = await envioEnRuta(esc);
  const foto = () => ({ foto: [jpegPrueba(), 'entrega.jpg'] });
  const mala = await peticion('POST', `/api/envios/${e.id}/entregar`, { sesion: esc.repartidor, form: formulario({ lat: -33.43, lon: -70.61, precision: 'abc' }, foto()) });
  assert.equal(mala.status, 422);
  const ok = await peticion('POST', `/api/envios/${e.id}/entregar`, {
    sesion: esc.repartidor, form: formulario({ lat: -33.43, lon: -70.61, precision: 12, receptor: `   Juan Pérez ${'x'.repeat(300)}` }, foto()),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.entrega_precision_m, 12);
  assert.ok(ok.datos.entrega_receptor.startsWith('Juan Pérez'));
  assert.ok(ok.datos.entrega_receptor.length <= 120);
  entregado = ok.datos;
});

test('CP-209 · QA-27/QA-28 · Reasignar limpia el orden de ruta y no se ordenan envíos ya cerrados', async () => {
  const c = await crear();
  await pagarPorTransferencia(esc, c.datos.id);
  await peticion('POST', `/api/envios/${c.datos.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal((await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.repartidor, json: { ids: [c.datos.id] } })).status, 200);
  assert.equal((await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.admin })).datos.orden_ruta, 1);
  const re = await peticion('POST', `/api/envios/${c.datos.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidorB.usuario.id } });
  assert.equal(re.status, 200);
  assert.equal(re.datos.orden_ruta, null, 'el nuevo repartidor no hereda la posición del anterior');

  const cerrado = await peticion('PUT', '/api/envios/ruta/orden', { sesion: esc.repartidor, json: { ids: [entregado.id] } });
  assert.equal(cerrado.status, 403);
});

test('CP-210 · QA-16/QA-17 · Seguro: no antes del retiro; RUT del emisor validado y normalizado', async () => {
  const c = await crear();
  await pagarPorTransferencia(esc, c.datos.id);
  const hoy = hoyChile();
  const datos = { motivo: 'perdida', monto_reclamado: 10000, boleta_numero: '77', boleta_fecha: hoy, boleta_monto: 20000 };
  const reclamar = (id, extra = {}) => peticion('POST', `/api/reclamos/envio/${id}`, {
    sesion: esc.cliente, form: formulario({ ...datos, ...extra }, { boleta: [pdfPrueba(), 'boleta.pdf'] }),
  });
  const antes = await reclamar(c.datos.id);
  assert.equal(antes.status, 409);
  assert.match(antes.datos.error, /retirado/);

  const rutMalo = await reclamar(entregado.id, { boleta_emisor_rut: '11.111.111-2' });
  assert.equal(rutMalo.status, 422);
  assert.ok(rutMalo.datos.detalles.boleta_emisor_rut);
  const ok = await reclamar(entregado.id, { boleta_emisor_rut: '111111111' });
  assert.equal(ok.status, 201, JSON.stringify(ok.datos));
  assert.equal(ok.datos.boleta_emisor_rut, '11.111.111-1');
});

test('CP-211 · QA-21/QA-22 · Reembolso con monto vacío devuelve el total; referencia del pago manual acotada', async () => {
  const c = await crear();
  const manual = await peticion('POST', `/api/envios/${c.datos.id}/pago-manual`, { sesion: esc.admin, json: { medio: 'efectivo', referencia: `  ${'R'.repeat(200)}  ` } });
  assert.equal(manual.status, 200);
  assert.equal(manual.datos.pago_referencia.length, 60);
  const anular = await peticion('POST', `/api/envios/${c.datos.id}/estado`, { sesion: esc.admin, json: { estado: 'anulado', motivo: 'Cliente desiste' } });
  assert.equal(anular.status, 200);
  const r = await peticion('POST', `/api/envios/${c.datos.id}/reembolso`, { sesion: esc.admin, json: { monto: '', medio: 'transferencia', nota: 'n'.repeat(500) } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.reembolso_monto, c.datos.tarifa_total);
  assert.equal(r.datos.reembolso_nota.length, 300);
});

test('CP-212 · QA-19/QA-20/QA-18 · Fechas imposibles, rangos invertidos y costos con fecha futura', async () => {
  assert.equal((await peticion('GET', '/api/reportes/ganancias?desde=2026-02-31', { sesion: esc.admin })).status, 400);
  assert.equal((await peticion('GET', '/api/reportes/ganancias?desde=2026-09-10&hasta=2026-09-01', { sesion: esc.admin })).status, 400);
  assert.equal((await peticion('GET', '/api/cobranza/resumen?hasta=2026-13-01', { sesion: esc.admin })).status, 400);
  assert.equal((await peticion('GET', '/api/envios?desde=2026-02-30', { sesion: esc.admin })).status, 400);
  const futuro = await peticion('POST', '/api/costos', { sesion: esc.admin, json: { tipo: 'bencina', monto: 1000, fecha: '2999-01-01' } });
  assert.equal(futuro.status, 422);
  assert.equal((await peticion('POST', '/api/costos', { sesion: esc.admin, json: { tipo: 'bencina', monto: 1000, fecha: '2026-02-31' } })).status, 422);
  const g = await peticion('GET', '/api/reportes/ganancias', { sesion: esc.admin });
  assert.equal(g.status, 200);
  for (const fila of g.datos.por_repartidor) assert.ok(Number.isInteger(fila.repartidor_id), 'se agrupa por persona, no por nombre');
});

test('CP-213 · QA-31/QA-32/QA-33 · Usuarios: correo duplicado con espacios o mayúsculas, nombre largo y "activo" como texto', async () => {
  const correo = `qa-dup-${sufijo}@qa.test`;
  const base = { nombre: 'QA Duplicado', rol: 'cliente', password: `Qa.${sufijo}.2026x` };
  assert.equal((await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { ...base, correo } })).status, 201);
  const dup = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { ...base, correo: `  ${correo.toUpperCase()}  ` } });
  assert.equal(dup.status, 409);
  assert.equal(dup.datos.detalles.correo, 'Duplicado');
  const noTexto = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { ...base, correo: [correo] } });
  assert.equal(noTexto.status, 422, 'un correo que no es texto no provoca error 500');
  const largo = await peticion('POST', '/api/usuarios', { sesion: esc.admin, json: { ...base, nombre: 'N'.repeat(121), correo: `qa-largo-${sufijo}@qa.test` } });
  assert.equal(largo.status, 422);
  const activo = await peticion('PATCH', `/api/usuarios/${esc.clienteB.usuario.id}`, { sesion: esc.admin, json: { activo: 'false' } });
  assert.equal(activo.status, 422, '"false" como texto no se interpreta como verdadero');
});

test('CP-214 · QA-35/QA-36/QA-47 · Libreta: primera dirección principal, desactivar la principal y titular anonimizado', async () => {
  const d = await peticion('POST', '/api/destinatarios', { sesion: esc.cliente, json: { nombre: 'QA Libreta', telefono: '+56 9 1234 5678' } });
  assert.equal(d.status, 201);
  const dir = (extra = {}) => peticion('POST', `/api/destinatarios/${d.datos.id}/direcciones`, {
    sesion: esc.cliente, json: { calle: 'Los Aromos', numero: '10', comuna_id: esc.comuna.id, ...extra },
  });
  const primera = await dir({ es_principal: 'false' });
  assert.equal(primera.status, 201);
  assert.equal(primera.datos.es_principal, true, 'la primera dirección queda como principal');
  const segunda = await dir({ es_principal: 'false' });
  assert.equal(segunda.datos.es_principal, false, '"false" (texto) no la marca como principal');
  const off = await peticion('PATCH', `/api/destinatarios/${d.datos.id}/direcciones/${primera.datos.id}`, { sesion: esc.cliente, json: { activa: false } });
  assert.equal(off.status, 200);
  const libreta = await peticion('GET', '/api/destinatarios', { sesion: esc.cliente });
  const dest = libreta.datos.find((x) => x.id === d.datos.id);
  assert.deepEqual(dest.direcciones.map((x) => [x.id, x.es_principal]), [[segunda.datos.id, true]]);

  assert.equal((await peticion('POST', `/api/destinatarios/${d.datos.id}/anonimizar`, { sesion: esc.admin })).status, 200);
  assert.equal((await peticion('PATCH', `/api/destinatarios/${d.datos.id}`, { sesion: esc.admin, json: { nombre: 'Vuelve a identificarse' } })).status, 409);
  assert.equal((await dir()).status, 409);
});

test('CP-215 · QA-29 · Un folio de 7 dígitos se puede consultar (responde "no encontrado", no "formato inválido")', async () => {
  const r = await peticion('GET', '/api/seguimiento/ENV-2026-1000001');
  assert.equal(r.status, 404);
});

test('CP-216 · QA-48 · El QR de un envío a punto courier muestra la página con el punto (no lleva a la casa)', async (t) => {
  const antes = (await peticion('GET', '/api/config/publica')).datos.operacion.punto_courier;
  if (!antes && (await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: true } })).status !== 200) return t.skip('no se pudo activar');
  try {
    const c = await crear({ tipo_destino: 'punto_courier', courier_empresa: 'Starken', courier_punto: 'Sucursal Providencia' });
    assert.equal(c.status, 201, JSON.stringify(c.datos));
    const r = await fetch(c.datos.qr_url.replace(/^https?:\/\/[^/]+/, API), { redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Sucursal Providencia/);
    const domicilio = await crear();
    const r2 = await fetch(domicilio.datos.qr_url.replace(/^https?:\/\/[^/]+/, API), { redirect: 'manual' });
    assert.ok([200, 302].includes(r2.status));
  } finally {
    if (!antes) await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { punto_courier: false } });
  }
});

test('CP-217 · QA-43/QA-07 · Máximo de adjuntos por envío y nombre de archivo con tildes bien descargado', async () => {
  const c = await crear();
  const subir = () => peticion('POST', `/api/envios/${c.datos.id}/adjuntos`, { sesion: esc.cliente, form: formulario({ tipo: 'foto_paquete' }, { archivo: [jpegPrueba(), 'cañón ñandú.jpg'] }) });
  for (let i = 0; i < 20; i++) assert.equal((await subir()).status, 201);
  assert.equal((await subir()).status, 409);
  const det = await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.cliente });
  const arch = await fetch(`${API}${det.datos.adjuntos[0].url}`);
  assert.equal(arch.status, 200);
  const disp = arch.headers.get('content-disposition');
  assert.match(disp, /filename\*=UTF-8''ca%C3%B1%C3%B3n%20%C3%B1and%C3%BA\.jpg/);
  assert.match(disp, /filename="canon nandu\.jpg"/);
});

test('CP-218 · QA-30/QA-42 · CSV con el estado de pago legible y cabeceras expuestas para la interfaz en otro dominio', async () => {
  const r = await peticion('GET', '/api/envios/exportar.csv', { sesion: esc.cliente, crudo: true });
  assert.equal(r.status, 200);
  const texto = await r.text();
  assert.match(texto, /"(Pendiente|Pagado|En revisión|Reembolsado)"/);
  assert.doesNotMatch(texto, /"en_revision"|"pendiente"/);
  const cors = await fetch(`${API}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.match(cors.headers.get('access-control-expose-headers') || '', /Content-Disposition/);
});
