// Publica TODO de una vez:  node scripts/publicar.js [.env.railway]
//  1. Crea/actualiza la base en Supabase (tablas, RLS, comunas, configuración, usuarios) y el bucket privado.
//  2. Si hay RAILWAY_TOKEN: sube las variables a Railway y despliega (CLI oficial vía npx).
//  3. Espera a que la app responda y ejecuta la suite QA contra Railway.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { leerArchivoEnv } from '../qa/entornos.js';

const archivoEnv = process.argv[2] || '.env.railway';
if (!fs.existsSync(archivoEnv)) { console.error(`✖ No existe ${archivoEnv}`); process.exit(1); }
// Mismo lector que el resto: JWT_SECRET="abc" se sube como abc (antes se subía con las comillas incluidas).
const vars = leerArchivoEnv(fs.readFileSync(archivoEnv, 'utf8'));
Object.assign(process.env, vars);

const paso = (t) => console.log(`\n━━ ${t}`);

// 1) Supabase
paso('1/3 Base de datos y archivos en Supabase');
const { conectar, explicarErrorConexion, pool } = await import('../server/db/pool.js');
const { migrar } = await import('../server/db/migrate.js');
const { sembrar } = await import('../server/db/seed.js');
const { asegurarAlmacenamiento } = await import('../server/lib/archivos.js');
try {
  await conectar();
  await migrar();
  await sembrar();
  const alm = await asegurarAlmacenamiento();
  const { rows: [r] } = await pool.query(`SELECT (SELECT count(*) FROM comuna)::int AS comunas, (SELECT count(*) FROM usuario)::int AS usuarios,
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity)::int AS tablas_rls`);
  console.log(`  ✔ ${r.comunas} comunas · ${r.usuarios} usuarios · ${r.tablas_rls} tablas con RLS · archivos: ${alm.driver} (${alm.destino})`);
  await pool.end();
} catch (err) {
  console.error(`  ✖ ${err.message}`);
  const ayuda = explicarErrorConexion(err);
  if (ayuda) console.error(`  👉 ${ayuda}`);
  process.exit(1);
}

// 2) Railway
paso('2/3 Railway');
if (!process.env.RAILWAY_TOKEN) {
  console.log('  ⚠ Sin RAILWAY_TOKEN: pega las variables de este archivo en Railway → Variables → Raw Editor y despliega desde GitHub.');
} else {
  const rw = (...a) => spawnSync('npx', ['-y', '@railway/cli@latest', ...a], { stdio: 'inherit', env: process.env });
  const aSubir = Object.entries(vars).filter(([k]) => k !== 'RAILWAY_TOKEN' && k !== 'URL_RAILWAY');
  const r1 = rw('variables', ...aSubir.flatMap(([k, v]) => ['--set', `${k}=${v}`]), '--skip-deploys');
  if (r1.status !== 0) process.exit(1);
  const r2 = rw('up', '--detach');
  if (r2.status !== 0) process.exit(1);
  console.log('  ✔ Variables subidas y despliegue iniciado');
}

// 3) Verificación
paso('3/3 Verificación');
const url = (vars.URL_RAILWAY || '').replace(/\/+$/, '');
if (!url) { console.log('  ⚠ Define URL_RAILWAY en el archivo para verificar la app publicada.'); process.exit(0); }
let salud = null;
for (let i = 0; i < 30 && !salud?.ok; i++) {
  salud = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => null);
  if (!salud?.ok) await new Promise((r) => setTimeout(r, 10000));
}
if (!salud?.ok) { console.error(`  ✖ ${url} no responde. Revisa los logs de Railway.`); process.exit(1); }
console.log(`  ✔ App en línea: base ${salud.base}, archivos ${salud.archivos}, modo ${salud.auth_mode}`);
const qa = spawnSync(process.execPath, ['qa/run.js', 'railway'], { stdio: 'inherit', env: { ...process.env, URL_RAILWAY: url, QA_DEMO_CLAVE: vars.DEMO_CLAVE || '' } });
process.exit(qa.status ?? 1);
