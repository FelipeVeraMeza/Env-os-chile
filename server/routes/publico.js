import { Router } from 'express';
import { query, uno } from '../db/pool.js';
import { falla, ruta, auditar } from '../lib/http.js';
import { leerArchivo } from '../lib/archivos.js';
import { registrarEvento } from '../lib/seguridad.js';
import { leerConfig } from '../lib/configuracion.js';
import { enlacesMapa, historialPublico, ESTADOS } from '../lib/reglas.js';

// Seguimiento por folio: solo estado e historial, sin datos personales.
export const seguimiento = Router();

// El correlativo se rellena a 6 dígitos pero puede crecer (sobre 999.999 envíos en un año tiene 7 o más).
function folioValido(valor) {
  const folio = String(valor || '').toUpperCase().trim();
  if (!/^ENV-\d{4}-\d{6,9}$/.test(folio)) throw falla(400, 'Folio con formato inválido (ej. ENV-2026-000123)');
  return folio;
}

seguimiento.get('/:folio', ruta(async (req, res) => {
  const folio = folioValido(req.params.folio);
  const e = await uno(
    // Sin el estado del pago: los folios son correlativos y cualquiera podría recorrerlos para saber quién pagó.
    `SELECT e.id, e.folio, e.estado, e.tipo_destino, e.courier_empresa, e.intentos, e.confirmado_en, e.entregado_en,
            e.horario_especial, e.franja_horaria, c.nombre AS comuna,
            EXISTS (SELECT 1 FROM adjunto a WHERE a.envio_id = e.id AND a.tipo = 'foto_paquete') AS foto_paquete
     FROM envio e JOIN comuna c ON c.id = e.comuna_id WHERE e.folio = $1`, [folio]);
  if (!e) throw falla(404, 'No encontramos un envío con ese folio');
  // Sin los avisos que no cambian el estado (cambio de destino, retiro reagendado): no son públicos.
  const { rows } = await query(
    'SELECT estado_nuevo AS estado, motivo, fecha FROM envio_estado WHERE envio_id = $1 AND estado_anterior IS DISTINCT FROM estado_nuevo ORDER BY fecha, id', [e.id]);
  const conf = await leerConfig();
  delete e.id;
  // Cada paso dice en qué intento va; el motivo es solo el general (sin el detalle del repartidor).
  res.json({ ...e, estado_label: ESTADOS[e.estado], intentos_max: conf.operacion.intentos_max, historial: historialPublico(rows, conf.operacion.intentos_max) });
}));

