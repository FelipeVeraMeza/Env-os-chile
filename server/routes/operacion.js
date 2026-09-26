import { Router } from 'express';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, falla, idNumerico, ruta } from '../lib/http.js';
import { cargarEnvio, exigirAcceso, exigirSinConflicto, siguienteFolio } from '../lib/envios.js';
import { guardarArchivo, leerArchivo, subida, verificarFirma, firmarEnlace } from '../lib/archivos.js';
import { quitarExif } from '../lib/exif.js';
import { MIME_BOLETA, validarReclamo } from '../lib/reglas.js';
import { autenticar, requiereRol } from '../middleware/auth.js';

// ---------- Archivos (fotos y boletas) vía enlace firmado temporal ----------
export const adjuntos = Router();
adjuntos.get('/:id/archivo', ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  if (!verificarFirma(id, req.query.exp, req.query.sig)) throw falla(403, 'Enlace inválido o expirado');
  const a = await uno('SELECT * FROM adjunto WHERE id = $1', [id]);
  if (!a) throw falla(404, 'Archivo no encontrado');
  const contenido = await leerArchivo(a.ruta);
  if (!contenido) throw falla(410, 'El archivo ya no está disponible');
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.nombre_original || `adjunto-${a.id}`)}"`);
  res.send(contenido);
}));

// ---------- Pagos (proveedor simulado; Webpay / Mercado Pago / Flow en la etapa de desarrollo) ----------
export const pagos = Router();
pagos.use(autenticar);

pagos.get('/:token', ruta(async (req, res) => {
  const p = await uno('SELECT p.*, e.folio, e.cliente_id, e.repartidor_id FROM pago p JOIN envio e ON e.id = p.envio_id WHERE p.token = $1', [req.params.token]);
  if (!p) throw falla(404, 'Pago no encontrado');
  exigirAcceso(req.usuario, p);
  res.json({ id: p.id, envio_id: p.envio_id, folio: p.folio, monto: p.monto, estado: p.estado, proveedor: p.proveedor });
}));

// En producción esta confirmación la hace la pasarela (webhook / URL de retorno), no el navegador.
pagos.post('/:token/confirmar', ruta(async (req, res) => {
  const resultado = req.body?.resultado === 'rechazado' ? 'rechazado' : 'aprobado';
  const envioId = await transaccion(async (db) => {
    const { rows: [p] } = await db.query(
      'SELECT p.*, e.cliente_id, e.repartidor_id, e.estado_pago FROM pago p JOIN envio e ON e.id = p.envio_id WHERE p.token = $1 FOR UPDATE OF p',
      [req.params.token]);
    if (!p) throw falla(404, 'Pago no encontrado');
    exigirAcceso(req.usuario, p);
    if (p.proveedor !== 'simulado') throw falla(409, 'Este pago lo confirma la pasarela');
    if (p.estado !== 'iniciado') throw falla(409, 'El pago ya fue procesado');
    const referencia = `SIM-${Date.now().toString(36).toUpperCase()}`;
    await db.query('UPDATE pago SET estado = $1, referencia = $2, actualizado_en = now() WHERE id = $3', [resultado, referencia, p.id]);
    if (resultado === 'aprobado') {
      if (p.estado_pago === 'pagado') throw falla(409, 'El envío ya estaba pagado');
      // Dos pagos iniciados para el mismo envío: solo el primero en confirmarse lo marca pagado.
      const r = await db.query(
        `UPDATE envio SET estado_pago = 'pagado', pago_medio = 'en_linea', pago_referencia = $1, pagado_en = now(), actualizado_en = now()
         WHERE id = $2 AND estado_pago <> 'pagado'`,
        [referencia, p.envio_id]);
      if (!r.rowCount) throw falla(409, 'El envío ya estaba pagado');
    }
    return p.envio_id;
  });
  await auditar(req, `pago_${resultado}`, 'envio', envioId);
  res.json({ estado: resultado, envio_id: envioId });
}));

// ---------- Reclamos de seguro (boleta OBLIGATORIA) ----------
export const reclamos = Router();
reclamos.use(autenticar);

