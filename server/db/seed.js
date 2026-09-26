import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';
import { listarComunas } from './data/comunas.js';
import { CONFIG_POR_DEFECTO } from '../lib/reglas.js';

// Carga inicial idempotente: comunas, zona Santiago, configuración y usuarios.
export async function sembrar() {
  const { rows: [{ n: nComunas }] } = await pool.query('SELECT count(*)::int AS n FROM comuna');
  if (nComunas === 0) {
    const { rows: [zona] } = await pool.query(
      `INSERT INTO zona (nombre, tarifa, color, orden) VALUES ('Santiago', $1, '#1d4ed8', 1)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
      [CONFIG_POR_DEFECTO.tarifas.base],
    );
    for (const c of listarComunas()) {
      await pool.query(
        'INSERT INTO comuna (nombre, provincia, region, zona_id, en_cobertura) VALUES ($1, $2, $3, $4, $5)',
        [c.nombre, c.provincia, c.region, c.enCobertura ? zona.id : null, c.enCobertura],
      );
    }
    console.log('[db] 346 comunas cargadas');
  }

  for (const [clave, valor] of Object.entries(CONFIG_POR_DEFECTO)) {
    await pool.query('INSERT INTO config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING', [clave, JSON.stringify(valor)]);
  }

  const { rows: [{ n: nUsuarios }] } = await pool.query('SELECT count(*)::int AS n FROM usuario');
  if (nUsuarios === 0) {
    const hash = await bcrypt.hash(config.admin.password, 10);
    await pool.query(
      `INSERT INTO usuario (nombre, correo, password_hash, rol) VALUES ('Administración', $1, $2, 'admin')`,
      [config.admin.correo.toLowerCase(), hash],
    );
    if (config.sembrarDemo) await sembrarDemo();
    console.log('[db] usuarios iniciales creados');
  }
}

async function sembrarDemo() {
  const hash = await bcrypt.hash('Demo.2026', 10);
  const usuarios = [
    ['Camila Rojas (cliente demo)', 'cliente@demo.cl', 'cliente', '+56 9 1111 2222'],
    ['Tienda Los Aromos (cliente demo)', 'tienda@demo.cl', 'cliente', '+56 9 3333 4444'],
    ['Diego Muñoz (repartidor demo)', 'repartidor@demo.cl', 'repartidor', '+56 9 5555 6666'],
    ['Valentina Soto (repartidora demo)', 'repartidora@demo.cl', 'repartidor', '+56 9 7777 8888'],
  ];
  for (const [nombre, correo, rol, telefono] of usuarios) {
    await pool.query(
      'INSERT INTO usuario (nombre, correo, password_hash, rol, telefono) VALUES ($1, $2, $3, $4, $5)',
      [nombre, correo, hash, rol, telefono],
    );
  }
}
