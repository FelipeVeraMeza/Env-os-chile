import pg from 'pg';
import { config } from '../config.js';

// Los BIGINT/NUMERIC llegan como string: los convertimos a número (montos en CLP caben en JS).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Las fechas (DATE) se mantienen como texto AAAA-MM-DD para no correrlas por zona horaria.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl || undefined,
  max: config.db.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

// Un error en una conexión inactiva (p. ej. el pooler de Supabase la cerró) no debe botar el servidor.
pool.on('error', (err) => console.error('[db] conexión inactiva cerrada:', err.message));

// Traduce los errores de conexión más comunes a una instrucción concreta.
export function explicarErrorConexion(err) {
  const m = `${err.code || ''} ${err.message || ''}`;
  if (/ENETUNREACH|EHOSTUNREACH/.test(m) || (/ENOTFOUND/.test(m) && /db\..*supabase\.co/.test(config.db.host))) {
    return 'No se alcanza la base. La conexión directa de Supabase es solo IPv6: usa el "Session pooler" (host aws-…pooler.supabase.com, puerto 5432).';
  }
  if (/password authentication failed|28P01/.test(m)) return 'Usuario o contraseña de la base incorrectos. En el pooler el usuario es "postgres.<ref-del-proyecto>".';
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
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}
