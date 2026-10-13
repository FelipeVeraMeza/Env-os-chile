// Pedidos 11-10 (bolsas de envío por color y medida) y 12-10 (aviso por correo al destinatario).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPedidoBolsas, normalizarMedida, precioPorBolsa, validarProductoBolsa } from '../../server/lib/bolsas.js';
import { correoAvisoDestinatario, urlSeguimiento } from '../../server/lib/aviso-destinatario.js';
import { escaparHtml } from '../../server/lib/plantilla-correo.js';

const CATALOGO = [
  { id: 1, color: 'Fucsia', medida: '17x30', unidades: 100, precio: 4150 },
  { id: 7, color: 'Fucsia', medida: '45x60', unidades: 100, precio: 13250 },
];

test('el total del pedido sale de los precios del catálogo, no de lo que mande el navegador', () => {
  const r = calcularPedidoBolsas([{ bolsa_id: 1, cantidad: 2, precio_unitario: 1 }, { bolsa_id: '7', cantidad: '1' }], CATALOGO);
  assert.deepEqual(r.errores, {});
  assert.equal(r.total, 2 * 4150 + 13250);
  assert.deepEqual(r.lineas.map((l) => [l.medida, l.cantidad, l.precio_unitario, l.subtotal]), [['17x30', 2, 4150, 8300], ['45x60', 1, 13250, 13250]]);
});

test('la misma medida repetida se suma en una línea y respeta el máximo de 100 paquetes', () => {
  assert.equal(calcularPedidoBolsas([{ bolsa_id: 1, cantidad: 3 }, { bolsa_id: 1, cantidad: 4 }], CATALOGO).lineas[0].cantidad, 7);
  assert.ok(calcularPedidoBolsas([{ bolsa_id: 1, cantidad: 60 }, { bolsa_id: 1, cantidad: 60 }], CATALOGO).errores.items);
});

test('pedido vacío, bolsa inexistente o desactivada y cantidades inválidas se rechazan', () => {
  assert.ok(calcularPedidoBolsas([], CATALOGO).errores.items);
  assert.ok(calcularPedidoBolsas(null, CATALOGO).errores.items);
  assert.ok(calcularPedidoBolsas([{ bolsa_id: 99, cantidad: 1 }], CATALOGO).errores['items.0.bolsa_id']);
  for (const cantidad of [0, -1, 1.5, 101, '', null, true, 'dos']) {
    assert.ok(calcularPedidoBolsas([{ bolsa_id: 1, cantidad }], CATALOGO).errores['items.0.cantidad'], `cantidad ${JSON.stringify(cantidad)}`);
  }
});

test('las medidas se escriben de varias formas y quedan como ancho x alto', () => {
  assert.equal(normalizarMedida('17x30'), '17x30');
  assert.equal(normalizarMedida(' 17 X 30 cm '), '17x30');
  assert.equal(normalizarMedida('60×80'), '60x80');
  assert.equal(normalizarMedida('grande'), null);
  assert.equal(normalizarMedida('17x'), null);
});

test('producto nuevo: color, medida, unidades y precio obligatorios; el costo es opcional', () => {
  const ok = validarProductoBolsa({ color: 'negro', medida: '20 x 30', unidades: '100', precio: '4500', costo: '' });
  assert.deepEqual(ok.errores, {});
  assert.deepEqual(ok.datos, { color: 'Negro', medida: '20x30', unidades: 100, precio: 4500, costo: null });
  const malo = validarProductoBolsa({ color: '', medida: 'x', unidades: 0, precio: 0, costo: -5 });
  assert.deepEqual(Object.keys(malo.errores).sort(), ['color', 'costo', 'medida', 'precio', 'unidades']);
});

test('editar un producto valida solo lo que cambia (precio vacío no es $0)', () => {
  assert.deepEqual(validarProductoBolsa({ precio: 5000 }, { parcial: true }), { datos: { precio: 5000 }, errores: {} });
  assert.ok(validarProductoBolsa({ precio: '' }, { parcial: true }).errores.precio);
  assert.ok(validarProductoBolsa({ activo: 'false' }, { parcial: true }).errores.activo);
  assert.deepEqual(validarProductoBolsa({ activo: false }, { parcial: true }).datos, { activo: false });
});

test('precio por bolsa para mostrar al cliente', () => {
  assert.equal(precioPorBolsa(4150, 100), 42);
  assert.equal(precioPorBolsa(25500, 100), 255);
});

test('el correo al destinatario lleva el folio y el enlace de seguimiento, sin la dirección', () => {
  const c = correoAvisoDestinatario({ folio: 'ENV-2026-000123', destinatario: 'Ana Pérez', remitente: 'Tienda Lila', negocio: { nombre: 'JF Envíos' } });
  assert.equal(c.asunto, 'Tienda Lila te envió un paquete · ENV-2026-000123');
  assert.match(c.texto, /^Hola Ana Pérez:/);
  assert.ok(c.texto.includes(urlSeguimiento('ENV-2026-000123')));
  assert.match(urlSeguimiento('ENV-2026-000123'), /\/#\/seguimiento\/ENV-2026-000123$/);
});

test('el correo al destinatario va con la marca: botón magenta al seguimiento, folio y encabezado azul', () => {
  const negocio = { nombre: 'JF Envíos', telefono: '+56 9 1234 5678', correo: 'contacto@jfenvios.cl' };
  const { html } = correoAvisoDestinatario({ folio: 'ENV-2026-000123', destinatario: 'Ana', remitente: 'Tienda Lila', negocio });
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes(`href="${urlSeguimiento('ENV-2026-000123')}"`), 'botón al seguimiento');
  assert.ok(html.includes('#e0218a') && html.includes('#0a1a6b'), 'magenta y azul de la marca');
  assert.ok(html.includes('ENV-2026-000123') && html.includes('contacto@jfenvios.cl'));
  assert.ok(!html.includes('<img'), 'sin logo subido no hay imagen');
  assert.ok(correoAvisoDestinatario({ folio: 'F', destinatario: 'A', remitente: 'B', negocio: { ...negocio, logo_url: 'data:image/png;base64,x' } }).html
    .includes('/api/config/logo.png'), 'el logo se carga por URL (Gmail no muestra imágenes incrustadas)');
});

test('los nombres que escriben los usuarios no pueden meter HTML en el correo', () => {
  const { html } = correoAvisoDestinatario({ folio: 'ENV-2026-000123', destinatario: '<b>Ana</b>', remitente: 'Tienda <script>alert(1)</script>', negocio: { nombre: 'JF "Envíos"' } });
  assert.ok(!html.includes('<script>') && !html.includes('<b>Ana</b>'));
  assert.ok(html.includes('Tienda &lt;script&gt;'));
  assert.equal(escaparHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
});
