// Seguridad: registro de eventos, detección de ataques, alertas, límite de peticiones y política de contraseñas.
// Ver docs/17-seguridad.md
import { query } from '../db/pool.js';
import { ErrorNegocio } from './reglas.js';

// ---------- Tipos de evento ----------
// nivel: info (normal), aviso (vale la pena mirar), alerta (posible ataque)
export const TIPOS = {
  login_ok: ['info', 'Inicio de sesión'],
  login_fallido: ['aviso', 'Inicio de sesión fallido'],
  cuenta_bloqueada: ['alerta', 'Cuenta bloqueada por intentos fallidos'],
  token_invalido: ['aviso', 'Sesión inválida o falsificada'],
  clave_demo_fallida: ['aviso', 'Clave de la demo incorrecta'],
  acceso_denegado: ['aviso', 'Intento de usar una función sin permiso'],
  sondeo_ajeno: ['aviso', 'Intento de ver datos de otro usuario o inexistentes'],
  exportacion: ['info', 'Exportación de datos (CSV)'],
  descarga_archivo: ['info', 'Descarga de foto o boleta'],
  enlace_invalido: ['aviso', 'Enlace de archivo alterado o vencido'],
  archivo_rechazado: ['aviso', 'Archivo sospechoso rechazado'],
  limite_peticiones: ['aviso', 'Exceso de peticiones'],
  pago_no_calza: ['alerta', 'Confirmación de pago que no calza'],
  cambio_clave: ['info', 'Cambio de contraseña'],
  clave_asignada: ['aviso', 'Contraseña asignada por administración'],
  usuario_creado: ['info', 'Usuario creado'],
  usuario_modificado: ['aviso', 'Usuario modificado'],
  sesiones_cerradas: ['aviso', 'Sesiones cerradas'],
  config_cambiada: ['aviso', 'Configuración modificada'],
};

const ip = (req) => req?.ip || null;
const agente = (req) => String(req?.get?.('user-agent') || '').slice(0, 300) || null;

