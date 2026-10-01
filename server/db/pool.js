import pg from 'pg';
import { config, configBaseDatos } from '../config.js';
import { descubrirPooler, refDeProyecto } from './supabase-pooler.js';

// Los BIGINT/NUMERIC llegan como string: los convertimos a número (montos en CLP caben en JS).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Las fechas (DATE) se mantienen como texto AAAA-MM-DD para no correrlas por zona horaria.
pg.types.setTypeParser(1082, (v) => v);

let actual = null;

function crearPool(db) {
  const p = new pg.Pool({
    connectionString: db.url,
    ssl: db.ssl || undefined,
    max: db.max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  // Un error en una conexión inactiva (p. ej. el pooler de Supabase la cerró) no debe botar el servidor.
  p.on('error', (err) => console.error('[db] conexión inactiva cerrada:', err.message));
  return p;
}

// Prepara la conexión. Si no hay DATABASE_URL pero sí SUPABASE_URL + SUPABASE_DB_PASSWORD,
// busca el Session pooler del proyecto. Devuelve la configuración usada.
export async function conectar() {
  if (actual) return config.db;
  if (config.supabaseDb) {
    const ref = refDeProyecto(config.supabaseDb.supabaseUrl);
    if (!ref) throw new Error('SUPABASE_URL no tiene el formato https://<ref>.supabase.co');
    console.log(`[db] buscando el Session pooler del proyecto Supabase "${ref}"…`);
    const probar = async (url) => {
      const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      try { await c.connect(); await c.query('SELECT 1'); } finally { c.end().catch(() => {}); }
    };
    const encontrado = await descubrirPooler({ ref, password: config.supabaseDb.password, probar });
    config.db = configBaseDatos({ ...process.env, DATABASE_URL: encontrado.url });
    console.log(`[db] pooler encontrado: ${encontrado.host} (región ${encontrado.region}). Puedes fijarlo en DATABASE_URL para arrancar más rápido.`);
  }
  actual = crearPool(config.db);
  return config.db;
}

function obtener() {
  actual ||= crearPool(config.db);
  return actual;
}

// Fachada estable para el resto del código (el pool real se crea al conectar).
export const pool = {
  query: (...args) => obtener().query(...args),
  connect: () => obtener().connect(),
  end: () => (actual ? actual.end() : Promise.resolve()),
};

// Traduce los errores de conexión más comunes a una instrucción concreta.
export function explicarErrorConexion(err) {
  const m = `${err.code || ''} ${err.message || ''}`;
  if (/ENETUNREACH|EHOSTUNREACH/.test(m) || (/ENOTFOUND/.test(m) && /db\..*supabase\.co/.test(config.db.host))) {
    return 'No se alcanza la base. La conexión directa de Supabase es solo IPv6: usa el "Session pooler" (host aws-…pooler.supabase.com, puerto 5432) o define SUPABASE_URL + SUPABASE_DB_PASSWORD sin DATABASE_URL.';
  }
  if (/password authentication failed|28P01/.test(m)) return 'Contraseña de la base incorrecta. Revísala o resetéala en Supabase → Database → Settings. En el pooler el usuario es "postgres.<ref-del-proyecto>".';
  if (/self.signed|certificate/i.test(m)) return 'Problema de certificado SSL. Quita DATABASE_CA_CERT o revisa que sea el certificado de Supabase.';
  if (/no pg_hba|SSL off|requires SSL/i.test(m)) return 'La base exige SSL: define DATABASE_SSL=true.';
  if (/Tenant or user not found/i.test(m)) return 'El usuario del pooler no corresponde al proyecto: debe ser "postgres.<ref-del-proyecto>".';
  if (/ECONNREFUSED/.test(m)) return 'La base no acepta conexiones en ese host/puerto. ¿Está encendida? (Supabase pausa proyectos gratuitos inactivos).';
  if (/timeout/i.test(m)) return 'Tiempo de espera agotado al conectar. Revisa host, puerto y que el proyecto de Supabase no esté pausado.';
  return null;
}

export async function query(texto, params) {
  return pool.query(texto, params);
}

export async function uno(texto, params) {
  const { rows } = await pool.query(texto, params);
  return rows[0] || null;
}

export async function transaccion(fn) {
  const cliente = await pool.connect();
  let roto;
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    // Si la conexión se cortó, el ROLLBACK también falla: se informa el error original (no el del ROLLBACK)
    // y la conexión rota se descarta en vez de devolverla al pool para la siguiente petición.
    await cliente.query('ROLLBACK').catch((e) => { roto = e; });
    throw err;
  } finally {
    cliente.release(roto);
  }
}
