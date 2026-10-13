// Pedidos 11-10 (bolsas de envío por color y medida, en pausa desde el 12-10), 12-10 (aviso por correo al destinatario
// con el seguimiento) y 12-10 (borrar contactos de Guardados).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
let correoActivo;
let bolsasAntes;
before(async () => {
  esc = await escenario();
  const conf = (await peticion('GET', '/api/config/publica')).datos;
  correoActivo = conf.recuperacion_por_correo;
  bolsasAntes = conf.operacion.bolsas;
});
// La sección de bolsas queda como estaba (en pausa por defecto).
after(async () => { await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { bolsas: bolsasAntes } }); });
const activarBolsas = (activa) => peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { bolsas: activa } });

test('CP-289 · En pausa, el cliente no entra a Bolsas; administración sí (para dejar listos los precios)', async () => {
  await activarBolsas(false);
  const r = await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente });
  assert.equal(r.status, 404);
  assert.match(r.datos.error, /aún no está disponible/);
  assert.equal((await peticion('GET', '/api/bolsas/catalogo?todos=1', { sesion: esc.admin })).status, 200);
  await activarBolsas(true);
  assert.equal((await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente })).status, 200);
});

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('CP-290 · El cliente ve las bolsas fucsia con su precio (sin el costo); administración ve el costo', async () => {
  const cat = await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente });
  assert.equal(cat.status, 200);
  const fucsia = cat.datos.filter((p) => p.color === 'Fucsia');
  for (const medida of ['17x30', '20x30', '25x35', '30x42', '35x45', '40x55', '45x60', '60x80']) assert.ok(fucsia.some((p) => p.medida === medida), medida);
  assert.ok(cat.datos.every((p) => !('costo' in p)), 'el cliente no ve el costo');
  const adm = await peticion('GET', '/api/bolsas/catalogo?todos=1', { sesion: esc.admin });
  assert.ok(adm.datos.some((p) => p.costo != null));
  assert.equal((await peticion('GET', '/api/bolsas/catalogo')).status, 401, 'sin sesión no');
  assert.equal((await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.repartidor })).status, 200);
  assert.equal((await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.repartidor, json: {} })).status, 403);
});

test('CP-291 · Administración agrega un color nuevo, cambia precios y oculta una medida', async () => {
  const color = `Qa${Date.now() % 100000}`;
  const malo = await peticion('POST', '/api/bolsas/catalogo', { sesion: esc.admin, json: { color, medida: 'grande', precio: 0 } });
  assert.equal(malo.status, 422);
  assert.ok(malo.datos.detalles.medida && malo.datos.detalles.precio);
  assert.equal((await peticion('POST', '/api/bolsas/catalogo', { sesion: esc.cliente, json: { color, medida: '17x30', precio: 1000 } })).status, 403);

  const n = await peticion('POST', '/api/bolsas/catalogo', { sesion: esc.admin, json: { color, medida: '17 x 30', costo: 2000, precio: '4000' } });
  assert.equal(n.status, 201, JSON.stringify(n.datos));
  assert.equal(n.datos.medida, '17x30');
  assert.equal(n.datos.unidades, 100);
  assert.equal((await peticion('POST', '/api/bolsas/catalogo', { sesion: esc.admin, json: { color, medida: '17x30', precio: 4000 } })).status, 409, 'repetida');

  const p = await peticion('PATCH', `/api/bolsas/catalogo/${n.datos.id}`, { sesion: esc.admin, json: { precio: 4500 } });
  assert.equal(p.datos.precio, 4500);
  assert.equal((await peticion('PATCH', `/api/bolsas/catalogo/${n.datos.id}`, { sesion: esc.admin, json: { precio: '' } })).status, 422, 'vacío no es $0');
  await peticion('PATCH', `/api/bolsas/catalogo/${n.datos.id}`, { sesion: esc.admin, json: { activo: false } });
  assert.ok(!(await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente })).datos.some((x) => x.id === n.datos.id), 'oculta para el cliente');
  const r = await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { items: [{ bolsa_id: n.datos.id, cantidad: 1 }], entrega_direccion: 'Los Leones 500', entrega_comuna_id: esc.comuna.id } });
  assert.equal(r.status, 422, 'no se puede pedir una bolsa oculta');
});

