// Pedidos del cliente del 01-10: dirección de retiro, paquete con solo dos opciones (estándar / sobredimensionado),
// carrito (un comprobante paga varios envíos) y entrega sin conexión / GPS opcional.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, pagarPorTransferencia, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = async (extra = {}, sesion = esc.cliente) => {
  const r = await peticion('POST', '/api/envios', { sesion, json: { ...datosEnvio(esc.comuna.id, extra), confirmar: true } });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  return r.datos;
};
const sinMedidas = (extra = {}) => ({ peso_kg: undefined, largo_cm: undefined, ancho_cm: undefined, alto_cm: undefined, descripcion_producto: undefined, ...extra });

test('CP-180 · La dirección de retiro es obligatoria, queda en el envío y se recuerda para el próximo', async () => {
  const sin = await peticion('POST', '/api/envios', { sesion: esc.clienteB, json: { ...datosEnvio(esc.comuna.id), retiro: undefined, confirmar: true } });
  assert.equal(sin.status, 422, 'un cliente sin dirección de retiro guardada debe indicarla');
  assert.ok(sin.datos.detalles['retiro.calle']);
  const e = await crear();
  assert.equal(e.retiro_calle, 'Los Leones');
  assert.equal(e.retiro_comuna_nombre, esc.comuna.nombre);
  assert.ok(e.mapas_retiro?.google, 'trae los enlaces de mapa para ir a retirar');
  const guardada = await peticion('GET', '/api/envios/retiro-guardado', { sesion: esc.cliente });
  assert.equal(guardada.datos.calle, 'Los Leones');
  const sinRetiro = await crear({ retiro: undefined });
  assert.equal(sinRetiro.retiro_calle, 'Los Leones', 'si no se indica, usa la guardada');
});

test('CP-181 · El repartidor ve dónde retirar (y no ve montos)', async () => {
  const e = await crear();
  await pagarPorTransferencia(esc, e.id);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } })).status, 200);
  const d = await peticion('GET', `/api/envios/${e.id}`, { sesion: esc.repartidor });
  assert.equal(d.datos.retiro_calle, 'Los Leones');
  assert.ok(d.datos.mapas_retiro.waze);
  assert.equal(d.datos.tarifa_total, undefined);
});

test('CP-182 · Paquete con solo dos opciones: estándar $3.500 y sobredimensionado $5.500, sin peso ni medidas', async () => {
  const est = await crear(sinMedidas({ tamano: 'estandar', bultos: 4 }));
  assert.equal(est.tarifa_total, 3500);
  assert.equal(est.tamano, 'estandar');
  assert.equal(est.peso_kg, null);
  const sob = await crear(sinMedidas({ tamano: 'sobredimensionado' }));
  assert.equal(sob.tarifa_total, 5500);
  assert.equal(sob.recargo_sobredimension, 2000);
  const malo = await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), ...sinMedidas({ tamano: 'gigante' }) } });
  assert.ok(malo.datos.errores.tamano);
  const sinNada = await peticion('POST', '/api/envios/cotizar', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), ...sinMedidas() } });
  assert.ok(sinNada.datos.errores.peso_kg, 'sin tamaño, el peso sigue siendo obligatorio');
  const pdf = await peticion('GET', `/api/envios/${sob.id}/ticket.pdf?formato=a4`, { sesion: esc.admin, crudo: true });
  assert.equal(pdf.status, 200, 'la etiqueta se genera sin peso ni medidas');
});

