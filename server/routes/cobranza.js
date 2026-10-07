import { Router } from 'express';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, falla, idNumerico, rangoFechas, ruta } from '../lib/http.js';
import { compararProveedores, PROVEEDORES_PAGO, SIN_ABONO, validarConciliacion } from '../lib/cobranza.js';
import { leerConfig } from '../lib/configuracion.js';
import { firmarEnlace } from '../lib/archivos.js';
import { aprobarComprobante, aprobarVarios, avisarRevisionComprobante, rechazarComprobante, registrarEventoPago } from '../lib/pagos.js';
import { validarMotivoRechazo } from '../lib/reglas.js';
import { autenticar, requiereRol } from '../middleware/auth.js';

// Cobranza (solo administración): qué se cobró, qué falta cobrar, cuánto se lleva la pasarela,
// qué abonos faltan por llegar a la cuenta y comparación de costos entre proveedores de pago.
export const cobranza = Router();
cobranza.use(autenticar, requiereRol('admin'));

const TZ = "AT TIME ZONE 'America/Santiago'";

cobranza.get('/resumen', ruta(async (req, res) => {
  const { desde, hasta } = rangoFechas(req.query);
  const p = [desde, hasta];
  const [cobrado, porProveedor, porCobrar, porConciliar, iniciados, enRevision, reembolsos] = await Promise.all([
    uno(`SELECT count(*)::int AS pagos, COALESCE(sum(monto), 0)::int AS bruto, COALESCE(sum(comision_estimada), 0)::int AS comision_estimada,
           COALESCE(sum(COALESCE(comision_real, comision_estimada)), 0)::int AS comision, COALESCE(sum(monto - COALESCE(comision_real, comision_estimada)), 0)::int AS neto
         FROM pago WHERE estado = 'aprobado' AND (verificado_en ${TZ})::date BETWEEN $1 AND $2`, p),
    query(`SELECT proveedor, COALESCE(medio, proveedor) AS medio, count(*)::int AS pagos, sum(monto)::int AS bruto,
             sum(COALESCE(comision_real, comision_estimada))::int AS comision
           FROM pago WHERE estado = 'aprobado' AND (verificado_en ${TZ})::date BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY bruto DESC`, p),
    // Cuentas por cobrar: envíos confirmados que siguen sin pago (bloquean el retiro).
    uno(`SELECT count(*)::int AS envios, COALESCE(sum(tarifa_total), 0)::int AS monto,
           COALESCE(max(EXTRACT(EPOCH FROM now() - confirmado_en) / 86400), 0)::int AS dias_mas_antiguo
         FROM envio WHERE estado_pago IN ('pendiente', 'en_revision') AND estado IN ('creado', 'asignado')`),
    // Abonos que la pasarela aún no deposita (o que administración no ha revisado en la cartola).
    uno(`SELECT count(*)::int AS pagos, COALESCE(sum(monto - comision_estimada), 0)::int AS monto_esperado,
           count(*) FILTER (WHERE abono_estimado_en < (now() AT TIME ZONE 'America/Santiago')::date)::int AS atrasados
         FROM pago WHERE estado = 'aprobado' AND abonado_en IS NULL AND proveedor <> ALL($1)`, [SIN_ABONO]),
    // Pagos iniciados hace más de 30 minutos sin respuesta: el cliente abandonó o la pasarela no avisó.
    // Solo cuentan los de envíos que siguen esperando pago (un cobro abierto de un envío ya pagado o anulado no importa).
    uno(`SELECT count(*)::int AS n FROM pago p JOIN envio e ON e.id = p.envio_id
         WHERE p.estado = 'iniciado' AND p.creado_en < now() - interval '30 minutes' AND e.estado_pago = 'pendiente' AND e.estado <> 'anulado'`),
    // Comprobantes de transferencia que esperan la revisión de administración (bloquean el retiro).
    uno(`SELECT count(*)::int AS n, COALESCE(sum(monto), 0)::int AS monto FROM pago WHERE estado = 'en_revision'`),
    // Lo devuelto a clientes en el período: se descuenta de lo cobrado.
    uno(`SELECT count(*)::int AS n, COALESCE(sum(reembolso_monto), 0)::int AS monto FROM envio
         WHERE estado_pago = 'reembolsado' AND (reembolsado_en ${TZ})::date BETWEEN $1 AND $2`, p),
  ]);
  const conf = await leerConfig();
  res.json({
    desde, hasta, proveedor_actual: conf.pagos.proveedor,
    cobrado, reembolsos, cobrado_neto_reembolsos: cobrado.bruto - reembolsos.monto, por_proveedor: porProveedor.rows, por_cobrar: porCobrar, por_conciliar: porConciliar, sin_respuesta: iniciados.n, en_revision: enRevision,
  });
}));