// Registra un evento y evalúa las reglas de detección. Nunca rompe la operación principal.
export async function registrarEvento(req, tipo, { usuarioId, correo = null, registros = null, detalle = null, nivel } = {}) {
  const niv = nivel || TIPOS[tipo]?.[0] || 'info';
  const evento = {
    tipo, nivel: niv, usuarioId: usuarioId === undefined ? req?.usuario?.id ?? null : usuarioId,
    correo: correo ? String(correo).slice(0, 200) : null, ip: ip(req), registros,
  };
  try {
    const { rows: [fila] } = await query(
      `INSERT INTO evento_seguridad (tipo, nivel, usuario_id, correo, ip, agente, ruta, registros, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tipo, niv, evento.usuarioId, evento.correo, evento.ip, agente(req), req ? `${req.method} ${String(req.originalUrl || '').split('?')[0]}`.slice(0, 200) : null,
        registros, detalle ? JSON.stringify(detalle) : null],
    );
    evento.id = fila.id;
    await evaluarReglas(evento);
  } catch (err) {
    console.error('[seguridad] no se pudo registrar el evento', tipo, err.message);
  }
}

// ---------- Reglas de detección (se evalúan con la base, sobreviven a reinicios) ----------
const contar = async (sql, params) => (await query(sql, params)).rows[0];

async function evaluarReglas(e) {
  const reglas = [];
  if (e.tipo === 'login_fallido' && e.ip) {
    const { n } = await contar("SELECT count(*)::int AS n FROM evento_seguridad WHERE tipo = 'login_fallido' AND ip = $1 AND fecha > now() - interval '15 minutes'", [e.ip]);
    if (n >= 20) reglas.push(['fuerza_bruta', 'critica', `Ataque de fuerza bruta: ${n} contraseñas incorrectas desde la IP ${e.ip} en 15 minutos`, `fuerza_bruta:${e.ip}`, { intentos: n }]);
    const { cuentas } = await contar("SELECT count(DISTINCT correo)::int AS cuentas FROM evento_seguridad WHERE tipo = 'login_fallido' AND ip = $1 AND fecha > now() - interval '1 hour'", [e.ip]);
    if (cuentas >= 5) reglas.push(['rociado_claves', 'critica', `Prueba de contraseñas en ${cuentas} cuentas distintas desde la IP ${e.ip}`, `rociado:${e.ip}`, { cuentas }]);
  }
  if (e.tipo === 'cuenta_bloqueada') {
    reglas.push(['cuenta_bloqueada', 'alerta', `La cuenta ${e.correo} se bloqueó por intentos fallidos`, `bloqueo:${e.correo}`, {}]);
  }
  if (e.tipo === 'sondeo_ajeno') {
    const quien = e.usuarioId ? ['usuario_id = $1', e.usuarioId] : ['ip = $1', e.ip];
    const { n } = await contar(`SELECT count(*)::int AS n FROM evento_seguridad WHERE tipo = 'sondeo_ajeno' AND ${quien[0]} AND fecha > now() - interval '10 minutes'`, [quien[1]]);
    if (n >= 5) reglas.push(['enumeracion', 'critica', `Posible robo de datos: ${n} intentos de abrir envíos ajenos en 10 minutos`, `enumeracion:${quien[1]}`, { intentos: n }]);
  }
  if (e.tipo === 'token_invalido' && e.ip) {
    const { n } = await contar("SELECT count(*)::int AS n FROM evento_seguridad WHERE tipo = 'token_invalido' AND ip = $1 AND fecha > now() - interval '10 minutes'", [e.ip]);
    if (n >= 10) reglas.push(['tokens_falsos', 'critica', `${n} sesiones inválidas desde la IP ${e.ip}: posible intento de falsificar sesiones`, `tokens:${e.ip}`, { intentos: n }]);
  }
  if (e.tipo === 'clave_demo_fallida' && e.ip) {
    const { n } = await contar("SELECT count(*)::int AS n FROM evento_seguridad WHERE tipo = 'clave_demo_fallida' AND ip = $1 AND fecha > now() - interval '15 minutes'", [e.ip]);
    if (n >= 10) reglas.push(['fuerza_bruta_demo', 'critica', `${n} claves de demo incorrectas desde la IP ${e.ip}`, `demo:${e.ip}`, { intentos: n }]);
  }
  if ((e.tipo === 'exportacion' || e.tipo === 'descarga_archivo') && e.usuarioId) {
    if (e.tipo === 'exportacion' && e.registros >= 1000) {
      reglas.push(['exportacion_grande', 'aviso', `Exportación de ${e.registros} registros de una vez`, `export:${e.usuarioId}:${new Date().toISOString().slice(0, 13)}`, { registros: e.registros }]);
    }
    const { registros, descargas } = await contar(
      `SELECT COALESCE(sum(registros) FILTER (WHERE tipo = 'exportacion'), 0)::int AS registros,
              count(*) FILTER (WHERE tipo = 'descarga_archivo' AND fecha > now() - interval '10 minutes')::int AS descargas
       FROM evento_seguridad WHERE usuario_id = $1 AND fecha > now() - interval '1 hour'`, [e.usuarioId]);
    if (registros >= 5000) reglas.push(['extraccion_masiva', 'critica', `Extracción masiva: ${registros} registros exportados en 1 hora por el mismo usuario`, `extraccion:${e.usuarioId}`, { registros }]);
    if (descargas >= 60) reglas.push(['descarga_masiva', 'critica', `Descarga masiva: ${descargas} fotos o boletas en 10 minutos por el mismo usuario`, `descargas:${e.usuarioId}`, { descargas }]);
  }
  if (e.tipo === 'limite_peticiones' && e.ip) {
    reglas.push(['exceso_peticiones', 'alerta', `La IP ${e.ip} superó el límite de peticiones (posible robot o ataque de denegación de servicio)`, `peticiones:${e.ip}`, {}]);
  }
  if (e.tipo === 'pago_no_calza') {
    reglas.push(['fraude_pago', 'critica', 'Se recibió una confirmación de pago que no calza con el cobro (monto u orden distintos)', `pago:${e.usuarioId}:${e.ip}`, {}]);
  }
  if (e.tipo === 'login_ok' && e.usuarioId) {
    // Administrador que entra desde una IP que no usó en sus inicios de sesión anteriores (últimos 90 días).
    const { admin, vista, previos } = await contar(
      `SELECT (SELECT rol = 'admin' FROM usuario WHERE id = $1) AS admin,
              EXISTS (SELECT 1 FROM evento_seguridad WHERE tipo = 'login_ok' AND usuario_id = $1 AND ip = $2 AND id < $3
                      AND fecha > now() - interval '90 days') AS vista,
              (SELECT count(*)::int FROM evento_seguridad WHERE tipo = 'login_ok' AND usuario_id = $1 AND id < $3) AS previos`, [e.usuarioId, e.ip, e.id]);
    if (admin && !vista && previos > 0) reglas.push(['admin_ip_nueva', 'aviso', `Un administrador entró desde una IP nueva (${e.ip})`, `admin_ip:${e.usuarioId}:${e.ip}`, {}]);
  }
  for (const [regla, nivel, titulo, clave, detalle] of reglas) await abrirAlerta({ regla, nivel, titulo, clave, detalle, ip: e.ip, usuarioId: e.usuarioId });
}

export async function abrirAlerta({ regla, nivel, titulo, clave, detalle, ip: dirIp = null, usuarioId = null }) {
  const { rows: [a] } = await query(
    `INSERT INTO alerta_seguridad (regla, nivel, titulo, clave, ip, usuario_id, detalle) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (clave) WHERE estado = 'abierta'
     DO UPDATE SET veces = alerta_seguridad.veces + 1, ultima_en = now(), titulo = EXCLUDED.titulo, detalle = EXCLUDED.detalle
     RETURNING id, veces`,
    [regla, nivel, titulo, clave, dirIp, usuarioId, JSON.stringify(detalle || {})]);
  if (a.veces === 1 && nivel !== 'aviso') notificar(`🚨 ${titulo}`).catch(() => {});
  return a;
}

// Aviso inmediato fuera de la plataforma (Slack, Discord, Google Chat, n8n…): SEGURIDAD_WEBHOOK_URL en Railway.
async function notificar(texto) {
  const url = process.env.SEGURIDAD_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texto, content: texto }), signal: AbortSignal.timeout(5000),
  });
}

// ---------- Límite de peticiones por IP (ventana de 1 minuto) ----------
// Protege contra robots, raspado masivo de datos y denegación de servicio.
const ventanas = new Map();
setInterval(() => { const ahora = Date.now(); for (const [k, v] of ventanas) if (ahora - v.desde > 60_000) ventanas.delete(k); }, 60_000).unref();

export function limitarPeticiones(nombre, maximo) {
  return (req, res, next) => {
    const clave = `${nombre}:${req.ip}`;
    const ahora = Date.now();
    let v = ventanas.get(clave);
    if (!v || ahora - v.desde > 60_000) { v = { n: 0, desde: ahora, avisado: false }; ventanas.set(clave, v); }
    v.n += 1;
    if (v.n <= maximo) return next();
    const espera = Math.ceil((v.desde + 60_000 - ahora) / 1000);
    res.set('Retry-After', String(espera));
    if (!v.avisado) { v.avisado = true; registrarEvento(req, 'limite_peticiones', { detalle: { grupo: nombre, maximo } }); }
    return res.status(429).json({ error: `Demasiadas peticiones. Espera ${espera} segundos.` });
  };
}

// ---------- Política de contraseñas ----------
const COMUNES = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'contraseña', 'contrasena', 'qwerty123', 'abc12345',
  'iloveyou', '11111111', '00000000', 'admin123', 'administrador', 'envios123', 'chile123', 'santiago1', 'clave123', 'cambiar123', 'demo2026', 'demo.2026']);

export function validarClave(clave, { correo = '', nombre = '' } = {}) {
  const c = String(clave || '');
  if (c.length < 8) return 'Mínimo 8 caracteres';
  if (c.length > 72) return 'Máximo 72 caracteres';
  if (!/\p{L}/u.test(c) || !/\d/.test(c)) return 'Debe tener letras y números';
  const baja = c.toLowerCase();
  if (COMUNES.has(baja)) return 'Es una contraseña demasiado común';
  const usuarioCorreo = String(correo).split('@')[0].toLowerCase();
  if (usuarioCorreo.length >= 4 && baja.includes(usuarioCorreo)) return 'No puede contener tu correo';
  if (String(nombre).split(/\s+/).some((p) => p.length >= 4 && baja.includes(p.toLowerCase()))) return 'No puede contener tu nombre';
  return null;
}

export function exigirClaveSegura(clave, datos, campo = 'password') {
  const error = validarClave(clave, datos);
  if (error) throw new ErrorNegocio(422, `Contraseña insegura: ${error.toLowerCase()}`, { [campo]: error });
}
