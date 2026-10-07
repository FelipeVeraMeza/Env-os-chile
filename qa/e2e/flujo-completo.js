// Prueba de extremo a extremo por la INTERFAZ (no solo la API), con tres personas a la vez en teléfonos:
// el cliente crea y paga un envío, administración lo asigna, el repartidor lo retira y lo entrega con foto + GPS,
// la pantalla del cliente se actualiza sola y el seguimiento público muestra "Entregado".
//   npm run e2e [-- URL]        (por defecto http://localhost:3000, demo abierta)
// Necesita Chrome/Chromium: usa CHROMIUM_PATH o el Chrome instalado en el equipo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { jpegPrueba } from '../cliente.js';

const URL_APP = (process.argv[2] || process.env.QA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dir = path.dirname(fileURLToPath(import.meta.url));
const capturas = path.join(dir, '..', 'reportes', 'e2e');
fs.mkdirSync(capturas, { recursive: true });

const candidatos = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).filter((p) => fs.existsSync(p));
const navegador = await chromium.launch(candidatos.length ? { executablePath: candidatos[0] } : { channel: 'chrome' });
const TELEFONO = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-CL', timezoneId: 'America/Santiago' };

const problemas = [];
const pasos = [];
let n = 0;
async function paso(nombre, fn) {
  const t0 = Date.now();
  await fn();
  pasos.push(`✔ ${nombre} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log(pasos.at(-1));
}

async function persona(nombre, rol, extra = {}) {
  const ctx = await navegador.newContext({ ...TELEFONO, ...extra });
  const pagina = await ctx.newPage();
  pagina.on('pageerror', (e) => problemas.push(`[${nombre}] error JS: ${e.message}`));
  pagina.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problemas.push(`[${nombre}] ${r.status()} ${r.url()}`); });
  await pagina.goto(`${URL_APP}/`, { waitUntil: 'networkidle' });
  if (rol) {
    const perfiles = await (await pagina.request.get(`${URL_APP}/api/demo/usuarios`)).json();
    const perfil = perfiles.find((p) => p.rol === rol);
    if (!perfil) throw new Error(`No hay un perfil demo de ${rol} (¿la demo tiene inicio de sesión real?)`);
    await pagina.evaluate((id) => localStorage.setItem('envios.perfil', String(id)), perfil.id);
    await pagina.reload({ waitUntil: 'networkidle' });
    return { pagina, perfil };
  }
  return { pagina };
}
const foto = (p, nombre) => p.screenshot({ path: path.join(capturas, `${String(++n).padStart(2, '0')}-${nombre}.png`), fullPage: false });

try {
  const cliente = await persona('cliente', 'cliente');
  const admin = await persona('admin', 'admin');
  const repartidor = await persona('repartidor', 'repartidor', { geolocation: { latitude: -33.4263, longitude: -70.617, accuracy: 12 }, permissions: ['geolocation'] });
  const c = cliente.pagina;
  let folio;
  let envioId;

  await paso('Cliente crea un envío de 2 bultos con el formulario (5 pasos: retiro, destinatario, destino, paquete, confirmar)', async () => {
    const t0 = Date.now();
    await c.goto(`${URL_APP}/#/nuevo`, { waitUntil: 'networkidle' });
    // Retiro: si el cliente ya tiene una guardada viene lista; si no, se completa.
    if (!(await c.inputValue('[name=calle]'))) {
      await c.fill('[name=calle]', 'Los Leones');
      await c.fill('[name=numero]', '1180');
      await c.selectOption('[name=comuna_id]', { label: 'Providencia' });
    }
    await c.click('#siguiente');
    if (await c.locator('[data-modo="nuevo"]').count()) await c.click('[data-modo="nuevo"]');
    await c.fill('[name=nombre]', 'Paula Fernández');
    await c.fill('[name=telefono]', '+56 9 6123 4567');
    await c.click('#siguiente');
    await c.fill('[name=calle]', 'Av. Providencia');
    await c.fill('[name=numero]', '2133');
    await c.fill('[name=depto]', 'Of. 402');
    await c.selectOption('[name=comuna_id]', { label: 'Providencia' });
    await c.fill('[name=referencia]', 'Recepción del edificio');
    await c.click('#siguiente');
    await c.check('[name=tamano][value=estandar]');
    await c.fill('[name=descripcion_producto]', 'Libros y cuadernos');
    await c.fill('[name=bultos]', '2');
    await c.click('#siguiente');
    await foto(c, 'cliente-resumen');
    await c.click('#siguiente');
    await c.locator('.hero h1.mono').waitFor();
    folio = (await c.locator('.hero h1.mono').textContent()).trim();
    if (!/^ENV-\d{4}-\d{6}$/.test(folio)) throw new Error(`Folio inesperado: ${folio}`);
    pasos.push(`  · formulario completado en ${((Date.now() - t0) / 1000).toFixed(1)} s (automatizado; RNF-02 exige < 60 s a una persona)`);
    await foto(c, 'cliente-envio-creado');
  });

  await paso('Cliente paga por transferencia: sube el comprobante y queda en revisión', async () => {
    await c.click('#transferir');
    const jpeg = Buffer.from(await jpegPrueba().arrayBuffer());
    await c.setInputFiles('#f-comprobante input[name=archivo]', { name: 'comprobante.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await c.click('#f-comprobante button');
    await c.waitForURL(/#\/envio\/\d+$/);
    envioId = Number(c.url().match(/envio\/(\d+)/)[1]);
    await c.locator('.badge', { hasText: 'Pendiente de aprobación' }).first().waitFor();
    await foto(c, 'cliente-comprobante-en-revision');
  });

  await paso('Administración (otro teléfono, al mismo tiempo) aprueba el pago y asigna el repartidor', async () => {
    const a = admin.pagina;
    await a.goto(`${URL_APP}/#/envio/${envioId}`, { waitUntil: 'networkidle' });
    await a.click('#revisar-comprobante');
    await a.click('#f-revision button[data-decision="aprobar"]');
    await a.locator('#asignar').waitFor();
    await a.selectOption('#asignar', String(repartidor.perfil.id));
    await a.locator('.badge', { hasText: 'Asignado' }).first().waitFor();
    await foto(a, 'admin-asignado');
  });

  await paso('Repartidor ve el envío en su ruta y lo retira', async () => {
    const r = repartidor.pagina;
    // Ya tenía "Mi ruta" abierta desde antes de la asignación: recarga (la actualización automática también lo mostraría en ≤ 30 s).
    await r.goto(`${URL_APP}/#/ruta`);
    await r.reload({ waitUntil: 'networkidle' });
    await r.locator('.folio', { hasText: folio }).waitFor({ timeout: 5000 });
    await foto(r, 'repartidor-ruta');
    await r.goto(`${URL_APP}/#/envio/${envioId}`, { waitUntil: 'networkidle' });
    const wa = await r.locator('a', { hasText: 'Avisar por WhatsApp' }).getAttribute('href');
    if (!wa.startsWith('https://wa.me/56961234567')) throw new Error(`Aviso de WhatsApp con teléfono incorrecto: ${wa}`);
    await r.click('#retirar');
    await r.locator('#entregar').waitFor();
  });

  await paso('Repartidor entrega con foto + GPS (sin foto no se habilita el botón)', async () => {
    const r = repartidor.pagina;
    await r.click('#entregar');
    await r.locator('#gps.ok').waitFor();
    if (!(await r.locator('#confirmar-ent').isDisabled())) throw new Error('Se pudo confirmar sin foto');
    const jpeg = Buffer.from(await jpegPrueba().arrayBuffer());
    await r.setInputFiles('input[name=foto]', { name: 'entrega.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await r.fill('[name=receptor]', 'Conserje');
    await r.locator('#confirmar-ent:not([disabled])').waitFor();
    await foto(r, 'repartidor-entrega');
    await r.click('#confirmar-ent');
    await r.locator('.badge', { hasText: 'Entregado' }).first().waitFor();
  });

  await paso('La pantalla del cliente se actualiza sola a "Entregado" (sin recargar)', async () => {
    await c.locator('.badge', { hasText: 'Entregado' }).first().waitFor({ timeout: 40_000 });
    await foto(c, 'cliente-entregado');
  });

  await paso('Seguimiento público por folio, sin iniciar sesión', async () => {
    const { pagina: p } = await persona('público', null);
    await p.goto(`${URL_APP}/#/seguimiento/${folio}`, { waitUntil: 'networkidle' });
    await p.locator('.badge', { hasText: 'Entregado' }).first().waitFor();
    if ((await p.content()).includes('6123 4567')) throw new Error('El seguimiento público muestra el teléfono');
    await foto(p, 'seguimiento-publico');
  });
} catch (err) {
  problemas.push(`Falló: ${err.message}`);
} finally {
  await navegador.close();
}

console.log(`\n  Capturas: ${path.relative(process.cwd(), capturas)}/`);
if (problemas.length) {
  console.log(`\n✖ ${problemas.length} problema(s):\n  ${problemas.join('\n  ')}\n`);
  process.exit(1);
}
console.log('\n✔ Flujo completo por la interfaz sin errores.\n');
