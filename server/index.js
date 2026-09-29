import { config, validarProduccion } from './config.js';
import { crearApp } from './app.js';
import { migrar } from './db/migrate.js';
import { cerrarCuentasDemo, sembrar } from './db/seed.js';
import { conectar, explicarErrorConexion, pool } from './db/pool.js';
import { asegurarAlmacenamiento } from './lib/archivos.js';

async function iniciar() {
  const faltan = validarProduccion(process.env);
  if (faltan.length) {
    throw Object.assign(new Error(`faltan variables de entorno en producción:\n  - ${faltan.join('\n  - ')}`), { ayuda: 'Agrégalas en Railway → Variables (plantilla: .env.railway.example).' });
  }
  const db = await conectar();
  console.log(`[db] conectando a ${db.host || 'base local'}${db.esSupabase ? ` (Supabase${db.pooler ? ', pooler' : ''})` : ''} · SSL ${db.ssl ? 'sí' : 'no'}`);
  await pool.query('SELECT 1');
  await migrar();
  await sembrar();
  if (config.authMode === 'jwt' && config.entorno === 'production') await cerrarCuentasDemo();
  const alm = await asegurarAlmacenamiento();
  console.log(`[archivos] fotos y boletas en ${alm.driver === 'supabase' ? `Supabase Storage (bucket "${alm.destino}")` : `disco local (${alm.destino})`}`);

  const servidor = crearApp().listen(config.puerto, () => {
    console.log(`[api] lista en ${config.publicBaseUrl} (puerto ${config.puerto}, modo ${config.authMode})`);
  });

  // Railway envía SIGTERM al redesplegar: cerrar ordenado para no cortar peticiones.
  const cerrar = (senal) => {
    console.log(`[api] ${senal} recibido, cerrando…`);
    servidor.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

iniciar().catch((err) => {
  console.error('[api] no se pudo iniciar:', err.message);
  const ayuda = err.ayuda || explicarErrorConexion(err);
  if (ayuda) console.error(`[api] 👉 ${ayuda}`);
  process.exit(1);
});
