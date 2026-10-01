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

// Número desde una variable de entorno: vacía o inválida usa el valor por defecto (nunca NaN ni 0 por accidente).
export function numeroEnv(valor, porDefecto, { min = 0 } = {}) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) && n >= min ? n : porDefecto;
}

// Orígenes permitidos para la interfaz (CORS). Sin barra final: el navegador envía el origen sin ella
// ("https://x.vercel.app"), y con "https://x.vercel.app/" no calzaba nunca. La URL pública siempre se incluye.
export function origenesCors(env, base) {
  return [...new Set([base, ...lista(env.CORS_ORIGINS, 'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000').map((o) => o.replace(/\/+$/, ''))])];
}

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
  corsOrigins: origenesCors(process.env, publicBaseUrl),
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
  jwtDias: numeroEnv(process.env.JWT_DIAS, 30, { min: 1 }),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  maxUploadMb: numeroEnv(process.env.MAX_UPLOAD_MB, 10, { min: 1 }),
  // Solo para crear el primer administrador cuando la base no tiene usuarios. Después las cuentas viven en la base
  // (contraseña cifrada) y estas variables se pueden borrar. En producción no hay valores de respaldo.
  admin: {
    correo: process.env.ADMIN_EMAIL || (entorno === 'production' ? null : 'admin@envios.local'),
    password: process.env.ADMIN_PASSWORD || (entorno === 'production' ? null : 'Cambiar.Esta.Clave.2026'),
  },
  sembrarDemo: process.env.SEED_DEMO !== 'false',
  // Solicitudes por minuto y por IP (RNF-16). 0 desactiva el límite (no recomendado).
  limites: {
    api: numeroEnv(process.env.LIMITE_API_POR_MINUTO, 600),
    publico: numeroEnv(process.env.LIMITE_PUBLICO_POR_MINUTO, 60),
  },
  servirWeb: process.env.SERVE_WEB !== 'false',
};

// Firmas de sesión: con inicio de sesión real, la clave secreta no puede ser corta ni un valor de ejemplo conocido
// (con una clave conocida cualquiera podría fabricar una sesión de administrador). Aplica aunque falte NODE_ENV.
const CLAVES_CONOCIDAS = ['solo-para-desarrollo-cambiar', 'cambia-esto-por-una-cadena-larga-y-aleatoria', 'CAMBIAR_POR_UNA_CADENA_LARGA_ALEATORIA'];
export function validarSecreto(env) {
  // Se mira el nombre del servidor (no el texto completo): "https://localhost.atacante.cl" no es este equipo.
  let host = '';
  try { host = new URL(env.PUBLIC_BASE_URL || 'http://localhost').hostname; } catch { host = ''; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host) && !env.RAILWAY_PUBLIC_DOMAIN;
  if ((env.AUTH_MODE || 'demo') !== 'jwt' || local) return null;
  const s = env.JWT_SECRET || '';
  if (s.length < 32 || CLAVES_CONOCIDAS.includes(s)) return 'JWT_SECRET: con AUTH_MODE=jwt fuera de este equipo se necesita una clave propia de 32 caracteres o más (npm run secreto)';
  return null;
}

// En producción no se aceptan valores de respaldo: el servidor no arranca si falta algo crítico.
// Devuelve la lista de problemas (vacía si todo está bien).
export function validarProduccion(env) {
  const secreto = validarSecreto(env);
  if ((env.NODE_ENV || 'development') !== 'production') return secreto ? [secreto] : [];
  const faltan = [];
  // Textos de ejemplo de las plantillas (.env.railway.example / guía) que quedaron sin reemplazar.
  const plantilla = /PEGAR_AQUI|CAMBIAR|TU_REF|LA_CLAVE_DE_LA_BASE/i;
  const sinReemplazar = ['SUPABASE_URL', 'SUPABASE_DB_PASSWORD', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL',
    'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'DEMO_CLAVE'].filter((k) => plantilla.test(env[k] || ''));
  if (sinReemplazar.length) {
    faltan.push(`Valores de ejemplo sin reemplazar (PEGAR_AQUI/CAMBIAR…): ${sinReemplazar.join(', ')}`);
  }
  if (!env.DATABASE_URL && !(env.SUPABASE_URL && env.SUPABASE_DB_PASSWORD)) {
    faltan.push('Base de datos: define SUPABASE_URL + SUPABASE_DB_PASSWORD (o DATABASE_URL)');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    faltan.push('JWT_SECRET: cadena aleatoria de 32 caracteres o más (firma sesiones y enlaces de fotos/boletas). Genera una con: npm run secreto');
  }
  // Opcionales: solo crean el primer administrador si la base está vacía (si faltan en ese caso, lo avisa sembrar()).
  if (Boolean(env.ADMIN_EMAIL) !== Boolean(env.ADMIN_PASSWORD)) {
    faltan.push('ADMIN_EMAIL y ADMIN_PASSWORD van juntos (o bórralos los dos si el administrador ya existe en la base)');
  } else if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length < 12) {
    faltan.push('ADMIN_PASSWORD: debe tener 12 caracteres o más');
  }
  if (env.AUTH_MODE === 'jwt' && env.SEED_DEMO !== 'false') {
    faltan.push('SEED_DEMO=false: con inicio de sesión real no se crean cuentas demo (su contraseña es pública en el repositorio)');
  }
  // Demo abierta (decisión A-5, 26-09-2026, confirmada el 30-09): DEMO_CLAVE es opcional. Sin ella, cualquiera con la
  // dirección entra eligiendo un perfil: solo para mostrar con datos de prueba. Para operar: AUTH_MODE=jwt.
  return faltan;
}

if (config.authMode === 'demo') {
  console.warn(`[seguridad] AUTH_MODE=demo: la API no exige inicio de sesión${config.demoClave ? ' (protegida con DEMO_CLAVE)' : ' (demo abierta)'}. No usar con datos reales.`);
}
if (config.almacenamiento.driver === 'local' && entorno === 'production' && !process.env.UPLOAD_DIR) {
  console.warn('[archivos] Fotos y boletas en disco local: se pierden en cada despliegue. Configura Supabase Storage (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY) o un Volume de Railway.');
}
