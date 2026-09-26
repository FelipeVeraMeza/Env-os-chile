// Ejecuta la suite QA contra un ambiente: node qa/run.js [local|railway|vercel|produccion]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarEntornos, resolverObjetivo } from './entornos.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const vars = cargarEntornos();
const objetivo = process.argv[2] || vars.QA_OBJETIVO || 'local';

let destino;
try {
  destino = resolverObjetivo(objetivo, vars);
} catch (err) {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(2);
}

console.log(`\n▶ QA contra "${destino.objetivo}"\n  API: ${destino.api}\n  Web: ${destino.web}\n`);
const salud = await fetch(`${destino.api}/api/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
if (!salud.ok) {
  console.error(`✖ La API no responde correctamente en ${destino.api}/api/health →`, salud);
  process.exit(2);
}
console.log(`  API ok · versión ${salud.version} · modo ${salud.auth_mode}\n`);

fs.mkdirSync(path.join(dir, 'reportes'), { recursive: true });
const sello = new Date().toISOString().replace(/[:.]/g, '-');
const resultado = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=junit', `--test-reporter-destination=${path.join(dir, 'reportes', `qa-${objetivo}-${sello}.xml`)}`,
  ...fs.readdirSync(path.join(dir, 'specs')).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join(dir, 'specs', f)),
], {
  stdio: 'inherit',
  env: { ...process.env, QA_API_URL: destino.api, QA_WEB_URL: destino.web, QA_OBJETIVO: objetivo, QA_ADMIN_CORREO: vars.QA_ADMIN_CORREO || '', QA_ADMIN_PASSWORD: vars.QA_ADMIN_PASSWORD || '' },
});
console.log(`\n  Reporte JUnit: qa/reportes/qa-${objetivo}-${sello}.xml`);
process.exit(resultado.status ?? 1);
