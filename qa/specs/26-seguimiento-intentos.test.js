// Pedido 07-10: el seguimiento muestra en qué intento de entrega va el paquete y si se devolvió tras los 3 intentos.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { envioEnRuta, escenario, peticion } from '../cliente.js';

let esc;
before(async () => { esc = await escenario(); });

const estado = async (id, sesion, cuerpo) => {
  const r = await peticion('POST', `/api/envios/${id}/estado`, { sesion, json: cuerpo });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
};

test('CP-260 · Tres intentos fallidos y devolución: el seguimiento muestra cada intento y por qué se devolvió', async () => {
  const e = await envioEnRuta(esc);
  const max = (await peticion('GET', '/api/config/publica')).datos.operacion.intentos_max;
  for (let i = 1; i <= max; i++) {
    await estado(e.id, esc.repartidor, { estado: 'fallido', motivo: 'nadie_en_domicilio', detalle: 'Dato privado del repartidor' });
    const s = (await peticion('GET', `/api/seguimiento/${e.folio}`)).datos;
    assert.equal(s.intentos, i);
    assert.equal(s.historial.at(-1).label, `Intento ${i} de ${max}: no se pudo entregar`);
    assert.equal(s.historial.at(-1).detalle, 'Nadie en el domicilio');
    if (i < max) {
      await estado(e.id, esc.repartidor, { estado: 'reagendado', motivo: 'QA' }); // el repartidor programa el siguiente intento
      await estado(e.id, esc.repartidor, { estado: 'en_ruta' });
      assert.equal((await peticion('GET', `/api/seguimiento/${e.folio}`)).datos.historial.at(-1).label, `En ruta: intento ${i + 1} de ${max}`);
    }
  }
  await estado(e.id, esc.admin, { estado: 'devuelto', motivo: 'Tres intentos sin éxito' });
  const s = (await peticion('GET', `/api/seguimiento/${e.folio}`)).datos;
  assert.equal(s.estado, 'devuelto');
  assert.equal(s.historial.at(-1).label, 'Devuelto al remitente');
  assert.equal(s.historial.at(-1).detalle, `Después de ${max} intentos de entrega sin éxito`);
  assert.ok(!JSON.stringify(s).includes('Dato privado'), 'el detalle del repartidor no es público');
});

test('CP-261 · Después del último intento el repartidor ya no reagenda; el cliente nunca reagenda ni devuelve', async () => {
  const e = await envioEnRuta(esc);
  const max = (await peticion('GET', '/api/config/publica')).datos.operacion.intentos_max;
  await estado(e.id, esc.repartidor, { estado: 'fallido', motivo: 'nadie_en_domicilio' });
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.cliente, json: { estado: 'reagendado' } })).status, 403);
  assert.equal((await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'devuelto' } })).status, 403);
  for (let i = 2; i <= max; i++) {
    await estado(e.id, esc.repartidor, { estado: 'reagendado' });
    await estado(e.id, esc.repartidor, { estado: 'en_ruta' });
    await estado(e.id, esc.repartidor, { estado: 'fallido', motivo: 'nadie_en_domicilio' });
  }
  const r = await peticion('POST', `/api/envios/${e.id}/estado`, { sesion: esc.repartidor, json: { estado: 'reagendado' } });
  assert.equal(r.status, 409, 'sin intentos disponibles');
  await estado(e.id, esc.admin, { estado: 'devuelto', motivo: 'QA' });
});
