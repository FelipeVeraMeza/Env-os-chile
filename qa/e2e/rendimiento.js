// RNF-03: cada pantalla principal debe estar lista en < 2 s con una conexión 4G.
// Simula 4G (150 ms de latencia, 9 Mbps de bajada, 1,5 Mbps de subida; perfil "Fast 4G" de Chrome) y un teléfono
// con CPU 4 veces más lenta, SIN caché (primera visita). Mide hasta que la pantalla muestra sus datos.
//   npm run rendimiento [-- URL]
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const URL_APP = (process.argv[2] || process.env.QA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const LIMITE_MS = 2000;
const candidatos = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).filter((p) => fs.existsSync(p));
const navegador = await chromium.launch(candidatos.length ? { executablePath: candidatos[0] } : { channel: 'chrome' });
const perfiles = await (await fetch(`${URL_APP}/api/demo/usuarios`)).json();

const pantallas = [
  ['Seguimiento público', null, '#/seguimiento', '#vista h1'],
  ['Cliente · inicio', 'cliente', '#/inicio', '#vista .hero h1'],
  ['Cliente · nuevo envío', 'cliente', '#/nuevo', '#form-envio'],
  ['Cliente · mis envíos', 'cliente', '#/envios', '#resultado .item-envio, #resultado .vacio, #resultado table'],
  ['Repartidor · mi ruta', 'repartidor', '#/ruta', '#vista .hero h1'],
  ['Admin · panel', 'admin', '#/panel', '#vista .grafico, #vista .kpi, #vista h1'],
  ['Admin · registro', 'admin', '#/envios', '#resultado .item-envio, #resultado table, #resultado .vacio'],
];

let fallas = 0;
console.log(`\n▶ Carga de pantallas con 4G simulado contra ${URL_APP} (límite ${LIMITE_MS} ms)\n`);
for (const [nombre, rol, hash, listo] of pantallas) {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const pagina = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pagina);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const perfil = rol && perfiles.find((p) => p.rol === rol);
  if (perfil) await ctx.addInitScript((id) => { try { localStorage.setItem('envios.perfil', String(id)); } catch { /* */ } }, perfil.id);
  const t0 = Date.now();
  await pagina.goto(`${URL_APP}/${hash}`);
  await pagina.locator(listo).first().waitFor({ timeout: 15000 });
  const ms = Date.now() - t0;
  const ok = ms < LIMITE_MS;
  if (!ok) fallas++;
  console.log(`  ${ok ? '✔' : '✖'} ${nombre.padEnd(24)} ${String(ms).padStart(5)} ms`);
  await ctx.close();
}
await navegador.close();
console.log(fallas ? `\n✖ ${fallas} pantalla(s) sobre ${LIMITE_MS} ms\n` : '\n✔ Todas las pantallas cargan en menos de 2 s con 4G.\n');
process.exit(fallas ? 1 : 0);