// ---------- Comprobantes de transferencia (el cliente sube la imagen, administración revisa) ----------
// Por defecto los que esperan revisión (más antiguos primero); ?estado=todos incluye los ya revisados.
// Se avisa si el mismo archivo o el mismo N° de operación ya se usó en otro envío (comprobante reutilizado).
cobranza.get('/comprobantes', ruta(async (req, res) => {
  const todos = req.query.estado === 'todos';
  const { rows } = await query(
    `SELECT pg.id, pg.envio_id, pg.monto, pg.estado, pg.referencia, pg.motivo_rechazo, pg.creado_en, pg.revisado_en, pg.lote,
       e.folio, e.estado AS envio_estado, e.tarifa_total, e.creado_en AS envio_creado_en, dst.nombre AS destinatario_nombre, cm.nombre AS comuna_nombre, u.nombre AS cliente_nombre, s.nombre AS subido_por_nombre, r.nombre AS revisado_por_nombre,
       a.id AS adjunto_id, a.mime, a.nombre_original,
       (SELECT array_agg(DISTINCT e2.folio) FROM pago p2 JOIN adjunto a2 ON a2.id = p2.comprobante_adjunto_id JOIN envio e2 ON e2.id = p2.envio_id
         WHERE p2.envio_id <> pg.envio_id AND p2.estado IN ('en_revision', 'aprobado') AND (pg.lote IS NULL OR p2.lote IS DISTINCT FROM pg.lote)
           AND (a2.sha256 = a.sha256 OR (pg.referencia IS NOT NULL AND p2.referencia = pg.referencia))) AS usado_en
     FROM pago pg JOIN adjunto a ON a.id = pg.comprobante_adjunto_id JOIN envio e ON e.id = pg.envio_id
     JOIN destinatario dst ON dst.id = e.destinatario_id JOIN comuna cm ON cm.id = e.comuna_id
     JOIN usuario u ON u.id = e.cliente_id LEFT JOIN usuario s ON s.id = pg.creado_por LEFT JOIN usuario r ON r.id = pg.revisado_por
     ${todos ? '' : "WHERE pg.estado = 'en_revision'"}
     ORDER BY ${todos ? 'pg.creado_en DESC' : 'pg.creado_en'}, pg.id LIMIT 200`);
  // Un comprobante del carrito (lote) paga varios envíos: se muestra como una sola fila con todos sus folios y el total.
  const grupos = new Map();
  for (const { adjunto_id: adjuntoId, ...c } of rows) {
    const clave = c.lote || `pago-${c.id}`;
    const g = grupos.get(clave);
    if (g) {
      g.envios.push({ envio_id: c.envio_id, folio: c.folio, monto: c.monto, destinatario_nombre: c.destinatario_nombre, comuna_nombre: c.comuna_nombre, creado_en: c.envio_creado_en });
      g.monto += c.monto;
      g.folio = g.envios.map((x) => x.folio).join(', ');
      g.usado_en = [...new Set([...g.usado_en, ...(c.usado_en || [])])];
    } else {
      grupos.set(clave, { ...c, usado_en: c.usado_en || [], envios: [{ envio_id: c.envio_id, folio: c.folio, monto: c.monto, destinatario_nombre: c.destinatario_nombre, comuna_nombre: c.comuna_nombre, creado_en: c.envio_creado_en }], comprobante_url: firmarEnlace(adjuntoId, req.usuario.id) });
    }
  }
  res.json([...grupos.values()]);
}));

