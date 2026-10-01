import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { falla, manejadorErrores } from './lib/http.js';
import { autenticar } from './middleware/auth.js';
import { envios } from './routes/envios.js';
import { auth, demo, usuarios } from './routes/cuentas.js';
import { comunas, configuracion, destinatarios, zonas } from './routes/catalogos.js';
import { adjuntos, auditoria, costos, pagoPublico, pagos, reclamos, reportes } from './routes/operacion.js';
import { paginaQr, seguimiento } from './routes/publico.js';
import { cobranza } from './routes/cobranza.js';
import { seguridad } from './routes/seguridad.js';
import { limitarPeticiones } from './lib/seguridad.js';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = '0.1.0';

function contieneNulo(v, prof = 0) {
  if (typeof v === 'string') return v.includes('\u0000');
  if (v && typeof v === 'object' && prof < 8) return Object.entries(v).some(([k, x]) => k.includes('\u0000') || contieneNulo(x, prof + 1));
  return false;
}

export function crearApp() {
  const app = express();
  app.set('trust proxy', 1); // Railway / Vercel están detrás de un proxy
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", ...config.corsOrigins],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({
    origin: (origen, cb) => cb(null, !origen || config.corsOrigins.includes(origen) || config.corsOrigins.includes('*')),
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Demo-Usuario', 'X-Demo-Rol', 'X-Demo-Clave'],
    // Con la interfaz en otro dominio (Vercel) el navegador solo deja leer estas cabeceras si se exponen:
    // nombre del archivo descargado (CSV, ticket) y cuánto esperar tras el límite de peticiones.
    exposedHeaders: ['Content-Disposition', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  }));
  app.use(compression()); // gzip: la interfaz y los JSON pesan ~70 % menos en 4G
  // Cámara y ubicación solo para la propia app; nada de micrófono, pagos del navegador ni USB.
  app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()'); next(); });

  // Límite de peticiones por IP y por minuto (RNF-16, configurable). En desarrollo el propio equipo solo se mide.
  const soloMedir = (req) => config.entorno !== 'production' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  const limite = (nombre, max) => limitarPeticiones(nombre, max, { soloMedir });
  app.use('/api/auth/login', limite('login', 20));
  app.use(['/api/seguimiento', '/q', '/api/pago-publico'], limite('publico', config.limites.publico));
  app.use('/api', (req, res, next) => (req.is('multipart/form-data') ? limite('subidas', 30)(req, res, next) : next()));
  const limiteApi = limite('api', config.limites.api);
  // El seguimiento público ya tiene su límite más estricto: no se le aplica (ni se le sobrescriben las cabeceras) el general.
  app.use('/api', (req, res, next) => (req.path.startsWith('/seguimiento') || req.path.startsWith('/pago-publico') ? next() : limiteApi(req, res, next)));
  app.use(express.json({ limit: '1mb' }));
  // El carácter nulo (\u0000) no es texto válido para la base: se rechaza en cualquier dato recibido.
  app.use((req, _res, next) => (contieneNulo(req.query) || contieneNulo(req.body) || String(req.path).includes('\u0000')
    ? next(falla(400, 'Los datos contienen caracteres no permitidos')) : next()));

  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try { await pool.query('SELECT 1'); } catch { db = 'error'; }
    res.status(db === 'ok' ? 200 : 503).json({
      ok: db === 'ok', db, version, entorno: config.entorno, auth_mode: config.authMode,
      base: config.db.esSupabase ? 'supabase' : 'postgres', archivos: config.almacenamiento.driver, hora: new Date().toISOString(),
    });
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
  app.use('/api/pago-publico', pagoPublico);
  app.use('/api/reclamos', reclamos);
  app.use('/api/costos', costos);
  app.use('/api/reportes', reportes);
  app.use('/api/cobranza', cobranza);
  app.use('/api/seguridad', seguridad);
  app.use('/api/auditoria', auditoria);
  app.use('/q', paginaQr);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Si el frontend no está en Vercel, Railway lo sirve desde /web en el mismo dominio.
  if (config.servirWeb) {
    app.use(express.static(path.join(raiz, 'web'), { index: 'index.html', extensions: ['html'] }));
  }

  app.use(manejadorErrores);
  return app;
}
