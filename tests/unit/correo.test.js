// Correo por la API HTTPS de Resend (Railway bloquea SMTP en los planes Free, Trial y Hobby).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { correoConfigurado, enviarCorreo } from '../../server/lib/correo.js';

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.RESEND_API_KEY;
  delete process.env.CORREO_REMITENTE;
});

test('sin RESEND_API_KEY ni SMTP_URL no se envía nada', async () => {
  delete process.env.SMTP_URL;
  assert.equal(correoConfigurado(), false);
  assert.equal(await enviarCorreo({ para: 'a@b.cl', asunto: 'x', texto: 'y' }), false);
});

test('con RESEND_API_KEY envía por HTTPS con remitente y "responder a"', async () => {
  process.env.RESEND_API_KEY = 're_prueba';
  process.env.CORREO_REMITENTE = 'JF Envíos <soporte@jfenvios.cl>';
  let llamada;
  globalThis.fetch = async (url, opciones) => { llamada = { url, opciones }; return new Response('{"id":"1"}', { status: 200 }); };
  assert.equal(correoConfigurado(), true);
  assert.equal(await enviarCorreo({ para: 'jacob@correo.cl', asunto: 'Soporte', texto: 'Hola', responderA: 'cliente@correo.cl' }), true);
  assert.equal(llamada.url, 'https://api.resend.com/emails');
  assert.equal(llamada.opciones.headers.Authorization, 'Bearer re_prueba');
  assert.deepEqual(JSON.parse(llamada.opciones.body), {
    from: 'JF Envíos <soporte@jfenvios.cl>', to: ['jacob@correo.cl'], subject: 'Soporte', text: 'Hola', reply_to: 'cliente@correo.cl',
  });
});

test('si Resend rechaza el envío, el error dice por qué', async () => {
  process.env.RESEND_API_KEY = 're_prueba';
  globalThis.fetch = async () => new Response('{"message":"domain not verified"}', { status: 403 });
  await assert.rejects(enviarCorreo({ para: 'a@b.cl', asunto: 'x', texto: 'y' }), /403.*domain not verified/);
});
