// Verificación caso por caso del plan QA (docs/18): cruza cada error corregido (QA-NN) con el resultado REAL de su
// prueba en la última corrida y escribe docs/19-verificacion-caso-por-caso.md.
//   1. npm run qa:local          (deja el reporte JUnit en qa/reportes/)
//   2. npm run verificar:casos   (corre las unitarias y arma el informe)
// Un caso queda ✅ si todas sus pruebas automáticas pasaron; ⚠️ si su prueba es manual o de revisión; ❌ si alguna falló
// o no se encontró. El informe termina con el total de casos QA de la API (todos los CP-NN) y su estado.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirReportes = path.join(raiz, 'qa', 'reportes');

// ---- Casos QA de la API (último reporte JUnit) ----
const reportes = fs.existsSync(dirReportes) ? fs.readdirSync(dirReportes).filter((f) => /^qa-local-.*\.xml$/.test(f)).sort() : [];
if (!reportes.length) {
  console.error('✖ No hay reporte de QA. Corre primero: npm run qa:local');
  process.exit(2);
}
const reporte = reportes.at(-1);
const xml = fs.readFileSync(path.join(dirReportes, reporte), 'utf8');
const casos = new Map(); // CP-NN → 'ok' | 'falla' | 'omitido'
for (const m of xml.matchAll(/<testcase name="(CP-\d+)[^"]*"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const cuerpo = m[3] || '';
  casos.set(m[1], /<failure/.test(cuerpo) ? 'falla' : /<skipped/.test(cuerpo) ? 'omitido' : 'ok');
}

// ---- Pruebas unitarias (se corren ahora) ----
const unit = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/unit/**/*.test.js'], { cwd: raiz, encoding: 'utf8' });
const unitarias = [...unit.stdout.matchAll(/^\s*(ok|not ok) \d+ - (.*)$/gm)].filter(([, , n]) => !n.endsWith('.test.js')).map(([, r, nombre]) => ({ ok: r === 'ok', nombre }));
const unitariasDe = (qa) => unitarias.filter((u) => new RegExp(`\\bQA-${qa}\\b`).test(u.nombre));

// ---- Correcciones de pantalla verificadas en el navegador (npm run interfaz) ----
const archivoInterfaz = path.join(dirReportes, 'interfaz.json');
const interfaz = fs.existsSync(archivoInterfaz) ? JSON.parse(fs.readFileSync(archivoInterfaz, 'utf8')) : { resultados: {} };

// ---- Errores del plan (tablas de docs/18) ----
const plan = fs.readFileSync(path.join(raiz, 'docs', '18-plan-qa-50-errores.md'), 'utf8');
const errores = [];
for (const linea of plan.split('\n')) {
  const m = /^\| QA-(\d+) \| ([^|]+?) \| (.*) \| (.*) \| (.*) \|$/.exec(linea); // [^|] y no \w: "Crítica" lleva tilde
  if (m) errores.push({ n: Number(m[1]), sev: m[2], que: m[3], prueba: m[5] });
}
errores.sort((a, b) => a.n - b.n);

const resumir = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').split(/(?<=\.)\s/)[0].slice(0, 140);
const filas = errores.map((e) => {
  const cps = [...e.prueba.matchAll(/CP-(\d+)/g)].map((m) => `CP-${m[1]}`);
  const estadosCp = cps.map((c) => `${c} ${casos.get(c) === 'ok' ? '✔' : casos.get(c) === 'falla' ? '✖' : '?'}`);
  const us = /unitaria/.test(e.prueba) ? unitariasDe(String(e.n).padStart(2, '0')) : [];
  const evidencias = [...estadosCp];
  if (/unitaria/.test(e.prueba)) evidencias.push(us.length ? `${us.length} unitaria(s) ${us.every((u) => u.ok) ? '✔' : '✖'}` : 'unitaria ?');
  const id = `QA-${String(e.n).padStart(2, '0')}`;
  const enInterfaz = /interfaz/.test(e.prueba);
  const ri = interfaz.resultados[id];
  if (enInterfaz) evidencias.push(`navegador ${ri ? (ri.ok ? '✔' : '✖') : '?'}`);
  const automaticas = cps.length + (/unitaria/.test(e.prueba) ? 1 : 0) + (enInterfaz ? 1 : 0);
  const fallo = estadosCp.some((x) => !x.endsWith('✔')) || (/unitaria/.test(e.prueba) && (!us.length || !us.every((u) => u.ok))) || (enInterfaz && !ri?.ok);
  const manual = e.prueba.replace(/CP-\d+( \([^)]*\))?|unitaria|interfaz|,|·/g, ' ').replace(/\s+/g, ' ').trim();
  if (manual) evidencias.push(manual);
  const estado = fallo ? '❌' : automaticas ? '✅' : '⚠️';
  return { ...e, estado, evidencias };
});

const total = (f) => filas.filter(f).length;
const totalesCp = [...casos.values()];
const md = `# 19 · Verificación caso por caso

Generado por \`npm run verificar:casos\` el ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })} con el reporte \`qa/reportes/${reporte}\`
y las pruebas unitarias corridas en ese momento. No editar a mano: se vuelve a generar.

## Resumen

| | Cantidad |
|---|---|
| Errores corregidos revisados (QA-01 a QA-${String(errores.at(-1)?.n ?? 0).padStart(2, '0')}) | **${filas.length}** |
| ✅ Con prueba automática que pasó en esta corrida | **${total((f) => f.estado === '✅')}** |
| ⚠️ Verificados por revisión de código, navegador o ejecución manual (sin prueba automática propia) | **${total((f) => f.estado === '⚠️')}** |
| ❌ Con una prueba que falló o no se encontró | **${total((f) => f.estado === '❌')}** |
| Casos QA de la API en el reporte | ${totalesCp.length} · ✔ ${totalesCp.filter((x) => x === 'ok').length} · ✖ ${totalesCp.filter((x) => x === 'falla').length} · omitidos ${totalesCp.filter((x) => x === 'omitido').length} (solo aplican con AUTH_MODE=jwt) |
| Pruebas unitarias | ${unitarias.length} · ✔ ${unitarias.filter((u) => u.ok).length} · ✖ ${unitarias.filter((u) => !u.ok).length} |
| Verificaciones en el navegador (\`npm run interfaz\`) | ${Object.keys(interfaz.resultados).length} · ✔ ${Object.values(interfaz.resultados).filter((r) => r.ok).length} · ✖ ${Object.values(interfaz.resultados).filter((r) => !r.ok).length}${interfaz.fecha ? ` (${new Date(interfaz.fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago' })})` : ''} |

Los casos ⚠️ quedan cubiertos además por la regresión completa (flujo completo por la interfaz, accesibilidad y carga),
pero no tienen una prueba que falle si ese error puntual vuelve. Son candidatos a automatizar en la próxima iteración.

## Detalle

| N° | Sev. | Error | Evidencia | Estado |
|---|---|---|---|---|
${filas.map((f) => `| QA-${String(f.n).padStart(2, '0')} | ${f.sev} | ${resumir(f.que)} | ${f.evidencias.join(' · ')} | ${f.estado} |`).join('\n')}
`;
fs.writeFileSync(path.join(raiz, 'docs', '19-verificacion-caso-por-caso.md'), md);
console.log(`✔ docs/19-verificacion-caso-por-caso.md · ${filas.length} errores: ✅ ${total((f) => f.estado === '✅')} · ⚠️ ${total((f) => f.estado === '⚠️')} · ❌ ${total((f) => f.estado === '❌')}`);
process.exit(total((f) => f.estado === '❌') ? 1 : 0);
