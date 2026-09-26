import 'dotenv/config';
import path from 'node:path';

const entorno = process.env.NODE_ENV || 'development';

function lista(valor, porDefecto) {
  return (valor || porDefecto).split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  entorno,
  puerto: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://envios:envios@localhost:5432/envios',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // URL pública del backend (Railway o localhost). Se usa para el QR y los enlaces firmados.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  // Orígenes permitidos para el frontend (ej. el dominio de Vercel).
  corsOrigins: lista(process.env.CORS_ORIGINS, 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000'),
  // demo = sin inicio de sesión, se elige el rol desde la interfaz. jwt = inicio de sesión real.
  authMode: process.env.AUTH_MODE || 'demo',
  jwtSecret: process.env.JWT_SECRET || 'solo-para-desarrollo-cambiar',
  jwtDias: Number(process.env.JWT_DIAS || 30),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 10),
  admin: {
    correo: process.env.ADMIN_EMAIL || 'admin@envios.local',
    password: process.env.ADMIN_PASSWORD || 'Cambiar.Esta.Clave.2026',
  },
  sembrarDemo: process.env.SEED_DEMO !== 'false',
  servirWeb: process.env.SERVE_WEB !== 'false',
};

if (entorno === 'production' && config.jwtSecret === 'solo-para-desarrollo-cambiar') {
  console.warn('[seguridad] JWT_SECRET no está definido en producción. Defínelo en las variables de Railway.');
}
if (config.authMode === 'demo') {
  console.warn('[seguridad] AUTH_MODE=demo: la API no exige inicio de sesión. No usar con datos reales.');
}
