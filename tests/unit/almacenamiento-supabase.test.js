import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarSupabaseFalso } from '../helpers/supabase-falso.js';

let falso;
let archivos;

before(async () => {
  falso = await iniciarSupabaseFalso();
  process.env.SUPABASE_URL = falso.url;
  process.env.SUPABASE_SECRET_KEY = falso.clave;
  process.env.SUPABASE_BUCKET = 'envios-prueba';
  archivos = await import('../../server/lib/archivos.js');
});
after(() => falso.cerrar());

test('crea el bucket privado si no existe (y no falla si ya existe)', async () => {
  const r = await archivos.asegurarAlmacenamiento();
  assert.deepEqual(r, { driver: 'supabase', destino: 'envios-prueba' });
  assert.equal(falso.buckets.get('envios-prueba').public, false);
  await archivos.asegurarAlmacenamiento();
});

test('sube y lee de vuelta una boleta', async () => {
  const contenido = Buffer.from('%PDF-1.4 boleta');
  const g = await archivos.guardarArchivo(contenido, 'application/pdf');
  assert.match(g.ruta, /^sb:\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
  assert.equal(g.tamano, contenido.length);
  assert.deepEqual(await archivos.leerArchivo(g.ruta), contenido);
});

test('un archivo inexistente devuelve null', async () => {
  assert.equal(await archivos.leerArchivo('sb:2026/01/no-existe.jpg'), null);
});
