// Reinicia la plataforma para empezar de cero: borra TODOS los usuarios, envíos, destinatarios, pagos, reclamos,
// costos, fotos/boletas/comprobantes y bitácoras, y crea el administrador indicado. Conserva las comunas, las
// zonas y la configuración (empresa, tarifas, cuenta para transferencias). Los folios vuelven a ENV-AAAA-000001.
//
// Uso (lee la base desde .env: DATABASE_URL o SUPABASE_URL + SUPABASE_DB_PASSWORD):
//   npm run reiniciar -- --correo admin@empresa.cl --clave "LaClave"              → solo muestra qué se borraría
//   npm run reiniciar -- --correo admin@empresa.cl --clave "LaClave" --confirmar  → borra y crea el administrador
// La contraseña se pasa al ejecutar (no se guarda en el repositorio) y queda cifrada (bcrypt) en la base.
import bcrypt from 'bcryptjs';
import { config } from '../server/config.js';
import { conectar, explicarErrorConexion, pool } from '../server/db/pool.js';
import { borrarArchivos } from '../server/lib/archivos.js';
import { validarClave } from '../server/lib/seguridad.js';

// Tablas con datos de operación (se vacían). comuna, zona, config y schema_migracion se conservan.
const TABLAS = ['usuario', 'destinatario', 'direccion', 'folio_contador', 'envio', 'adjunto', 'envio_estado', 'pago', 'pago_evento',
  'link_pago', 'reclamo_seguro', 'costo', 'auditoria', 'evento_seguridad', 'alerta_seguridad'];

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const confirmado = process.argv.includes('--confirmar');
// --mantener correo: conserva ese administrador tal cual (con su contraseña) en vez de crear uno nuevo.
const mantener = String(arg('mantener') || '').trim().toLowerCase();
const correo = mantener || String(arg('correo') || '').trim().toLowerCase();
const clave = String(arg('clave') || '');
const nombre = String(arg('nombre') || 'Administración').trim();

function salir(mensaje) {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) salir('Indica el correo del administrador: --correo admin@empresa.cl (o --mantener admin@empresa.cl)');
if (!mantener && clave.length < 8) salir('Indica la contraseña del administrador (8 caracteres o más): --clave "LaClave"');
const debilidad = mantener ? null : validarClave(clave, { correo, nombre });

try {
  const db = await conectar();
  const { rows: existentes } = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)', [TABLAS]);
  const tablas = TABLAS.filter((t) => existentes.some((e) => e.tablename === t));
  const conteo = {};
  for (const t of tablas) conteo[t] = (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;

  console.log(`\nBase de datos: ${db.host || 'local'}${db.esSupabase ? ' (Supabase)' : ''}`);
  console.log(`Se borrarán: ${conteo.usuario ?? 0} usuarios, ${conteo.envio ?? 0} envíos, ${conteo.pago ?? 0} pagos, ${conteo.adjunto ?? 0} archivos,`);
  console.log(`             ${conteo.reclamo_seguro ?? 0} reclamos, ${conteo.costo ?? 0} costos, ${conteo.destinatario ?? 0} destinatarios y las bitácoras.`);
  console.log('Se conservan: comunas, zonas, tarifas, datos de la empresa y cuenta para transferencias.');
  let conservado = null;
  if (mantener) {
    conservado = (await pool.query("SELECT id, nombre, correo FROM usuario WHERE correo = $1 AND rol = 'admin' AND activo AND password_hash IS NOT NULL", [correo])).rows[0];
    if (!conservado) salir(`No existe un administrador activo con contraseña y correo ${correo}: no se puede conservar`);
    console.log(`Administrador que se conserva (con su contraseña actual): ${conservado.nombre} <${conservado.correo}>`);
    const otros = (await pool.query('SELECT correo, rol FROM usuario WHERE id <> $1 ORDER BY id', [conservado.id])).rows;
    if (otros.length) console.log(`Usuarios que se borran: ${otros.map((u) => `${u.correo} (${u.rol})`).join(', ')}`);
  } else {
    console.log(`Administrador que se creará: ${nombre} <${correo}>`);
  }
  if (debilidad) console.log(`⚠ La contraseña no cumple la política de la plataforma (${debilidad.toLowerCase()}). Cámbiala en "Mi cuenta" apenas entres.`);

  if (!confirmado) {
    console.log('\nNo se borró nada. Si es correcto, vuelve a ejecutar el mismo comando agregando --confirmar\n');
    process.exit(0);
  }

  const rutas = (await pool.query('SELECT ruta FROM adjunto')).rows.map((r) => r.ruta);
  const hash = mantener ? null : await bcrypt.hash(clave, 10);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock(724102)');
    // Las bitácoras son inmutables (triggers): se desactivan solo dentro de esta transacción para vaciarlas.
    // Si algo falla, el ROLLBACK deja todo como estaba, triggers incluidos.
    for (const t of tablas) await cliente.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    let admin;
    if (conservado) {
      // Se vacía todo menos la tabla de usuarios, y de ella se borran todos salvo el administrador conservado.
      const sinUsuario = tablas.filter((t) => t !== 'usuario');
      await cliente.query(`TRUNCATE ${sinUsuario.join(', ')} RESTART IDENTITY`);
      await cliente.query('DELETE FROM usuario WHERE id <> $1', [conservado.id]);
      admin = conservado;
    } else {
      await cliente.query(`TRUNCATE ${tablas.join(', ')} RESTART IDENTITY CASCADE`);
      ({ rows: [admin] } = await cliente.query(
        `INSERT INTO usuario (nombre, correo, password_hash, rol, password_cambiado_en) VALUES ($1, $2, $3, 'admin', now()) RETURNING id`,
        [nombre, correo, hash]));
    }
    for (const t of tablas) await cliente.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
    // El reinicio queda como primer registro de la nueva bitácora.
    await cliente.query(
      "INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, datos) VALUES ($1, 'reiniciar_datos', 'sistema', NULL, $2)",
      [admin.id, JSON.stringify({ borrados: conteo, administrador: correo })]);
    await cliente.query(
      "INSERT INTO evento_seguridad (tipo, nivel, usuario_id, correo, detalle) VALUES ('reinicio_datos', 'alerta', $1, $2, $3)",
      [admin.id, correo, JSON.stringify({ borrados: conteo, via: 'scripts/reiniciar-datos.js' })]);
    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }

  let archivos = 0;
  try {
    archivos = await borrarArchivos(rutas);
  } catch (err) {
    console.warn(`⚠ Los datos se borraron, pero no se pudieron borrar los archivos guardados: ${err.message}`);
  }
  console.log(`\n✔ Plataforma reiniciada. ${archivos} de ${rutas.length} archivo(s) borrados del almacenamiento (${config.almacenamiento.driver}).`);
  console.log(`✔ Entra con ${correo} y ${mantener ? 'su contraseña de siempre' : 'la contraseña indicada'}. Con AUTH_MODE=jwt los clientes crean su cuenta en "Crear cuenta de cliente".\n`);
} catch (err) {
  const ayuda = explicarErrorConexion(err);
  salir(`${err.message}${ayuda ? `\n  👉 ${ayuda}` : ''}`);
} finally {
  await pool.end();
}
