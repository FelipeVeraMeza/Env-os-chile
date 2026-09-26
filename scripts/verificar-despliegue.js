// Verifica que la configuración funciona ANTES de subir a Railway.
// Uso:  npm run verificar            (lee .env)
//       npm run verificar -- --railway (además exige lo necesario para producción)
import { config } from '../server/config.js';
import { conectar, explicarErrorConexion, pool } from '../server/db/pool.js';
import { asegurarAlmacenamiento, guardarArchivo, leerArchivo } from '../server/lib/archivos.js';

const estricto = process.argv.includes('--railway');
let fallas = 0;
let avisos = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const aviso = (m) => { avisos++; console.log(`  ⚠ ${m}`); };
const falla = (m) => { fallas++; console.log(`  ✖ ${m}`); };

console.log('\n1) Variables');
if (config.supabaseDb) ok('Base: se buscará el Session pooler con SUPABASE_URL + SUPABASE_DB_PASSWORD');
else if (!process.env.DATABASE_URL) falla('Falta DATABASE_URL (o SUPABASE_URL + SUPABASE_DB_PASSWORD)');
else ok(`DATABASE_URL → ${config.db.host}${config.db.esSupabase ? ' (Supabase)' : ''}`);
if (config.db.esSupabase && !config.db.pooler) {
  aviso('Estás usando la conexión DIRECTA de Supabase (solo IPv6). Desde Railway usa el "Session pooler" (…pooler.supabase.com:5432).');
}
if (config.db.esSupabase && config.db.pooler && /:6543\b/.test(process.env.DATABASE_URL || '')) {
  aviso('Puerto 6543 = Transaction pooler. Se recomienda el Session pooler (puerto 5432) para migraciones y bloqueos.');
}
if (config.jwtSecret === 'solo-para-desarrollo-cambiar' || config.jwtSecret.length < 32) {
  (estricto ? falla : aviso)('JWT_SECRET no definido o muy corto (mínimo 32 caracteres). También firma los enlaces de fotos y boletas.');
} else ok('JWT_SECRET definido');
if (config.admin.password === 'Cambiar.Esta.Clave.2026') (estricto ? falla : aviso)('ADMIN_PASSWORD sigue con el valor de ejemplo');
else ok(`Administrador inicial: ${config.admin.correo}`);
if (config.authMode === 'demo') {
  if (config.demoClave) ok('Modo demo protegido con DEMO_CLAVE');
  else aviso('Modo demo SIN clave: cualquiera con el enlace entra como administrador. Define DEMO_CLAVE.');
} else ok(`AUTH_MODE=${config.authMode}`);
if (config.almacenamiento.driver === 'supabase') ok(`Archivos en Supabase Storage (bucket "${config.almacenamiento.bucket}")`);
else (estricto ? falla : aviso)('Archivos en disco local: en Railway se pierden en cada despliegue. Define SUPABASE_URL y SUPABASE_SECRET_KEY.');

console.log('\n2) Base de datos');
try {
  await conectar();
  const t0 = Date.now();
  const { rows: [v] } = await pool.query('SELECT version(), current_user, current_database()');
  ok(`Conexión OK en ${Date.now() - t0} ms · ${v.version.split(' ').slice(0, 2).join(' ')} · usuario ${v.current_user} · SSL ${config.db.ssl ? 'sí' : 'no'}`);
  const { rows: [m] } = await pool.query("SELECT to_regclass('public.schema_migracion') IS NOT NULL AS existe");
  if (m.existe) {
    const { rows } = await pool.query('SELECT nombre FROM schema_migracion ORDER BY nombre');
    ok(`Migraciones aplicadas: ${rows.map((r) => r.nombre).join(', ') || 'ninguna'}`);
  } else ok('Base vacía: las tablas se crearán solas en el primer arranque');
} catch (err) {
  falla(`No se pudo conectar: ${err.message}`);
  const ayuda = explicarErrorConexion(err);
  if (ayuda) console.log(`    👉 ${ayuda}`);
}

console.log('\n3) Archivos (fotos y boletas)');
try {
  const alm = await asegurarAlmacenamiento();
  ok(`Almacenamiento listo (${alm.driver}: ${alm.destino})`);
  const prueba = Buffer.from(`verificacion ${new Date().toISOString()}`);
  const g = await guardarArchivo(prueba, 'application/pdf');
  const leido = await leerArchivo(g.ruta);
  if (leido && Buffer.compare(leido, prueba) === 0) ok('Escritura y lectura de prueba correctas');
  else falla('El archivo de prueba no se pudo leer de vuelta');
  if (alm.driver === 'supabase') {
    const anonimo = await fetch(`${config.almacenamiento.supabaseUrl}/storage/v1/object/public/${config.almacenamiento.bucket}/${g.ruta.slice(3)}`);
    if (anonimo.ok) falla('¡El archivo es accesible públicamente! Marca el bucket como privado.');
    else ok('El bucket es privado (acceso anónimo denegado)');
    await fetch(`${config.almacenamiento.supabaseUrl}/storage/v1/object/${config.almacenamiento.bucket}`, {
      method: 'DELETE',
      headers: { apikey: config.almacenamiento.supabaseKey, 'Content-Type': 'application/json', ...(config.almacenamiento.supabaseKey.startsWith('eyJ') ? { Authorization: `Bearer ${config.almacenamiento.supabaseKey}` } : {}) },
      body: JSON.stringify({ prefixes: [g.ruta.slice(3)] }),
    }).catch(() => {});
  }
} catch (err) {
  falla(`Almacenamiento: ${err.message}`);
}

await pool.end().catch(() => {});
console.log(`\n${fallas ? `✖ ${fallas} problema(s) por resolver` : '✔ Todo listo para desplegar'}${avisos ? ` · ${avisos} aviso(s)` : ''}\n`);
process.exit(fallas ? 1 : 0);
