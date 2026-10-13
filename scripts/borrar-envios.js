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
//   npm run borrar-envios -- --folios ENV-2026-000001,ENV-2026-000002 [--confirmar]
//       → solo esos envíos (p. ej. pruebas): los demás, los destinatarios y el contador de folios no se tocan (13-10)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { conectar, explicarErrorConexion, pool } from '../server/db/pool.js';
import { borrarArchivos } from '../server/lib/archivos.js';

const confirmado = process.argv.includes('--confirmar');
const conDestinatarios = process.argv.includes('--con-destinatarios');
const iFolios = process.argv.indexOf('--folios');
const folios = iFolios > -1 ? [...new Set(String(process.argv[iFolios + 1] || '').split(',').map((f) => f.trim().toUpperCase()).filter(Boolean))] : null;
// En orden: primero lo que apunta a otras tablas, al final los envíos.
const PASOS_TODOS = [
  ['costo', 'DELETE FROM costo WHERE envio_id IS NOT NULL OR pago_id IS NOT NULL OR reclamo_id IS NOT NULL'],
  ['pago_evento', 'DELETE FROM pago_evento'],
  ['link_pago', 'DELETE FROM link_pago'],
  ['reclamo_seguro', 'DELETE FROM reclamo_seguro'],
  ['envio_estado', 'DELETE FROM envio_estado'],
  ['pago', 'DELETE FROM pago'],
  ['adjunto', 'DELETE FROM adjunto'],
  ['envio', 'DELETE FROM envio'],
  // Solo el contador de los envíos: los pedidos de bolsas se conservan y sus folios BOL no deben repetirse.
  ['folio_contador', "DELETE FROM folio_contador WHERE prefijo = 'ENV'"],
  // Después de los envíos (que apuntan a ellas): direcciones, destinatarios y el retiro guardado de cada cliente.
  ...(conDestinatarios ? [
    ['direccion', 'DELETE FROM direccion'],
    ['destinatario', 'DELETE FROM destinatario'],
    ['retiro_guardado', `UPDATE usuario SET retiro_calle = NULL, retiro_numero = NULL, retiro_depto = NULL, retiro_referencia = NULL,
       retiro_comuna_id = NULL WHERE retiro_calle IS NOT NULL OR retiro_comuna_id IS NOT NULL`],
  ] : []),
];
// Solo algunos envíos ($1 = sus id): mismo orden; el contador de folios no se toca (los folios no se repiten).
const DE_PAGOS = 'SELECT id FROM pago WHERE envio_id = ANY($1)';
const PASOS_FOLIOS = [
  ['costo', `envio_id = ANY($1) OR pago_id IN (${DE_PAGOS}) OR reclamo_id IN (SELECT id FROM reclamo_seguro WHERE envio_id = ANY($1))`],
  ['pago_evento', `pago_id IN (${DE_PAGOS})`],
  ['link_pago', 'envio_id = ANY($1)'],
  ['reclamo_seguro', 'envio_id = ANY($1)'],
  ['envio_estado', 'envio_id = ANY($1)'],
  ['pago', 'envio_id = ANY($1)'],
  ['adjunto', 'envio_id = ANY($1)'],
  ['envio', 'id = ANY($1)'],
].map(([tabla, cond]) => [tabla, `DELETE FROM ${tabla} WHERE ${cond}`, `SELECT * FROM ${tabla} WHERE ${cond}`]);
const PASOS = folios ? PASOS_FOLIOS : PASOS_TODOS;
const SELECCION = {
  costo: 'SELECT * FROM costo WHERE envio_id IS NOT NULL OR pago_id IS NOT NULL OR reclamo_id IS NOT NULL',
  folio_contador: "SELECT * FROM folio_contador WHERE prefijo = 'ENV'",
  retiro_guardado: `SELECT id, retiro_calle, retiro_numero, retiro_depto, retiro_referencia, retiro_comuna_id FROM usuario
    WHERE retiro_calle IS NOT NULL OR retiro_comuna_id IS NOT NULL`,
};

try {
  if (folios && (!folios.length || conDestinatarios)) throw new Error('Usa --folios ENV-AAAA-NNNNNN,ENV-… (sin --con-destinatarios)');
  const db = await conectar();
  let ids = [];
  if (folios) {
    const { rows } = await pool.query('SELECT id, folio FROM envio WHERE folio = ANY($1)', [folios]);
    const faltan = folios.filter((f) => !rows.some((r) => r.folio === f));
    if (faltan.length) throw new Error(`No existen estos folios: ${faltan.join(', ')}. No se borró nada.`);
    ids = rows.map((r) => r.id);
    // Un comprobante pagado en carrito queda en uno de los envíos: si lo usa un envío que se conserva, no se borra nada.
    const { rows: compartidos } = await pool.query(
      `SELECT a.id FROM adjunto a WHERE a.envio_id = ANY($1) AND (
         EXISTS (SELECT 1 FROM pago p WHERE p.comprobante_adjunto_id = a.id AND NOT p.envio_id = ANY($1))
         OR EXISTS (SELECT 1 FROM reclamo_seguro r WHERE r.boleta_adjunto_id = a.id AND NOT r.envio_id = ANY($1)))`, [ids]);
    if (compartidos.length) throw new Error('Algún comprobante de estos envíos también paga otros envíos que se conservan: bórralos juntos. No se borró nada.');
  }
  const datos = {};
  for (const [tabla, , sel] of PASOS) datos[tabla] = (await pool.query(sel || SELECCION[tabla] || `SELECT * FROM ${tabla}`, folios ? [ids] : [])).rows;
  if (folios) {
    const { n } = (await pool.query('SELECT count(*)::int AS n FROM envio WHERE NOT id = ANY($1)', [ids])).rows[0];
    console.log(`\nSolo los envíos: ${folios.join(', ')}. Se conservan los otros ${n} envíos, usuarios, destinatarios, configuración, tarifas, comunas, bitácoras y el contador de folios.`);
  }
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
    for (const [, sql] of PASOS) await c.query(sql, folios ? [ids] : []);
    await c.query('ALTER TABLE pago_evento ENABLE TRIGGER USER');
    await c.query(`INSERT INTO auditoria (accion, entidad, datos) VALUES ('${folios ? 'borrar_envios_por_folio' : conDestinatarios ? 'borrar_envios_y_destinatarios' : 'borrar_envios'}', 'sistema', $1)`,
      [JSON.stringify({ ...Object.fromEntries(PASOS.map(([t]) => [t, datos[t].length])), ...(folios ? { folios } : {}) })]);
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