// Foto del paquete al crearlo (pedido 09-10): quien recibe compara si llegó en las mismas condiciones. Los folios son
// correlativos y la foto puede mostrar la etiqueta con nombre y dirección, así que no es pública: se pide los últimos
// 4 dígitos del teléfono de quien recibe. Tras 10 intentos fallidos en una hora el folio se bloquea (aunque cambie la IP).
const INTENTOS_FOTO = 10;
seguimiento.post('/:folio/foto', ruta(async (req, res) => {
  const folio = folioValido(req.params.folio);
  const clave = String(req.body?.clave ?? '').replace(/\D/g, '');
  if (clave.length !== 4) throw falla(422, 'Escribe los últimos 4 dígitos del teléfono de quien recibe', { clave: 'Escribe 4 dígitos' });
  const { fallidos } = await uno(
    `SELECT count(*)::int AS fallidos FROM evento_seguridad
     WHERE tipo = 'foto_seguimiento_fallida' AND detalle->>'folio' = $1 AND fecha > now() - interval '1 hour'`, [folio]);
  if (fallidos >= INTENTOS_FOTO) throw falla(429, 'Demasiados intentos con este folio. Inténtalo en una hora.');
  const e = await uno(
    `SELECT e.id, d.telefono,
            (SELECT a.ruta FROM adjunto a WHERE a.envio_id = e.id AND a.tipo = 'foto_paquete' ORDER BY a.id LIMIT 1) AS ruta,
            (SELECT a.mime FROM adjunto a WHERE a.envio_id = e.id AND a.tipo = 'foto_paquete' ORDER BY a.id LIMIT 1) AS mime
     FROM envio e JOIN destinatario d ON d.id = e.destinatario_id WHERE e.folio = $1`, [folio]);
  if (!e) throw falla(404, 'No encontramos un envío con ese folio');
  const digitos = String(e.telefono || '').replace(/\D/g, '');
  if (digitos.length < 4 || digitos.slice(-4) !== clave) {
    await registrarEvento(req, 'foto_seguimiento_fallida', { usuarioId: null, detalle: { folio } });
    throw falla(403, 'Los dígitos no coinciden con el teléfono de quien recibe', { clave: 'No coinciden con el teléfono de quien recibe' });
  }
  if (!e.ruta) throw falla(404, 'Este envío no tiene foto del paquete');
  const contenido = await leerArchivo(e.ruta);
  if (!contenido) throw falla(410, 'La foto ya no está disponible');
  await auditar(req, 'foto_seguimiento', 'envio', e.id);
  res.setHeader('Content-Type', e.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(contenido);
}));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Página a la que apunta el QR (opción A del documento de alcance): dirección + botones Maps/Waze.
export const paginaQr = Router();
paginaQr.get('/:token', ruta(async (req, res) => {
  const e = await uno(
    `SELECT e.id, e.folio, e.estado, e.tipo_destino, e.courier_empresa, e.courier_punto, e.horario_especial, e.franja_horaria,
            di.calle, di.numero, di.depto, di.referencia, di.lat, di.lon, c.nombre AS comuna, c.region
     FROM envio e JOIN direccion di ON di.id = e.direccion_id JOIN comuna c ON c.id = e.comuna_id
     WHERE e.token_qr = $1 AND e.folio IS NOT NULL`, [req.params.token]);
  if (!e) return res.status(404).send('<h1>QR no válido</h1>');
  await auditar(req, 'qr_escaneado', 'envio', e.id);
  const conf = await leerConfig();
  const mapas = enlacesMapa({ calle: e.calle, numero: e.numero, comuna: e.comuna, region: e.region, lat: e.lat, lon: e.lon });
  // ?ver=pagina muestra siempre la página con ambos botones (útil si el teléfono no tiene Google Maps).
  // Un envío a un punto courier (Blue Express, Starken…) no se entrega en la dirección del destinatario: se muestra
  // siempre la página, que indica el punto, en vez de llevar al repartidor directo a la casa.
  if (req.query.ver !== 'pagina' && e.tipo_destino !== 'punto_courier') {
    if (conf.operacion.qr_destino === 'google') return res.redirect(mapas.ver);
    if (conf.operacion.qr_destino === 'waze') return res.redirect(mapas.waze);
  }

  res.send(`<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.folio)} · ${esc(conf.negocio.nombre)}</title>
<style>
:root{--azul:#1537d6;--azul-900:#0a1a6b;--magenta:#e0218a;--blanco:#fff}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(160deg,var(--azul-900),var(--azul));color:var(--blanco);min-height:100vh;padding:20px}
.card{max-width:460px;margin:0 auto;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:22px}
.marca{font-weight:700;opacity:.85;font-size:14px}.folio{font-size:26px;font-weight:800;margin:6px 0 2px}
.estado{display:inline-block;background:var(--magenta);padding:4px 12px;border-radius:99px;font-size:13px;font-weight:600}
.dir{font-size:20px;font-weight:700;margin-top:18px}.comuna{font-size:28px;font-weight:900;letter-spacing:.5px;margin:4px 0}
.ref{opacity:.85}.btn{display:block;text-align:center;padding:16px;border-radius:14px;font-weight:800;font-size:18px;text-decoration:none;margin-top:12px}
.g{background:var(--blanco);color:var(--azul-900)}.w{background:var(--magenta);color:var(--blanco)}.aviso{background:rgba(224,33,138,.25);border-radius:12px;padding:10px;margin-top:12px}
</style></head><body><main class="card">
<div class="marca">${esc(conf.negocio.nombre)}</div>
<div class="folio">${esc(e.folio)}</div><span class="estado">${esc(ESTADOS[e.estado])}</span>
${e.tipo_destino === 'punto_courier' ? `<div class="aviso">Entregar en punto <b>${esc(e.courier_empresa)}</b>: ${esc(e.courier_punto)}</div>` : ''}
${e.horario_especial ? `<div class="aviso">Horario especial: <b>${esc(e.franja_horaria)}</b></div>` : ''}
<div class="dir">${esc(e.calle)} ${esc(e.numero)}${e.depto ? `, ${esc(e.depto)}` : ''}</div>
<div class="comuna">${esc(e.comuna.toUpperCase())}</div>
${e.referencia ? `<div class="ref">Ref.: ${esc(e.referencia)}</div>` : ''}
<a class="btn g" href="${esc(mapas.google)}">Ir con Google Maps</a>
<a class="btn w" href="${esc(mapas.waze)}">Ir con Waze</a>
</main></body></html>`);
}));
