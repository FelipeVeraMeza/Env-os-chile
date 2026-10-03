// Borra SOLO los envíos y lo que pertenece a cada uno (historial de estados, pagos y su bitácora, comprobantes,
// fotos, links de pago, reclamos de seguro y los costos ligados a ellos). Los folios vuelven a ENV-AAAA-000001.
// Se conserva todo lo demás: usuarios y contraseñas, destinatarios, configuración, tarifas, comunas y bitácoras.
//
// Con --con-destinatarios también se vacían las libretas de destinatarios (y sus direcciones) y la dirección de
// retiro guardada de cada cliente: los usuarios quedan, pero cada uno parte de cero (pedido 03-10).
//
// Uso (lee la base desde .env o variables: DATABASE_URL o SUPABASE_URL + SUPABASE_DB_PASSWORD):
//   npm run borrar-envios                                        → solo muestra qué se borraría
//   npm run borrar-envios -- --con-destinatarios                 → ídem, incluyendo libretas
//   npm run borrar-envios -- --con-destinatarios --confirmar     → guarda un respaldo en respaldos/ y borra
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { conectar, explicarErrorConexion, pool } from '../server/db/pool.js';
import { borrarArchivos } from '../server/lib/archivos.js';

const confirmado = process.argv.includes('--confirmar');
const conDestinatarios = process.argv.includes('--con-destinatarios');
// En orden: primero lo que apunta a otras tablas, al final los envíos.
const PASOS = [
  ['costo', 'DELETE FROM costo WHERE envio_id IS NOT NULL OR pago_id IS NOT NULL OR reclamo_id IS NOT NULL'],
  ['pago_evento', 'DELETE FROM pago_evento'],
  ['link_pago', 'DELETE FROM link_pago'],
  ['reclamo_seguro', 'DELETE FROM reclamo_seguro'],
  ['envio_estado', 'DELETE FROM envio_estado'],
  ['pago', 'DELETE FROM pago'],
  ['adjunto', 'DELETE FROM adjunto'],
  ['envio', 'DELETE FROM envio'],
  ['folio_contador', 'DELETE FROM folio_contador'],
  // Después de los envíos (que apuntan a ellas): direcciones, destinatarios y el retiro guardado de cada cliente.
  ...(conDestinatarios ? [
    ['direccion', 'DELETE FROM direccion'],
    ['destinatario', 'DELETE FROM destinatario'],
    ['retiro_guardado', `UPDATE usuario SET retiro_calle = NULL, retiro_numero = NULL, retiro_depto = NULL, retiro_referencia = NULL,
       retiro_comuna_id = NULL WHERE retiro_calle IS NOT NULL OR retiro_comuna_id IS NOT NULL`],
  ] : []),
];
const SELECCION = {
  costo: 'SELECT * FROM costo WHERE envio_id IS NOT NULL OR pago_id IS NOT NULL OR reclamo_id IS NOT NULL',
  retiro_guardado: `SELECT id, retiro_calle, retiro_numero, retiro_depto, retiro_referencia, retiro_comuna_id FROM usuario
    WHERE retiro_calle IS NOT NULL OR retiro_comuna_id IS NOT NULL`,
};

try {
  const db = await conectar();
  const datos = {};
  for (const [tabla] of PASOS) datos[tabla] = (await pool.query(SELECCION[tabla] || `SELECT * FROM ${tabla}`)).rows;
  console.log(`\nBase de datos: ${db.host || 'local'}${db.esSupabase ? ' (Supabase)' : ''}`);
  console.log('Se borrarán:');
  for (const [tabla] of PASOS) console.log(`  ${tabla.padEnd(16)} ${datos[tabla].length}`);
  console.log(conDestinatarios
    ? 'Se conservan: usuarios y contraseñas, configuración, tarifas, comunas y bitácoras (las libretas y retiros guardados se vacían).'
    : 'Se conservan: usuarios y contraseñas, destinatarios, configuración, tarifas, comunas y bitácoras.');
  const { usuarios } = (await pool.query('SELECT count(*)::int AS usuarios FROM usuario')).rows[0];
  console.log(`Usuarios que se mantienen: ${usuarios}`);
  if (datos.envio.length) console.log(`Envíos: ${datos.envio.map((e) => e.folio || `borrador #${e.id}`).join(', ')}`);

  if (!confirmado) {
    console.log(`\nNo se borró nada. Si es correcto, ejecuta de nuevo agregando --confirmar${conDestinatarios ? ' (junto a --con-destinatarios)' : ''}\n`);
    process.exit(0);
  }

  // Respaldo local antes de borrar (contiene datos personales: no se sube al repositorio).
  const dir = path.resolve('respaldos');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `envios-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify({ base: db.host, fecha: new Date().toISOString(), datos }, null, 2));
  console.log(`\nRespaldo guardado en ${archivo}`);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(724103)');
    // La bitácora de pagos es inmutable (trigger): se desactiva solo dentro de esta transacción.
    await c.query('ALTER TABLE pago_evento DISABLE TRIGGER USER');
    for (const [, sql] of PASOS) await c.query(sql);
    await c.query('ALTER TABLE pago_evento ENABLE TRIGGER USER');
    await c.query(`INSERT INTO auditoria (accion, entidad, datos) VALUES ('${conDestinatarios ? 'borrar_envios_y_destinatarios' : 'borrar_envios'}', 'sistema', $1)`,
      [JSON.stringify(Object.fromEntries(PASOS.map(([t]) => [t, datos[t].length])))]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
  const rutas = datos.adjunto.map((a) => a.ruta);
  let borrados = 0;
  try { borrados = await borrarArchivos(rutas); } catch (err) { console.warn(`⚠ No se pudieron borrar los archivos guardados: ${err.message}`); }
  console.log(`✔ Envíos${conDestinatarios ? ', destinatarios y retiros guardados' : ''} borrados. ${borrados} de ${rutas.length} archivo(s) borrados del almacenamiento (${config.almacenamiento.driver}).\n`);
} catch (err) {
  const ayuda = explicarErrorConexion(err);
  console.error(`\n✖ ${err.message}${ayuda ? `\n  👉 ${ayuda}` : ''}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
