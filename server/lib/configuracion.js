import { query } from '../db/pool.js';
import { CONFIG_POR_DEFECTO } from './reglas.js';

// Lee la configuración combinando los valores por defecto con lo guardado en la base.
export async function leerConfig() {
  const { rows } = await query('SELECT clave, valor FROM config');
  const conf = structuredClone(CONFIG_POR_DEFECTO);
  for (const { clave, valor } of rows) {
    conf[clave] = typeof valor === 'object' && !Array.isArray(valor) ? { ...(conf[clave] || {}), ...valor } : valor;
  }
  return conf;
}
