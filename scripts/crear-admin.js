// Crea un administrador SIN borrar nada (a diferencia de "npm run reiniciar"). Sirve cuando nadie puede entrar como
// administrador o para dar acceso a otra persona desde el computador. Lee la base desde .env (DATABASE_URL o
// SUPABASE_URL + SUPABASE_DB_PASSWORD).
//
// Uso:
//   npm run crear-admin -- --correo ana@empresa.cl --nombre "Ana Pérez"
//       → genera una contraseña temporal (se muestra una sola vez) y pide cambiarla al primer ingreso
//   npm run crear-admin -- --correo ana@empresa.cl --nombre "Ana Pérez" --clave "SuClave2026"
//       → usa esa contraseña (debe cumplir la política de la plataforma)
//   npm run crear-admin -- --correo ana@empresa.cl --promover
//       → si ya tiene cuenta (cliente o repartidor), la convierte en administrador y la reactiva
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { conectar, explicarErrorConexion, pool } from '../server/db/pool.js';
import { validarClave } from '../server/lib/seguridad.js';

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const correo = String(arg('correo') || '').trim().toLowerCase();
const nombre = String(arg('nombre') || 'Administración').trim();
const claveDada = arg('clave');
const promover = process.argv.includes('--promover');

function salir(mensaje) {
  console.error(`\n✖ ${mensaje}\n`);
  process.exit(1);
}

// Contraseña temporal que cumple la política (largo, letras y números, no común, sin el correo ni el nombre).
function claveTemporal() {
  for (;;) {
    const c = `Opt-${crypto.randomBytes(9).toString('base64url')}${crypto.randomInt(10, 99)}`;
    if (!validarClave(c, { correo, nombre })) return c;
  }
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) salir('Indica el correo: --correo ana@empresa.cl');
if (nombre.length < 2) salir('Indica el nombre: --nombre "Ana Pérez"');
if (claveDada !== undefined) {
  const debilidad = validarClave(String(claveDada), { correo, nombre });
  if (debilidad) salir(`La contraseña no cumple la política: ${debilidad.toLowerCase()}`);
}

try {
  const db = await conectar();
  console.log(`\nBase de datos: ${db.host || 'local'}${db.esSupabase ? ' (Supabase)' : ''}`);
  const existente = (await pool.query('SELECT id, nombre, rol, activo FROM usuario WHERE correo = $1', [correo])).rows[0];
  const temporal = claveDada === undefined && !(existente && promover) ? claveTemporal() : null;
  const clave = claveDada ?? temporal;
  let usuario;
  if (existente) {
    if (existente.rol === 'admin' && existente.activo && !claveDada) salir(`${correo} ya es administrador. Si olvidó su contraseña, usa "¿Olvidaste tu contraseña?" o agrega --promover --clave "NuevaClave".`);
    if (!promover) salir(`Ya existe una cuenta con ${correo} (${existente.rol}${existente.activo ? '' : ', desactivada'}). Agrega --promover para convertirla en administrador.`);
    const hash = clave ? await bcrypt.hash(String(clave), 10) : null;
    usuario = (await pool.query(
      `UPDATE usuario SET rol = 'admin', activo = TRUE,
         password_hash = COALESCE($2, password_hash), debe_cambiar_clave = CASE WHEN $2::text IS NULL THEN debe_cambiar_clave ELSE $3 END,
         password_cambiado_en = CASE WHEN $2::text IS NULL THEN password_cambiado_en ELSE now() END
       WHERE id = $1 RETURNING id, nombre, correo`, [existente.id, hash, Boolean(temporal)])).rows[0];
    console.log(`✔ ${usuario.nombre} <${usuario.correo}> ahora es administrador (antes: ${existente.rol}).`);
  } else {
    usuario = (await pool.query(
      `INSERT INTO usuario (nombre, correo, password_hash, rol, debe_cambiar_clave, password_cambiado_en)
       VALUES ($1, $2, $3, 'admin', $4, now()) RETURNING id, nombre, correo`,
      [nombre, correo, await bcrypt.hash(String(clave), 10), Boolean(temporal)])).rows[0];
    console.log(`✔ Administrador creado: ${usuario.nombre} <${usuario.correo}>`);
  }
  // Queda registrado en la auditoría y en el panel de Seguridad (un administrador nuevo es un cambio sensible).
  await pool.query("INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, datos) VALUES (NULL, 'crear_admin_consola', 'usuario', $1, $2)",
    [String(usuario.id), JSON.stringify({ correo, promovido: Boolean(existente) })]);
  await pool.query("INSERT INTO evento_seguridad (tipo, nivel, correo, detalle) VALUES ('admin_creado_consola', 'alerta', $1, $2)",
    [correo, JSON.stringify({ usuario_id: usuario.id, promovido: Boolean(existente) })]).catch(() => {});
  if (temporal) {
    console.log(`\n  Contraseña temporal (se muestra solo esta vez): ${temporal}`);
    console.log('  Al entrar por primera vez, la plataforma pedirá cambiarla.\n');
  } else console.log('');
} catch (err) {
  console.error(`\n✖ ${explicarErrorConexion(err) || err.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