// Por cobrar agrupado por cliente (pedido 07-10): un cliente con 30 envíos del día los paga con una transferencia y
// administración los aprueba de una vez. Cada cliente trae sus envíos por pagar o pendientes de aprobación.
cobranza.get('/por-cliente', ruta(async (req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.folio, e.estado_pago, e.tarifa_total, e.creado_en, e.cliente_id, u.nombre AS cliente_nombre, u.telefono AS cliente_telefono,
       dst.nombre AS destinatario_nombre, cm.nombre AS comuna_nombre,
       p.id AS pago_id, p.lote, p.referencia, p.creado_en AS comprobante_en
     FROM envio e JOIN usuario u ON u.id = e.cliente_id
     JOIN destinatario dst ON dst.id = e.destinatario_id JOIN comuna cm ON cm.id = e.comuna_id
     LEFT JOIN pago p ON p.envio_id = e.id AND p.estado = 'en_revision'
     WHERE e.estado_pago IN ('pendiente', 'en_revision') AND e.estado NOT IN ('borrador', 'anulado') AND e.tarifa_total > 0
     ORDER BY u.nombre, e.creado_en, e.id LIMIT 2000`);
  const clientes = new Map();
  for (const e of rows) {
    let c = clientes.get(e.cliente_id);
    if (!c) {
      c = { cliente_id: e.cliente_id, cliente_nombre: e.cliente_nombre, cliente_telefono: e.cliente_telefono, por_pagar: 0, monto_por_pagar: 0,
        en_revision: 0, monto_en_revision: 0, comprobantes: new Set(), envios: [] };
      clientes.set(e.cliente_id, c);
    }
    if (e.estado_pago === 'pendiente') { c.por_pagar += 1; c.monto_por_pagar += e.tarifa_total; }
    else { c.en_revision += 1; c.monto_en_revision += e.tarifa_total; if (e.pago_id) c.comprobantes.add(e.lote || `pago-${e.pago_id}`); }
    c.envios.push({ id: e.id, folio: e.folio, estado_pago: e.estado_pago, monto: e.tarifa_total, creado_en: e.creado_en, destinatario_nombre: e.destinatario_nombre, comuna_nombre: e.comuna_nombre, pago_id: e.pago_id, grupo: e.pago_id ? (e.lote || `pago-${e.pago_id}`) : null, referencia: e.referencia });
  }
  // Primero los que tienen comprobantes esperando aprobación; luego los de mayor monto.
  const lista = [...clientes.values()].map((c) => ({ ...c, comprobantes: c.comprobantes.size, total: c.monto_por_pagar + c.monto_en_revision }))
    .sort((a, b) => b.en_revision - a.en_revision || b.total - a.total);
  res.json(lista);
}));

cobranza.post('/aprobar-varios', ruta(async (req, res) => {
  const ids = (Array.isArray(req.body?.envio_ids) ? req.body.envio_ids : String(req.body?.envio_ids || '').split(','))
    .map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  const referencia = String(req.body?.referencia || '').trim().slice(0, 60) || null;
  const r = await aprobarVarios(ids, { referencia, usuarioId: req.usuario.id });
  for (const envioId of r.envio_ids) await auditar(req, 'aprobar_varios', 'envio', envioId, { referencia, envios: r.envio_ids.length });
  avisarRevisionComprobante(r.envio_ids, { aprobado: true }).catch((err) => console.error('[correo]', err.message));
  res.json(r);
}));

cobranza.post('/comprobantes/:id/aprobar', ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const referencia = String(req.body?.referencia || '').trim().slice(0, 60) || null;
  const envioIds = await aprobarComprobante(id, { referencia, usuarioId: req.usuario.id });
  for (const envioId of envioIds) await auditar(req, 'aprobar_comprobante', 'envio', envioId, { pago_id: id, referencia });
  // El correo al cliente no se espera: un SMTP lento no hace esperar a administración.
  avisarRevisionComprobante(envioIds, { aprobado: true }).catch((err) => console.error('[correo]', err.message));
  res.json({ estado: 'aprobado', envio_id: envioIds[0], envio_ids: envioIds });
}));

cobranza.post('/comprobantes/:id/rechazar', ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const motivo = validarMotivoRechazo(req.body?.motivo);
  const envioIds = await rechazarComprobante(id, { motivo, usuarioId: req.usuario.id });
  for (const envioId of envioIds) await auditar(req, 'rechazar_comprobante', 'envio', envioId, { pago_id: id, motivo });
  avisarRevisionComprobante(envioIds, { aprobado: false, motivo }).catch((err) => console.error('[correo]', err.message));
  res.json({ estado: 'rechazado', envio_id: envioIds[0], envio_ids: envioIds });
}));

cobranza.get('/pagos', ruta(async (req, res) => {
  const cond = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.estado) cond.push(`pg.estado = ${p(req.query.estado)}`);
  if (req.query.conciliado === 'no') cond.push(`pg.estado = 'aprobado' AND pg.abonado_en IS NULL AND pg.proveedor <> ALL(${p(SIN_ABONO)})`);
  if (req.query.conciliado === 'si') cond.push('pg.abonado_en IS NOT NULL');
  const { rows } = await query(
    `SELECT pg.id, pg.envio_id, pg.proveedor, pg.medio, pg.monto, pg.estado, pg.referencia, pg.transaccion_id, pg.verificacion, pg.verificado_en,
       pg.comision_estimada, pg.neto_estimado, pg.abono_estimado_en, pg.monto_abonado, pg.comision_real, pg.abonado_en, pg.creado_en,
       e.folio, u.nombre AS cliente_nombre, v.nombre AS verificado_por_nombre
     FROM pago pg JOIN envio e ON e.id = pg.envio_id JOIN usuario u ON u.id = e.cliente_id LEFT JOIN usuario v ON v.id = pg.verificado_por
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY pg.creado_en DESC, pg.id DESC LIMIT 200`, params);
  res.json(rows);
}));

cobranza.get('/pagos/:id/eventos', ruta(async (req, res) => {
  const { rows } = await query(
    `SELECT ev.*, u.nombre AS usuario_nombre FROM pago_evento ev LEFT JOIN usuario u ON u.id = ev.usuario_id
     WHERE ev.pago_id = $1 ORDER BY ev.fecha, ev.id`, [idNumerico(req.params.id)]);
  res.json(rows);
}));

// Conciliación: administración confirma que el abono llegó a la cuenta (cartola). La comisión real
// de la pasarela se registra como costo "pasarela" y descuenta de la ganancia neta.
cobranza.post('/pagos/:id/conciliar', ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const act = await transaccion(async (db) => {
    const { rows: [pg] } = await db.query('SELECT pg.*, e.folio FROM pago pg JOIN envio e ON e.id = pg.envio_id WHERE pg.id = $1 FOR UPDATE OF pg', [id]);
    if (!pg) throw falla(404, 'Pago no encontrado');
    const c = validarConciliacion(pg, req.body || {});
    const { rows: [a] } = await db.query(
      `UPDATE pago SET monto_abonado = $1, comision_real = $2, abonado_en = $3, conciliado_por = $4, actualizado_en = now() WHERE id = $5 RETURNING *`,
      [c.monto_abonado, c.comision_real, c.abonado_en, req.usuario.id, id]);
    await registrarEventoPago(db, { pagoId: id, tipo: 'conciliacion', monto: c.monto_abonado, datos: c, usuarioId: req.usuario.id });
    if (c.comision_real > 0) {
      await db.query(
        "INSERT INTO costo (fecha, tipo, monto, envio_id, pago_id, nota, creado_por) VALUES ($1, 'pasarela', $2, $3, $4, $5, $6)",
        [c.abonado_en, c.comision_real, pg.envio_id, id, `Comisión ${PROVEEDORES_PAGO[pg.proveedor]?.nombre || pg.proveedor} (${pg.folio})`, req.usuario.id]);
    }
    return a;
  });
  await auditar(req, 'conciliar', 'pago', id, { monto_abonado: act.monto_abonado, comision_real: act.comision_real });
  res.json(act);
}));

// Comparador: cuánto cuesta cobrar un envío con cada proveedor y cuánto sería al mes.
cobranza.get('/estimar', ruta(async (req, res) => {
  const conf = await leerConfig();
  const monto = Number(req.query.monto) || conf.tarifas.base;
  let enviosMes = Number(req.query.envios_mes);
  if (!Number.isFinite(enviosMes) || enviosMes < 0) {
    const r = await uno(`SELECT count(*)::int AS n FROM envio WHERE confirmado_en >= now() - interval '30 days'`);
    enviosMes = r.n;
  }
  res.json({ monto, envios_mes: enviosMes, proveedor_actual: conf.pagos.proveedor, proveedores: compararProveedores(monto, enviosMes) });
}));
