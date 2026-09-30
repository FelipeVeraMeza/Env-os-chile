import bcrypt from 'bcryptjs';
import { transaccion } from './pool.js';
import { config } from '../config.js';
import { listarComunas } from './data/comunas.js';
import { CONFIG_POR_DEFECTO } from '../lib/reglas.js';

// Carga inicial idempotente: comunas, zona Santiago, configuración y usuarios.
// Todo en una transacción con bloqueo para que dos instancias no la ejecuten a la vez.
export async function sembrar() {
  await transaccion(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(724101)');

    const { rows: [{ n: nComunas }] } = await db.query('SELECT count(*)::int AS n FROM comuna');
    if (nComunas === 0) {
      const { rows: [zona] } = await db.query(
        `INSERT INTO zona (nombre, tarifa, color, orden) VALUES ('Santiago', $1, '#1d4ed8', 1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
        [CONFIG_POR_DEFECTO.tarifas.base],
      );
      const c = listarComunas();
      // Un solo INSERT: con la base remota (Supabase) 346 inserciones sueltas tardarían mucho.
      await db.query(
        `INSERT INTO comuna (nombre, provincia, region, zona_id, en_cobertura)
         SELECT n, p, r, CASE WHEN cob THEN $5::int END, cob
         FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[]) AS t(n, p, r, cob)`,
        [c.map((x) => x.nombre), c.map((x) => x.provincia), c.map((x) => x.region), c.map((x) => x.enCobertura), zona.id],
      );
      console.log(`[db] ${c.length} comunas cargadas`);
    }

    for (const [clave, valor] of Object.entries(CONFIG_POR_DEFECTO)) {
      await db.query('INSERT INTO config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING', [clave, JSON.stringify(valor)]);
    }

    const { rows: [{ n: nUsuarios }] } = await db.query('SELECT count(*)::int AS n FROM usuario');
    if (nUsuarios === 0) {
      if (!config.admin.correo || !config.admin.password) {
        throw Object.assign(new Error('la base no tiene usuarios y no hay un administrador para crear'), {
          ayuda: 'Define ADMIN_EMAIL y ADMIN_PASSWORD en Railway solo para este primer arranque (luego puedes borrarlas), o crea el administrador con: npm run reiniciar -- --correo … --clave … --confirmar',
        });
      }
      const hash = await bcrypt.hash(config.admin.password, 10);
      await db.query(
        `INSERT INTO usuario (nombre, correo, password_hash, rol) VALUES ('Administración', $1, $2, 'admin')`,
        [config.admin.correo.toLowerCase(), hash],
      );
      if (config.sembrarDemo) await sembrarDemo(db);
      console.log(`[db] usuarios iniciales creados (admin: ${config.admin.correo})`);
    }
  });
}

export const CLAVE_DEMO_PUBLICA = 'Demo.2026';

// Con inicio de sesión real en producción, las cuentas demo que siguen con la contraseña pública
// (escrita en el repositorio) quedan sin contraseña: no se puede entrar con ellas. Sus envíos se conservan
// y administración puede asignarles una contraseña nueva si quiere seguir usándolas.
export async function cerrarCuentasDemo() {
  const { rows } = await transaccion((db) => db.query("SELECT id, correo, password_hash FROM usuario WHERE correo LIKE '%@demo.cl' AND password_hash IS NOT NULL"));
  const expuestas = [];
  for (const u of rows) if (await bcrypt.compare(CLAVE_DEMO_PUBLICA, u.password_hash)) expuestas.push(u);
  if (!expuestas.length) return 0;
  await transaccion((db) => db.query('UPDATE usuario SET password_hash = NULL, sesion_version = sesion_version + 1 WHERE id = ANY($1)', [expuestas.map((u) => u.id)]));
  console.warn(`[seguridad] ${expuestas.length} cuenta(s) demo con contraseña pública quedaron sin acceso: ${expuestas.map((u) => u.correo).join(', ')}`);
  return expuestas.length;
}

async function sembrarDemo(db) {
  const hash = await bcrypt.hash(CLAVE_DEMO_PUBLICA, 10);
  const usuarios = [
    ['Camila Rojas (cliente demo)', 'cliente@demo.cl', 'cliente', '+56 9 1111 2222'],
    ['Tienda Los Aromos (cliente demo)', 'tienda@demo.cl', 'cliente', '+56 9 3333 4444'],
    ['Diego Muñoz (repartidor demo)', 'repartidor@demo.cl', 'repartidor', '+56 9 5555 6666'],
    ['Valentina Soto (repartidora demo)', 'repartidora@demo.cl', 'repartidor', '+56 9 7777 8888'],
  ];
  for (const [nombre, correo, rol, telefono] of usuarios) {
    await db.query(
      'INSERT INTO usuario (nombre, correo, password_hash, rol, telefono) VALUES ($1, $2, $3, $4, $5)',
      [nombre, correo, hash, rol, telefono],
    );
  }
}