reclamos.post('/envio/:id', requiereRol('admin', 'cliente'), subida.single('boleta'), ruta(async (req, res) => {
  const envio = await cargarEnvio(idNumerico(req.params.id));
  exigirAcceso(req.usuario, envio);
  const previos = (await query('SELECT estado FROM reclamo_seguro WHERE envio_id = $1', [envio.id])).rows;

  // La boleta puede venir en esta solicitud o haberse adjuntado al crear el envío.
  let boletaExistente = null;
  if (!req.file && req.body.boleta_adjunto_id) {
    boletaExistente = await uno("SELECT * FROM adjunto WHERE id = $1 AND envio_id = $2 AND tipo = 'boleta'", [Number(req.body.boleta_adjunto_id), envio.id]);
  }
  const boleta = req.file ? { mime: req.file.mimetype } : boletaExistente ? { mime: boletaExistente.mime } : null;
  validarReclamo({ envio, boleta, datos: req.body, reclamosPrevios: previos });

  const reclamo = await transaccion(async (db) => {
    let adjuntoId = boletaExistente?.id;
    if (req.file) {
      const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
      const archivo = await guardarArchivo(buffer, req.file.mimetype);
      const { rows: [a] } = await db.query(
        `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
         VALUES ($1, 'boleta', $2, $3, $4, $5, $6, $7) RETURNING id`,
        [envio.id, req.file.originalname, req.file.mimetype, archivo.tamano, archivo.ruta, archivo.sha256, req.usuario.id]);
      adjuntoId = a.id;
    }
    const numero = await siguienteFolio(db, 'SEG');
    const b = req.body;
    const { rows: [r] } = await db.query(
      `INSERT INTO reclamo_seguro (numero, envio_id, motivo, descripcion, monto_reclamado, boleta_adjunto_id, boleta_numero,
         boleta_fecha, boleta_monto, boleta_emisor_rut, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [numero, envio.id, b.motivo, b.descripcion || null, Number(b.monto_reclamado), adjuntoId, String(b.boleta_numero).trim(),
        b.boleta_fecha, Number(b.boleta_monto), b.boleta_emisor_rut || null, req.usuario.id]);
    return r;
  });
  await auditar(req, 'crear', 'reclamo_seguro', reclamo.id, { envio_id: envio.id, monto: reclamo.monto_reclamado });
  res.status(201).json(reclamo);
}));

const SELECT_RECLAMO = `
  SELECT r.*, e.folio, e.valor_declarado, e.descripcion_producto, e.cliente_id, e.repartidor_id, u.nombre AS cliente_nombre
  FROM reclamo_seguro r JOIN envio e ON e.id = r.envio_id JOIN usuario u ON u.id = e.cliente_id`;

reclamos.get('/', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const cond = [];
  const params = [];
  if (req.usuario.rol === 'cliente') { params.push(req.usuario.id); cond.push(`e.cliente_id = $${params.length}`); }
  if (req.query.estado) { params.push(req.query.estado); cond.push(`r.estado = $${params.length}`); }
  const { rows } = await query(`${SELECT_RECLAMO} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY r.creado_en DESC`, params);
  res.json(rows.map((r) => ({ ...r, boleta_url: firmarEnlace(r.boleta_adjunto_id) })));
}));

async function reclamoAccesible(req) {
  const r = await uno(`${SELECT_RECLAMO} WHERE r.id = $1`, [idNumerico(req.params.id)]);
  if (!r) throw falla(404, 'Reclamo no encontrado');
  exigirAcceso(req.usuario, r);
  return r;
}

reclamos.get('/:id', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const r = await reclamoAccesible(req);
  res.json({ ...r, boleta_url: firmarEnlace(r.boleta_adjunto_id) });
}));

// Flujo: solicitado → en_revision → aprobado | rechazado → pagado (solo administración).
reclamos.post('/:id/revision', requiereRol('admin'), ruta(async (req, res) => {
  const r = await reclamoAccesible(req);
  if (r.estado !== 'solicitado') throw falla(409, 'Solo se revisa un reclamo recién solicitado');
  const act = await uno("UPDATE reclamo_seguro SET estado = 'en_revision' WHERE id = $1 AND estado = 'solicitado' RETURNING *", [r.id]);
  if (!act) throw falla(409, 'Otra persona ya tomó este reclamo');
  await auditar(req, 'revisar', 'reclamo_seguro', r.id);
  res.json(act);
}));

reclamos.post('/:id/resolver', requiereRol('admin'), ruta(async (req, res) => {
  const r = await reclamoAccesible(req);
  if (!['solicitado', 'en_revision'].includes(r.estado)) throw falla(409, 'El reclamo ya fue resuelto');
  const { decision, monto_aprobado: monto, nota } = req.body || {};
  if (decision === 'rechazar') {
    if (!String(nota || '').trim()) throw falla(422, 'Indica el motivo del rechazo', { nota: 'Obligatorio' });
  } else if (decision === 'aprobar') {
    const m = Number(monto);
    if (!Number.isInteger(m) || m <= 0 || m > r.monto_reclamado) throw falla(422, `El monto aprobado debe estar entre $1 y $${r.monto_reclamado.toLocaleString('es-CL')}`, { monto_aprobado: 'Fuera de rango' });
  } else throw falla(422, 'Decisión inválida');
  const act = await uno(
    `UPDATE reclamo_seguro SET estado = $1, monto_aprobado = $2, resolucion_nota = $3, resuelto_por = $4, resuelto_en = now()
     WHERE id = $5 AND estado IN ('solicitado', 'en_revision') RETURNING *`,
    [decision === 'aprobar' ? 'aprobado' : 'rechazado', decision === 'aprobar' ? Number(monto) : null, nota || null, req.usuario.id, r.id]);
  if (!act) throw falla(409, 'El reclamo ya fue resuelto por otra persona');
  await auditar(req, decision, 'reclamo_seguro', r.id, { monto_aprobado: act.monto_aprobado });
  res.json(act);
}));

// Al pagar, la indemnización se registra como costo y descuenta de la ganancia neta.
reclamos.post('/:id/pagar', requiereRol('admin'), ruta(async (req, res) => {
  const r = await reclamoAccesible(req);
  if (r.estado !== 'aprobado') throw falla(409, 'Solo se paga un reclamo aprobado');
  const act = await transaccion(async (db) => {
    const { rows: [a] } = await db.query("UPDATE reclamo_seguro SET estado = 'pagado', pagado_en = now() WHERE id = $1 AND estado = 'aprobado' RETURNING *", [r.id]);
    if (!a) throw falla(409, 'El reclamo ya fue pagado'); // evita registrar dos veces la indemnización
    await db.query(
      "INSERT INTO costo (tipo, monto, envio_id, reclamo_id, nota, creado_por) VALUES ('seguro', $1, $2, $3, $4, $5)",
      [r.monto_aprobado, r.envio_id, r.id, `Indemnización ${r.numero} (${r.folio})`, req.usuario.id]);
    return a;
  });
  await auditar(req, 'pagar', 'reclamo_seguro', r.id, { monto: r.monto_aprobado });
  res.json(act);
}));

// ---------- Costos y reportes de ganancias (solo administración) ----------
export const costos = Router();
costos.use(autenticar, requiereRol('admin'));

costos.get('/', ruta(async (req, res) => {
  const { desde, hasta } = rango(req.query);
  const { rows } = await query('SELECT * FROM costo WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha DESC, id DESC', [desde, hasta]);
  res.json(rows);
}));

costos.post('/', ruta(async (req, res) => {
  const { tipo, monto, fecha, nota, envio_id: envioId } = req.body || {};
  if (!['bencina', 'comision', 'peaje', 'mantencion', 'otro'].includes(tipo)) throw falla(422, 'Tipo de costo inválido', { tipo: 'Inválido' });
  if (!Number.isInteger(Number(monto)) || Number(monto) <= 0) throw falla(422, 'Monto inválido', { monto: 'Inválido' });
  const c = await uno(
    'INSERT INTO costo (tipo, monto, fecha, nota, envio_id, creado_por) VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6) RETURNING *',
    [tipo, Number(monto), fecha || null, nota || null, envioId || null, req.usuario.id]);
  await auditar(req, 'crear', 'costo', c.id, { tipo, monto });
  res.status(201).json(c);
}));

function rango(q) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(q.desde || '') ? q.desde : `${hoy.slice(0, 8)}01`;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(q.hasta || '') ? q.hasta : hoy;
  return { desde, hasta };
}

export const reportes = Router();
reportes.use(autenticar, requiereRol('admin'));

// Ganancia neta = tarifas de envíos ENTREGADOS en el período − costos del período (incluye seguros pagados).
reportes.get('/ganancias', ruta(async (req, res) => {
  const { desde, hasta } = rango(req.query);
  const tz = "AT TIME ZONE 'America/Santiago'";
  const p = [desde, hasta];
  const [tot, cobrado, proyectado, costosTot, porDia, porComuna, porRepartidor, porEstado, costosTipo] = await Promise.all([
    uno(`SELECT count(*)::int AS entregados, COALESCE(sum(tarifa_total), 0)::int AS ingreso
         FROM envio WHERE estado = 'entregado' AND (entregado_en ${tz})::date BETWEEN $1 AND $2`, p),
    uno(`SELECT count(*)::int AS pagados, COALESCE(sum(tarifa_total), 0)::int AS monto
         FROM envio WHERE estado_pago IN ('pagado', 'reembolsado') AND (pagado_en ${tz})::date BETWEEN $1 AND $2`, p),
    uno(`SELECT count(*)::int AS n, COALESCE(sum(tarifa_total), 0)::int AS monto
         FROM envio WHERE estado IN ('creado','asignado','en_ruta','fallido','reagendado')`),
    uno('SELECT COALESCE(sum(monto), 0)::int AS total FROM costo WHERE fecha BETWEEN $1 AND $2', p),
    query(`SELECT to_char((entregado_en ${tz})::date, 'YYYY-MM-DD') AS dia, count(*)::int AS envios, sum(tarifa_total)::int AS ingreso
           FROM envio WHERE estado = 'entregado' AND (entregado_en ${tz})::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, p),
    query(`SELECT c.nombre AS comuna, count(*)::int AS envios, sum(e.tarifa_total)::int AS ingreso
           FROM envio e JOIN comuna c ON c.id = e.comuna_id
           WHERE e.estado = 'entregado' AND (e.entregado_en ${tz})::date BETWEEN $1 AND $2 GROUP BY c.nombre ORDER BY ingreso DESC LIMIT 10`, p),
    query(`SELECT u.nombre AS repartidor, count(*) FILTER (WHERE e.estado = 'entregado')::int AS entregados,
             sum(e.intentos)::int AS intentos_fallidos, COALESCE(sum(e.tarifa_total) FILTER (WHERE e.estado = 'entregado'), 0)::int AS ingreso
           FROM envio e JOIN usuario u ON u.id = e.repartidor_id
           WHERE (e.creado_en ${tz})::date BETWEEN $1 AND $2 GROUP BY u.nombre ORDER BY entregados DESC`, p),
    query(`SELECT estado, count(*)::int AS n FROM envio WHERE (creado_en ${tz})::date BETWEEN $1 AND $2 GROUP BY estado`, p),
    query('SELECT tipo, sum(monto)::int AS total FROM costo WHERE fecha BETWEEN $1 AND $2 GROUP BY tipo ORDER BY total DESC', p),
  ]);
  const totalCreados = porEstado.rows.reduce((s, r) => s + r.n, 0);
  const reembolsos = await uno(`SELECT count(*)::int AS n, COALESCE(sum(reembolso_monto), 0)::int AS monto
    FROM envio WHERE estado_pago = 'reembolsado' AND (reembolsado_en ${tz})::date BETWEEN $1 AND $2`, p);
  const fallidosIntentos = await uno(`SELECT COALESCE(sum(intentos), 0)::int AS n FROM envio WHERE (creado_en ${tz})::date BETWEEN $1 AND $2`, p);
  res.json({
    desde, hasta,
    ingreso: tot.ingreso,
    entregados: tot.entregados,
    cobrado: cobrado.monto,
    reembolsos: reembolsos.monto,
    cobrado_neto: cobrado.monto - reembolsos.monto,
    pagados: cobrado.pagados,
    proyectado,
    costos: costosTot.total,
    neto: tot.ingreso - costosTot.total,
    promedio_por_envio: tot.entregados ? Math.round(tot.ingreso / tot.entregados) : 0,
    tasa_intentos_fallidos: totalCreados ? fallidosIntentos.n / totalCreados : 0,
    por_dia: porDia.rows, por_comuna: porComuna.rows, por_repartidor: porRepartidor.rows, por_estado: porEstado.rows, costos_por_tipo: costosTipo.rows,
  });
}));

// Consulta del registro de auditoría (RF-54): solo administración, del más reciente al más antiguo.
export const auditoria = Router();
auditoria.use(autenticar, requiereRol('admin'));
auditoria.get('/', ruta(async (req, res) => {
  const params = [];
  const cond = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.entidad) cond.push(`a.entidad = ${p(String(req.query.entidad))}`);
  if (req.query.entidad_id) cond.push(`a.entidad_id = ${p(String(req.query.entidad_id))}`);
  if (req.query.accion) cond.push(`a.accion = ${p(String(req.query.accion))}`);
  if (req.query.usuario_id) cond.push(`a.usuario_id = ${p(idNumerico(req.query.usuario_id, 'usuario_id'))}`);
  const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
  const { rows } = await query(
    `SELECT a.id, a.fecha, a.accion, a.entidad, a.entidad_id, a.datos, u.nombre AS usuario, u.rol
     FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY a.fecha DESC, a.id DESC LIMIT ${limite}`, params);
  res.json(rows);
}));
