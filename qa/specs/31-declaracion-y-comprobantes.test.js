// Pedidos del 15-10: "¿Qué envías?" obligatorio, declaración obligatoria de no enviar mercancías peligrosas y
// comprobantes que pagan varios envíos (se revisan con todos sus envíos, el precio de cada uno y el total).
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { datosEnvio, escenario, formulario, jpegPrueba, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const crear = (extra = {}) => peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, extra), confirmar: true } });

test('CP-310 · "¿Qué envías?" es obligatorio, también con tamaño declarado', async () => {
  for (const descripcion_producto of [undefined, '', '   ']) {
    const r = await crear({ descripcion_producto, tamano: 'estandar', peso_kg: undefined, largo_cm: undefined, ancho_cm: undefined, alto_cm: undefined });
    assert.equal(r.status, 422, JSON.stringify(r.datos));
    assert.ok(r.datos.detalles.descripcion_producto, 'marca el campo de la descripción');
  }
});

test('CP-311 · Sin la declaración de mercancías peligrosas no se crea el envío; con ella queda registrada', async () => {
  for (const declara_sin_peligrosas of [undefined, false, 'false', 'si']) {
    const r = await crear({ declara_sin_peligrosas });
    assert.equal(r.status, 422, `declara_sin_peligrosas=${declara_sin_peligrosas} no debe aceptarse`);
    assert.ok(r.datos.detalles.declara_sin_peligrosas);
  }
  const ok = await crear();
  assert.equal(ok.status, 201, JSON.stringify(ok.datos));
  assert.ok(ok.datos.declara_sin_peligrosas_en, 'queda la fecha de la declaración');
});

test('CP-312 · Un comprobante que paga varios envíos se revisa con todos: precio de cada uno y total', async () => {
  const envios = [];
  // Uno sobredimensionado: los precios no son todos iguales.
  for (const tamano of ['estandar', 'sobredimensionado', 'estandar']) {
    const r = await crear({ tamano });
    assert.equal(r.status, 201, JSON.stringify(r.datos));
    envios.push(r.datos);
  }
  const lote = await peticion('POST', '/api/envios/comprobante-lote', {
    sesion: esc.cliente, form: formulario({ envio_ids: envios.map((e) => e.id).join(','), referencia: 'OP-15-10' }, { archivo: [jpegPrueba(), 'transferencia.jpg'] }),
  });
  assert.ok(lote.status < 300, JSON.stringify(lote.datos));
  const lista = (await peticion('GET', '/api/cobranza/comprobantes', { sesion: esc.admin })).datos;
  // Desde la ficha de CUALQUIERA de los envíos se encuentra el mismo grupo (así lo busca la pantalla).
  for (const e of envios) {
    const fila = lista.find((c) => c.envios?.some((v) => v.envio_id === e.id));
    assert.ok(fila, `el envío ${e.folio} aparece en un comprobante por revisar`);
    assert.equal(fila.envios.length, 3, 'el comprobante trae los 3 envíos que paga');
    assert.deepEqual(fila.envios.map((v) => v.monto).sort(), envios.map((x) => x.tarifa_total).sort(), 'con el precio de cada uno');
    assert.equal(fila.monto, envios.reduce((s, x) => s + x.tarifa_total, 0), 'y el total de los 3');
  }
  // La ficha de cada envío avisa que su comprobante paga varios.
  const d = await peticion('GET', `/api/envios/${envios[1].id}`, { sesion: esc.admin });
  assert.equal(d.datos.pagos.find((p) => p.comprobante)?.lote_folios?.length, 3);
  // Aprobar desde un envío aprueba los 3.
  const fila = lista.find((c) => c.envios?.some((v) => v.envio_id === envios[2].id));
  const ok = await peticion('POST', `/api/cobranza/comprobantes/${fila.id}/aprobar`, { sesion: esc.admin, json: { referencia: 'OP-15-10' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.deepEqual([...ok.datos.envio_ids].sort(), envios.map((e) => e.id).sort());
});
