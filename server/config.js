import 'dotenv/config';
import path from 'node:path';

const entorno = process.env.NODE_ENV || 'development';

const publicBaseUrl = (process.env.PUBLIC_BASE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)).replace(/\/+$/, '');

// Conexión a PostgreSQL (local, Railway o Supabase).
// Supabase exige SSL: se activa solo si la URL es de Supabase o si DATABASE_SSL=true.
// Se quita "sslmode" de la URL porque las versiones nuevas de pg lo tratan como verify-full
// y rechazan el certificado de Supabase si no se entrega su CA (DATABASE_CA_CERT).
export function configBaseDatos(env) {
  const original = env.DATABASE_URL || 'postgres://envios:envios@localhost:5432/envios';
  let url = original;
  let host = '';
  let sslmodeUrl = null;
  try {
    const u = new URL(original);
    host = u.hostname;
    sslmodeUrl = u.searchParams.get('sslmode');
    u.searchParams.delete('sslmode');
    url = u.toString();
  } catch { /* URL no estándar: se usa tal cual */ }
  const esSupabase = /supabase\.(co|com)$/i.test(host);
  const pedido = env.DATABASE_SSL ?? (sslmodeUrl && sslmodeUrl !== 'disable' ? 'true' : null);
  const usarSsl = pedido === 'true' || (pedido == null && esSupabase);
  let ssl = false;
  if (usarSsl) {
    const ca = env.DATABASE_CA_CERT ? env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : null;
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  const pooler = /pooler\.supabase\.com$/i.test(host);
  return {
    url,
    host,
    ssl,
    esSupabase,
    pooler,
    // Supabase (plan gratuito) limita conexiones: pool pequeño por defecto.
    max: Number(env.DB_POOL_MAX || (esSupabase ? 5 : 10)),
  };
}

// Clave secreta de Supabase (nueva "sb_secret_…" o la antigua "service_role"). Nunca va al navegador.
const claveSupabase = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function lista(valor, porDefecto) {
  return (valor || porDefecto).split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  entorno,
  puerto: Number(process.env.PORT || 3000),
  db: configBaseDatos(process.env),
  // Alternativa a DATABASE_URL: con la URL del proyecto y la contraseña de la base, el servidor
  // encuentra solo el Session pooler de Supabase (ver server/db/supabase-pooler.js).
  supabaseDb: !process.env.DATABASE_URL && process.env.SUPABASE_URL && process.env.SUPABASE_DB_PASSWORD
    ? { supabaseUrl: process.env.SUPABASE_URL, password: process.env.SUPABASE_DB_PASSWORD }
    : null,
  // URL pública del backend. Se usa en los QR. En Railway se toma sola de RAILWAY_PUBLIC_DOMAIN.
  publicBaseUrl,
  // Orígenes permitidos para el frontend (ej. el dominio de Vercel). La URL pública siempre se incluye.
  corsOrigins: [...new Set([publicBaseUrl, ...lista(process.env.CORS_ORIGINS, 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000')])],
  // Clave opcional para que la demo publicada no quede abierta a cualquiera.
  demoClave: process.env.DEMO_CLAVE || '',
  almacenamiento: {
    // local = disco (UPLOAD_DIR) · supabase = Supabase Storage (bucket privado)
    driver: process.env.STORAGE_DRIVER || (process.env.SUPABASE_URL && claveSupabase ? 'supabase' : 'local'),
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseKey: claveSupabase,
    // Si hay dos claves (nueva sb_secret_ y antigua service_role) se usa la primera que funcione.
    clavesAlternativas: [process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean),
    bucket: process.env.SUPABASE_BUCKET || 'envios-privado',
  },
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
  console.warn(`[seguridad] AUTH_MODE=demo: la API no exige inicio de sesión${config.demoClave ? ' (protegida con DEMO_CLAVE)' : ''}. No usar con datos reales.`);
}
if (config.almacenamiento.driver === 'local' && entorno === 'production' && !process.env.UPLOAD_DIR) {
  console.warn('[archivos] Fotos y boletas en disco local: se pierden en cada despliegue. Configura Supabase Storage (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY) o un Volume de Railway.');
}
