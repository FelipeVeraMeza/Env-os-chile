import fs from 'node:fs/promises';
import { config } from './config.js';
import { crearApp } from './app.js';
import { migrar } from './db/migrate.js';
import { sembrar } from './db/seed.js';

async function iniciar() {
  await fs.mkdir(config.uploadDir, { recursive: true });
  await migrar();
  await sembrar();
  crearApp().listen(config.puerto, () => {
    console.log(`[api] escuchando en ${config.publicBaseUrl} (puerto ${config.puerto}, modo ${config.authMode})`);
  });
}

iniciar().catch((err) => {
  console.error('[api] no se pudo iniciar:', err);
  process.exit(1);
});