test('CP-292 · Pedido de bolsas: total con el precio del catálogo, comprobante, rechazo, aprobación y entrega', async () => {
  const cat = (await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente })).datos.filter((p) => p.color === 'Fucsia');
  const [chica, grande] = [cat.find((p) => p.medida === '17x30'), cat.find((p) => p.medida === '45x60')];
  const base = { entrega_direccion: 'Los Leones 500, local 2', entrega_comuna_id: esc.comuna.id };
  const vacio = await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { ...base, items: [] } });
  assert.equal(vacio.status, 422);
  assert.equal((await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { ...base, items: [{ bolsa_id: chica.id, cantidad: 101 }] } })).status, 422);

  const r = await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { ...base, items: [{ bolsa_id: chica.id, cantidad: 2, precio_unitario: 1 }, { bolsa_id: grande.id, cantidad: 1 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  const p = r.datos;
  assert.match(p.folio, /^BOL-\d{4}-\d{6}$/);
  assert.equal(p.estado, 'pendiente');
  assert.equal(p.total, chica.precio * 2 + grande.precio, 'el precio lo pone el servidor');
  assert.equal(p.items.length, 2);

  // Otro cliente no lo ve ni lo puede pagar; el pago manda: no se entrega sin pago aprobado.
  assert.ok(!(await peticion('GET', '/api/bolsas/pedidos', { sesion: esc.clienteB })).datos.some((x) => x.id === p.id));
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.clienteB, form: formulario({}, { archivo: [jpegPrueba(), 'c.jpg'] }) })).status, 404);
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/entregar`, { sesion: esc.admin })).status, 409);
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.cliente, form: formulario({}) })).status, 422, 'sin archivo');

  const sub = await peticion('POST', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.cliente, form: formulario({ referencia: 'OP-123' }, { archivo: [jpegPrueba(), 'comprobante.jpg'] }) });
  assert.equal(sub.status, 201, JSON.stringify(sub.datos));
  assert.equal(sub.datos.estado, 'en_revision');
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/anular`, { sesion: esc.cliente })).status, 409, 'con pago en revisión el cliente no anula');
  const archivo = await peticion('GET', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.admin, crudo: true });
  assert.equal(archivo.status, 200);
  assert.equal(archivo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await peticion('GET', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.clienteB })).status, 404);

  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/rechazar`, { sesion: esc.admin, json: { motivo: '' } })).status, 422);
  const rech = await peticion('POST', `/api/bolsas/pedidos/${p.id}/rechazar`, { sesion: esc.admin, json: { motivo: 'El monto no coincide' } });
  assert.equal(rech.datos.estado, 'pendiente');
  assert.equal(rech.datos.motivo_rechazo, 'El monto no coincide');

  await peticion('POST', `/api/bolsas/pedidos/${p.id}/comprobante`, { sesion: esc.cliente, form: formulario({}, { archivo: [jpegPrueba(), 'otro.jpg'] }) });
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/aprobar`, { sesion: esc.cliente })).status, 403);
  const ok = await peticion('POST', `/api/bolsas/pedidos/${p.id}/aprobar`, { sesion: esc.admin });
  assert.equal(ok.datos.estado, 'pagado');
  assert.equal(ok.datos.motivo_rechazo, null);
  assert.ok((await peticion('GET', '/api/bolsas/pedidos/abiertos', { sesion: esc.admin })).datos.abiertos >= 1);
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/entregar`, { sesion: esc.admin })).datos.estado, 'entregado');
  assert.equal((await peticion('POST', `/api/bolsas/pedidos/${p.id}/anular`, { sesion: esc.admin })).status, 409, 'entregado no se anula');
});

test('CP-293 · El cliente anula su pedido sin pagar; una comuna fuera de cobertura no se acepta', async () => {
  const [b] = (await peticion('GET', '/api/bolsas/catalogo', { sesion: esc.cliente })).datos;
  const fuera = (await peticion('GET', '/api/comunas')).datos.find((c) => !c.en_cobertura);
  const malo = await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { items: [{ bolsa_id: b.id, cantidad: 1 }], entrega_direccion: 'x', entrega_comuna_id: fuera.id } });
  assert.equal(malo.status, 422);
  assert.ok(malo.datos.detalles.entrega_direccion && malo.datos.detalles.entrega_comuna_id);

  const p = (await peticion('POST', '/api/bolsas/pedidos', { sesion: esc.cliente, json: { items: [{ bolsa_id: b.id, cantidad: 1 }], entrega_direccion: 'Los Leones 500', entrega_comuna_id: esc.comuna.id } })).datos;
  const an = await peticion('POST', `/api/bolsas/pedidos/${p.id}/anular`, { sesion: esc.cliente });
  assert.equal(an.status, 200);
  assert.equal(an.datos.estado, 'anulado');
  assert.equal(an.datos.motivo_anulacion, 'Anulado por el cliente');
});

test('CP-294 · El correo del destinatario se guarda al crear el envío y se le avisa con el enlace de seguimiento', async () => {
  const correo = `destinatario-${Date.now()}@qa.test`;
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Destinatario Correo QA', telefono: '+56 9 5555 1212', correo } }), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  assert.equal(c.datos.destinatario_correo, correo);
  assert.equal(c.datos.aviso_destinatario, correoActivo, 'avisa solo si hay correo configurado');
  if (correoActivo) {
    await esperar(1500);
    assert.ok((await peticion('GET', `/api/envios/${c.datos.id}`, { sesion: esc.cliente })).datos.aviso_destinatario_en, 'queda marcado como avisado');
  }

  // Sin correo no hay aviso; el borrador (sin folio) tampoco avisa.
  const sin = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Sin Correo QA', telefono: '+56 9 5555 3434' } }), confirmar: true } });
  assert.equal(sin.datos.aviso_destinatario, false);
  const borrador = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Borrador QA', telefono: '+56 9 5555 5656', correo } }) });
  assert.equal(borrador.datos.aviso_destinatario, false);
  const conf = await peticion('POST', `/api/envios/${borrador.datos.id}/confirmar`, { sesion: esc.cliente });
  assert.equal(conf.datos.aviso_destinatario, correoActivo, 'al confirmar el borrador sí avisa');

  // Destinatario de Guardados sin correo: se completa al crear el envío; un correo inválido se rechaza.
  const dest = sin.datos.destinatario_id;
  const invalido = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), destinatario: undefined, destinatario_id: dest, destinatario_correo: 'no-es-correo' } });
  assert.equal(invalido.status, 422);
  assert.ok(invalido.datos.detalles.destinatario_correo);
  const otro = `guardado-${Date.now()}@qa.test`;
  const g = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), destinatario: undefined, destinatario_id: dest, destinatario_correo: otro } });
  assert.equal(g.status, 201, JSON.stringify(g.datos));
  assert.equal(g.datos.destinatario_correo, otro);
  assert.equal((await peticion('GET', '/api/destinatarios', { sesion: esc.cliente })).datos.find((d) => d.id === dest).correo, otro);
});

test('CP-295 · Administración puede apagar el aviso al destinatario', async () => {
  try {
    assert.equal((await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { aviso_destinatario: false } })).status, 200);
    const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Apagado QA', telefono: '+56 9 5555 7878', correo: 'apagado@qa.test' } }), confirmar: true } });
    assert.equal(c.datos.aviso_destinatario, false);
  } finally {
    await peticion('PUT', '/api/config/operacion', { sesion: esc.admin, json: { aviso_destinatario: true } });
  }
});

test('CP-296 · El cliente borra contactos de Guardados: sin envíos se borra, con envíos se oculta y sus envíos siguen', async () => {
  const sinEnvios = await peticion('POST', '/api/destinatarios', { sesion: esc.cliente, json: { nombre: 'Borrar QA', telefono: '+56 9 4444 1111' } });
  assert.equal(sinEnvios.status, 201);
  assert.equal((await peticion('DELETE', `/api/destinatarios/${sinEnvios.datos.id}`, { sesion: esc.clienteB })).status, 404, 'otro cliente no lo borra');
  const b1 = await peticion('DELETE', `/api/destinatarios/${sinEnvios.datos.id}`, { sesion: esc.cliente });
  assert.equal(b1.status, 200);
  assert.equal(b1.datos.borrado, true);

  const e = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Ocultar QA', telefono: '+56 9 4444 2222' } }), confirmar: true } });
  const dest = e.datos.destinatario_id;
  const b2 = await peticion('DELETE', `/api/destinatarios/${dest}`, { sesion: esc.cliente });
  assert.equal(b2.datos.borrado, false, 'con envíos se oculta');
  assert.ok(!(await peticion('GET', '/api/destinatarios', { sesion: esc.cliente })).datos.some((d) => d.id === dest), 'ya no aparece en Guardados');
  const envio = await peticion('GET', `/api/envios/${e.datos.id}`, { sesion: esc.cliente });
  assert.equal(envio.status, 200);
  assert.equal(envio.datos.destinatario_nombre, 'Ocultar QA', 'el envío anterior no cambia');
  assert.equal((await peticion('GET', `/api/seguimiento/${e.datos.folio}`)).status, 200);
  assert.equal((await peticion('DELETE', `/api/destinatarios/${dest}`, { sesion: esc.cliente })).status, 404, 'ya borrado');
  assert.equal((await peticion('PATCH', `/api/destinatarios/${dest}`, { sesion: esc.cliente, json: { nombre: 'Otro' } })).status, 404);

  // No se le puede enviar desde Guardados; si se escribe de nuevo, queda como un contacto nuevo.
  assert.equal((await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), destinatario: undefined, destinatario_id: dest } })).status, 422);
  const de_nuevo = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, { destinatario: { nombre: 'Ocultar QA', telefono: '+56 9 4444 2222' } }), confirmar: true } });
  assert.equal(de_nuevo.status, 201);
  assert.notEqual(de_nuevo.datos.destinatario_id, dest);
  assert.ok((await peticion('GET', '/api/destinatarios', { sesion: esc.cliente })).datos.some((d) => d.id === de_nuevo.datos.destinatario_id));
});
