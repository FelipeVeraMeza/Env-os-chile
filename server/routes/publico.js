import { Router } from 'express';
import { query, uno } from '../db/pool.js';
import { falla, ruta, auditar } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import { enlacesMapa, ESTADOS } from '../lib/reglas.js';

// Seguimiento por folio: solo estado e historial, sin datos personales.
export const seguimiento = Router();
seguimiento.get('/:folio', ruta(async (req, res) => {
  const folio = String(req.params.folio || '').toUpperCase().trim();
  if (!/^ENV-\d{4}-\d{6}$/.test(folio)) throw falla(400, 'Folio con formato inválido (ej. ENV-2026-000123)');
  const e = await uno(
    `SELECT e.id, e.folio, e.estado, e.tipo_destino, e.courier_empresa, e.intentos, e.estado_pago, e.confirmado_en, e.entregado_en,
            e.horario_especial, e.franja_horaria, c.nombre AS comuna
     FROM envio e JOIN comuna c ON c.id = e.comuna_id WHERE e.folio = $1`, [folio]);
  if (!e) throw falla(404, 'No encontramos un envío con ese folio');
  const { rows } = await query('SELECT estado_nuevo AS estado, fecha FROM envio_estado WHERE envio_id = $1 ORDER BY fecha, id', [e.id]);
  const conf = await leerConfig();
  delete e.id;
  res.json({ ...e, estado_label: ESTADOS[e.estado], intentos_max: conf.operacion.intentos_max, historial: rows.map((h) => ({ ...h, label: ESTADOS[h.estado] })) });
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
  if (req.query.ver !== 'pagina') {
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
