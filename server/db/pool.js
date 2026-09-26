import pg from 'pg';
import { config } from '../config.js';

// Los BIGINT/NUMERIC llegan como string: los convertimos a número (montos en CLP caben en JS).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Las fechas (DATE) se mantienen como texto AAAA-MM-DD para no correrlas por zona horaria.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

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
