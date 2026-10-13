// Soporte como conversación (pedido 13-10): validaciones y correos con la marca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correoAvisoAdmin, correoCasoCreado, correoRespuestaSoporte, validarCasoSoporte, validarMensajeConversacion } from '../../server/lib/soporte.js';

test('caso sin sesión: nombre, forma de responder, motivo válido y mensaje', () => {
  const malo = validarCasoSoporte({ nombre: 'A', contacto: '123', motivo: 'inventado', mensaje: 'hola' }, { conSesion: false });
  assert.deepEqual(Object.keys(malo.errores).sort(), ['contacto', 'mensaje', 'motivo', 'nombre']);
  const ok = validarCasoSoporte({ nombre: 'Ana', contacto: '+56 9 1234 5678', folio: 'env-2026-000001', mensaje: 'Mi paquete no llega' }, { conSesion: false });
  assert.deepEqual(ok.errores, {});
  assert.equal(ok.datos.motivo, 'otro', 'sin motivo queda "otro"');
  assert.equal(ok.datos.folio, 'ENV-2026-000001');
});

test('con sesión basta el mensaje', () => {
  assert.deepEqual(validarCasoSoporte({ mensaje: 'Necesito ayuda con un pago', motivo: 'pago' }, { conSesion: true }).errores, {});
});

test('un mensaje de la conversación lleva texto o archivo; "interno" solo con true', () => {
  assert.ok(validarMensajeConversacion({ texto: '  ' }).errores.texto);
  assert.deepEqual(validarMensajeConversacion({ texto: '' }, { conArchivo: true }).errores, {});
  assert.equal(validarMensajeConversacion({ texto: 'x', interno: 'true' }).interno, true);
  assert.equal(validarMensajeConversacion({ texto: 'x', interno: 'si' }).interno, false);
  assert.ok(validarMensajeConversacion({ texto: 'x'.repeat(2001) }).errores.texto);
  assert.equal(validarMensajeConversacion({ respuesta: 'compatibilidad' }).texto, 'compatibilidad');
});

const caso = { folio_caso: 'SOP-2026-000045', nombre: 'Ana <b>', contacto: 'ana@correo.cl', folio: 'ENV-2026-000001', motivo: 'reclamo' };
const negocio = { nombre: 'Optienvia', telefono: '+56 9 6787 2500' };
const enlace = 'https://www.optienvia.cl/#/soporte/caso/abc123abc123abc123abc123';

test('correos de soporte: número de caso, enlace para responder y nombres escapados', () => {
  for (const c of [
    correoCasoCreado({ caso, negocio, enlace }),
    correoRespuestaSoporte({ caso, negocio, enlace, respuesta: 'Ya lo revisamos <script>' }),
    correoAvisoAdmin({ caso, negocio, enlace, texto: 'Llegó roto', esRespuesta: false }),
  ]) {
    assert.ok(c.asunto.includes('SOP-2026-000045'));
    assert.ok(c.texto.includes(enlace) && c.html.includes(`href="${enlace}"`));
    assert.ok(!c.html.includes('<script>') && !c.html.includes('Ana <b>'), 'lo que escribe el usuario va escapado');
    assert.ok(c.html.includes('#e0218a'), 'con la marca');
  }
  assert.match(correoAvisoAdmin({ caso, negocio, enlace, texto: 'x', esRespuesta: true }).asunto, /^Nueva respuesta/);
});
