import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Aplica en orden los archivos .sql que aún no se han ejecutado.
export async function migrar() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migracion (
    nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await pool.query('SELECT nombre FROM schema_migracion');
  const aplicadas = new Set(rows.map((r) => r.nombre));
  const archivos = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = await fs.readFile(path.join(dir, archivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      // Evita que dos instancias (p. ej. durante un redespliegue) apliquen la misma migración.
      await cliente.query('SELECT pg_advisory_xact_lock(724100)');
      const ya = await cliente.query('SELECT 1 FROM schema_migracion WHERE nombre = $1', [archivo]);
      if (ya.rowCount) { await cliente.query('ROLLBACK'); continue; }
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migracion (nombre) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      console.log(`[db] migración aplicada: ${archivo}`);
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    } finally {
      cliente.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrar()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
