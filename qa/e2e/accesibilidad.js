// RNF-19: revisión automática de accesibilidad (WCAG 2.1 A y AA) con axe-core en las pantallas principales.
//   npm run accesibilidad [-- URL]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const URL_APP = (process.argv[2] || process.env.QA_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const candidatos = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean).filter((p) => fs.existsSync(p));
const navegador = await chromium.launch(candidatos.length ? { executablePath: candidatos[0] } : { channel: 'chrome' });
const perfiles = await (await fetch(`${URL_APP}/api/demo/usuarios`)).json();

const pantallas = [
  [null, '#/seguimiento'], ['cliente', '#/inicio'], ['cliente', '#/nuevo'], ['cliente', '#/envios'], ['cliente', '#/libreta'],
  ['repartidor', '#/ruta'], ['admin', '#/panel'], ['admin', '#/envios'], ['admin', '#/tarifas'], ['admin', '#/usuarios'], ['admin', '#/ajustes'],
];
let graves = 0;
const resumen = new Map();
for (const [rol, hash] of pantallas) {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true }); // solo para inyectar axe
  const p = await ctx.newPage();
  const perfil = rol && perfiles.find((x) => x.rol === rol);
  if (perfil) await ctx.addInitScript((id) => localStorage.setItem('envios.perfil', String(id)), perfil.id);
  await p.goto(`${URL_APP}/${hash}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  const v = r.violations.filter((x) => ['serious', 'critical'].includes(x.impact));
  graves += v.length;
  console.log(`${v.length ? '✖' : '✔'} ${(rol || 'público').padEnd(10)} ${hash.padEnd(14)} ${v.map((x) => `${x.id} (${x.nodes.length})`).join(', ') || 'sin problemas graves'}`);
  for (const x of v) resumen.set(x.id, { ayuda: x.help, ejemplo: x.nodes[0]?.target?.join(' '), html: x.nodes[0]?.html?.slice(0, 140) });
  await ctx.close();
}
await navegador.close();
for (const [id, d] of resumen) console.log(`\n  ${id}: ${d.ayuda}\n    ej.: ${d.ejemplo}\n    ${d.html}`);
console.log(graves ? `\n✖ ${graves} problema(s) graves de accesibilidad\n` : '\n✔ Sin problemas graves de accesibilidad (WCAG 2.1 AA).\n');
process.exit(graves ? 1 : 0);
