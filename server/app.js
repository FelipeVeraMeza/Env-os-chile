import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { manejadorErrores } from './lib/http.js';
import { autenticar } from './middleware/auth.js';
import { envios } from './routes/envios.js';
import { auth, demo, usuarios } from './routes/cuentas.js';
import { comunas, configuracion, destinatarios, zonas } from './routes/catalogos.js';
import { adjuntos, costos, pagos, reclamos, reportes } from './routes/operacion.js';
import { paginaQr, seguimiento } from './routes/publico.js';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = '0.1.0';

export function crearApp() {
  const app = express();
  app.set('trust proxy', 1); // Railway / Vercel están detrás de un proxy
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...config.corsOrigins],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        mediaSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({
    origin: (origen, cb) => cb(null, !origen || config.corsOrigins.includes(origen) || config.corsOrigins.includes('*')),
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Demo-Usuario', 'X-Demo-Rol'],
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try { await pool.query('SELECT 1'); } catch { db = 'error'; }
    res.status(db === 'ok' ? 200 : 503).json({ ok: db === 'ok', db, version, entorno: config.entorno, auth_mode: config.authMode, hora: new Date().toISOString() });
  });

  app.use('/api/auth', auth);
  app.use('/api/demo', demo);
  app.use('/api/config', configuracion);
  app.use('/api/comunas', comunas);
  app.use('/api/seguimiento', seguimiento);
  app.use('/api/adjuntos', adjuntos);
  app.use('/api/usuarios', usuarios);
  app.use('/api/zonas', zonas);
  app.use('/api/destinatarios', destinatarios);
  app.use('/api/envios', autenticar, envios);
  app.use('/api/pagos', pagos);
  app.use('/api/reclamos', reclamos);
  app.use('/api/costos', costos);
  app.use('/api/reportes', reportes);
  app.use('/q', paginaQr);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Si el frontend no está en Vercel, Railway lo sirve desde /web en el mismo dominio.
  if (config.servirWeb) {
    app.use(express.static(path.join(raiz, 'web'), { index: 'index.html', extensions: ['html'] }));
  }

  app.use(manejadorErrores);
  return app;
}