test('CP-183 · Carrito: un comprobante paga varios envíos; administración los aprueba juntos', async () => {
  const a = await crear();
  const b = await crear(sinMedidas({ tamano: 'sobredimensionado' }));
  const r = await peticion('POST', '/api/envios/comprobante-lote', { sesion: esc.cliente, form: formulario({ envio_ids: `${a.id},${b.id}`, referencia: 'OP-CARRITO' }, { archivo: [jpegPrueba(), 'transferencia.jpg'] }) });
  assert.equal(r.status, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.total, 9000);
  assert.equal(r.datos.pagos.length, 2);
  const lista = (await peticion('GET', '/api/cobranza/comprobantes', { sesion: esc.admin })).datos;
  const fila = lista.find((c) => c.lote === r.datos.lote);
  assert.ok(fila, 'aparece una sola fila por el comprobante del carrito');
  assert.equal(fila.monto, 9000);
  assert.equal(fila.envios.length, 2);
  assert.ok(!fila.usado_en.includes(a.folio) && !fila.usado_en.includes(b.folio), 'los envíos del mismo carrito no se marcan entre sí como comprobante repetido');
  const ok = await peticion('POST', `/api/cobranza/comprobantes/${fila.id}/aprobar`, { sesion: esc.admin });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.envio_ids.length, 2);
  for (const id of [a.id, b.id]) {
    const d = await peticion('GET', `/api/envios/${id}`, { sesion: esc.cliente });
    assert.equal(d.datos.estado_pago, 'pagado');
    assert.ok(d.datos.pagos[0].comprobante?.url, 'cada envío muestra el comprobante del carrito');
  }
});

test('CP-184 · Carrito rechazado: todos sus envíos vuelven a pendiente; no se mezclan clientes', async () => {
  const a = await crear();
  const b = await crear();
  const r = await peticion('POST', '/api/envios/comprobante-lote', { sesion: esc.cliente, form: formulario({ envio_ids: `${a.id},${b.id}` }, { archivo: [jpegPrueba(), 't.jpg'] }) });
  assert.equal(r.status, 201);
  const no = await peticion('POST', `/api/cobranza/comprobantes/${r.datos.pagos[1].id}/rechazar`, { sesion: esc.admin, json: { motivo: 'Falta un envío en el monto' } });
  assert.equal(no.status, 200);
  for (const id of [a.id, b.id]) assert.equal((await peticion('GET', `/api/envios/${id}`, { sesion: esc.cliente })).datos.estado_pago, 'pendiente');
  const otro = await crear({}, esc.clienteB);
  const mezcla = await peticion('POST', '/api/envios/comprobante-lote', { sesion: esc.cliente, form: formulario({ envio_ids: `${a.id},${otro.id}` }, { archivo: [jpegPrueba(), 't.jpg'] }) });
  assert.equal(mezcla.status, 404, 'no se pueden pagar envíos de otro cliente');
  assert.equal((await peticion('GET', `/api/envios/${a.id}`, { sesion: esc.cliente })).datos.estado_pago, 'pendiente', 'no quedó nada a medias');
});

test('CP-185 · Entrega sin GPS y registrada sin conexión: guarda la hora real en que se entregó', async () => {
  const conf = (await peticion('GET', '/api/config/publica')).datos.operacion;
  assert.equal(conf.gps_obligatorio, false, 'el GPS es opcional');
  const e = await crear();
  await pagarPorTransferencia(esc, e.id);
  await peticion('POST', `/api/envios/${e.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } })).status, 200);
  const hace = new Date(Date.now() - 2 * 3600_000).toISOString();
  const r = await peticion('POST', `/api/envios/${e.id}/entregar`, { sesion: esc.repartidor, form: formulario({ hora_entrega: hace, receptor: 'Vecina' }, { foto: [jpegPrueba(), 'e.jpg'] }) });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.equal(new Date(r.datos.entregado_en).toISOString(), hace, 'se respeta la hora en que se entregó sin señal');
  assert.equal(r.datos.entrega_lat, null);
  const dos = await peticion('POST', `/api/envios/${e.id}/entregar`, { sesion: esc.repartidor, form: formulario({}, { foto: [jpegPrueba(), 'e.jpg'] }) });
  assert.equal(dos.status, 409, 'reenviar la misma entrega no la duplica');
});
