import crypto from 'node:crypto';
import { Router } from 'express';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import {
  calcularTarifa, normalizarRut, normalizarTelefono, rolPuedeTransicionar, validarDestinatario, validarDestino,
  validarDireccion, validarPaquete, validarTransicion, validarUbicacion, ESTADOS,
} from '../lib/reglas.js';
import {
  cargarEnvio, detalleCompleto, exigirAcceso, exigirSinConflicto, presentar, registrarEstado, SELECT_ENVIO, siguienteFolio, tarifaDeComuna,
} from '../lib/envios.js';
import { guardarArchivo, subida } from '../lib/archivos.js';
import { quitarExif } from '../lib/exif.js';
import { generarQrPng, generarTicketPdf, urlQr } from '../lib/ticket.js';
import { requiereRol } from '../middleware/auth.js';

export const envios = Router();

const MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

function datosPaquete(b) {
  return {
    tipo_destino: b.tipo_destino || 'domicilio',
    courier_empresa: b.tipo_destino === 'punto_courier' ? b.courier_empresa : null,
    courier_punto: b.tipo_destino === 'punto_courier' ? String(b.courier_punto || '').trim() : null,
    courier_codigo: b.tipo_destino === 'punto_courier' ? String(b.courier_codigo || '').trim() || null : null,
    descripcion_producto: String(b.descripcion_producto || '').trim(),
    bultos: Number(b.bultos ?? 1),
    peso_kg: Number(b.peso_kg),
    largo_cm: Number(b.largo_cm),
    ancho_cm: Number(b.ancho_cm),
    alto_cm: Number(b.alto_cm),
    valor_declarado: Number(b.valor_declarado || 0),
    horario_especial: b.horario_especial === true || b.horario_especial === 'true',
    franja_horaria: String(b.franja_horaria || '').trim() || null,
    observaciones: String(b.observaciones || '').trim() || null,
  };
}

// Valida paquete + destino y calcula la tarifa. Usado por /cotizar y al crear.
async function cotizar(body, usuario, conf) {
  const paquete = datosPaquete(body);
  const errores = { ...validarDestino(paquete, conf.listas) };
  const erroresPaquete = validarPaquete(paquete, conf.tarifas);
  const tarifaManual = usuario.rol === 'admin' && body.tarifa_manual !== undefined && body.tarifa_manual !== '' && body.tarifa_manual !== null
    ? Number(body.tarifa_manual) : null;

  // Fuera de 20 kg / 60×60×60 cm no aplica la tarifa estándar: solo el admin puede cotizarlo con tarifa manual.
  for (const [campo, mensaje] of Object.entries(erroresPaquete)) {
    if (tarifaManual !== null && /^(Excede|Máximo)/.test(mensaje)) continue;
    errores[campo] = /^(Excede|Máximo)/.test(mensaje) ? `${mensaje}: requiere cotización especial` : mensaje;
  }

  let comuna = null;
  const comunaId = body.direccion?.comuna_id || body.comuna_id;
  if (comunaId) {
    comuna = await tarifaDeComuna(Number(comunaId));
    if (!comuna) errores.comuna_id = 'Comuna inexistente';
    else if (!comuna.en_cobertura) errores.comuna_id = `${comuna.nombre} está fuera de la zona de cobertura`;
  }

  const tarifa = calcularTarifa(paquete, conf.tarifas, comuna?.tarifa ?? null);
  if (tarifaManual !== null) {
    if (!Number.isInteger(tarifaManual) || tarifaManual < 0) errores.tarifa_manual = 'Tarifa manual inválida';
    else Object.assign(tarifa, { tarifa_base: tarifaManual, recargo_bultos: 0, recargo_horario: 0, tarifa_total: tarifaManual });
  }
  return { paquete, tarifa, errores, comuna };
}

envios.post('/cotizar', ruta(async (req, res) => {
  const conf = await leerConfig();
  const { tarifa, errores } = await cotizar(req.body, req.usuario, conf);
  res.json({ ...tarifa, errores });
}));

// Crea el envío como borrador (y opcionalmente lo confirma en la misma llamada).
envios.post('/', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const b = req.body || {};
  const conf = await leerConfig();
  const clienteId = req.usuario.rol === 'cliente' ? req.usuario.id : Number(b.cliente_id);
  if (req.usuario.rol === 'admin') {
    const cli = Number.isInteger(clienteId) ? await uno("SELECT id FROM usuario WHERE id = $1 AND rol = 'cliente'", [clienteId]) : null;
    if (!cli) throw falla(422, 'Selecciona el cliente dueño del envío', { cliente_id: 'Obligatorio' });
  }

  const errores = {};
  if (!b.destinatario_id) Object.assign(errores, prefijar('destinatario', validarDestinatario(b.destinatario)));
  if (!b.direccion_id) Object.assign(errores, prefijar('direccion', validarDireccion(b.direccion)));

  let comunaId = b.direccion?.comuna_id;
  if (b.direccion_id) {
    const dir = await uno(
      `SELECT di.* FROM direccion di JOIN destinatario d ON d.id = di.destinatario_id
       WHERE di.id = $1 AND di.activa AND d.cliente_id = $2 AND ($3::int IS NULL OR d.id = $3)`,
      [Number(b.direccion_id), clienteId, b.destinatario_id ? Number(b.destinatario_id) : null],
    );
    if (!dir) errores.direccion_id = 'Dirección no encontrada en la libreta del cliente';
    else comunaId = dir.comuna_id;
  }
  const { paquete, tarifa, errores: erroresCot } = await cotizar({ ...b, comuna_id: comunaId }, req.usuario, conf);
  Object.assign(errores, erroresCot);
  exigirSinErrores(errores);

  const envio = await transaccion(async (db) => {
    let destinatarioId = b.destinatario_id ? Number(b.destinatario_id) : null;
    if (destinatarioId) {
      const { rows } = await db.query('SELECT id FROM destinatario WHERE id = $1 AND cliente_id = $2', [destinatarioId, clienteId]);
      if (!rows[0]) throw falla(422, 'Destinatario no encontrado en la libreta del cliente');
    } else {
      const d = b.destinatario;
      const { rows: [nuevo] } = await db.query(
        `INSERT INTO destinatario (cliente_id, nombre, telefono, correo, rut, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [clienteId, d.nombre.trim(), normalizarTelefono(d.telefono), d.correo || null, normalizarRut(d.rut), d.notas || null],
      );
      destinatarioId = nuevo.id;
    }

    let direccionId = b.direccion_id ? Number(b.direccion_id) : null;
    if (!direccionId) {
      const di = b.direccion;
      const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM direccion WHERE destinatario_id = $1 AND activa', [destinatarioId]);
      const { rows: [nueva] } = await db.query(
        `INSERT INTO direccion (destinatario_id, alias, calle, numero, depto, referencia, comuna_id, lat, lon, es_principal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [destinatarioId, di.alias || null, di.calle.trim(), String(di.numero).trim(), di.depto || null, di.referencia || null,
          Number(di.comuna_id), di.lat ?? null, di.lon ?? null, n === 0],
      );
      direccionId = nueva.id;
    }

    const { rows: [e] } = await db.query(
      `INSERT INTO envio (token_qr, cliente_id, destinatario_id, direccion_id, comuna_id, tipo_destino, courier_empresa, courier_punto,
         courier_codigo, descripcion_producto, bultos, peso_kg, largo_cm, ancho_cm, alto_cm, valor_declarado, horario_especial,
         franja_horaria, tarifa_base, recargo_bultos, recargo_horario, tarifa_total, observaciones, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
      [crypto.randomBytes(18).toString('base64url'), clienteId, destinatarioId, direccionId, Number(comunaId), paquete.tipo_destino,
        paquete.courier_empresa, paquete.courier_punto, paquete.courier_codigo, paquete.descripcion_producto, paquete.bultos,
        paquete.peso_kg, paquete.largo_cm, paquete.ancho_cm, paquete.alto_cm, paquete.valor_declarado, paquete.horario_especial,
        paquete.horario_especial ? paquete.franja_horaria : null, tarifa.tarifa_base, tarifa.recargo_bultos, tarifa.recargo_horario,
        tarifa.tarifa_total, paquete.observaciones, req.usuario.id],
    );
    await registrarEstado(db, { envioId: e.id, anterior: null, nuevo: 'borrador', usuarioId: req.usuario.id });
    if (b.confirmar) await confirmar(db, e.id, req.usuario.id);
    return cargarEnvio(e.id, db);
  });

  await auditar(req, 'crear', 'envio', envio.id, { folio: envio.folio, tarifa: envio.tarifa_total });
  res.status(201).json(presentar(envio, req.usuario));
}));

function prefijar(prefijo, errores) {
  return Object.fromEntries(Object.entries(errores).map(([k, v]) => [`${prefijo}.${k}`, v]));
}

async function confirmar(db, envioId, usuarioId) {
  // Se bloquea la fila antes de pedir folio: dos confirmaciones simultáneas no gastan dos folios.
  const { rows: [actual] } = await db.query('SELECT estado FROM envio WHERE id = $1 FOR UPDATE', [envioId]);
  if (actual?.estado !== 'borrador') throw falla(409, 'El envío ya fue confirmado');
  const folio = await siguienteFolio(db, 'ENV');
  await db.query(`UPDATE envio SET folio = $1, estado = 'creado', confirmado_en = now(), actualizado_en = now() WHERE id = $2`, [folio, envioId]);
  await registrarEstado(db, { envioId, anterior: 'borrador', nuevo: 'creado', usuarioId });
  return folio;
}

// Listado con búsqueda, filtros y paginación (RF-27 a RF-29).
function filtrosListado(req) {
  const q = req.query;
  const cond = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (req.usuario.rol === 'cliente') cond.push(`e.cliente_id = ${p(req.usuario.id)}`);
  if (req.usuario.rol === 'repartidor') cond.push(`e.repartidor_id = ${p(req.usuario.id)}`);
  if (q.estado) cond.push(`e.estado = ANY(${p(String(q.estado).split(','))})`);
  if (q.estado_pago) cond.push(`e.estado_pago = ${p(q.estado_pago)}`);
  if (q.comuna_id) cond.push(`e.comuna_id = ${p(Number(q.comuna_id))}`);
  if (q.repartidor_id) cond.push(q.repartidor_id === 'sin' ? 'e.repartidor_id IS NULL' : `e.repartidor_id = ${p(Number(q.repartidor_id))}`);
  if (q.cliente_id && req.usuario.rol === 'admin') cond.push(`e.cliente_id = ${p(Number(q.cliente_id))}`);
  if (q.desde) cond.push(`e.creado_en >= ${p(q.desde)}::date`);
  if (q.hasta) cond.push(`e.creado_en < (${p(q.hasta)}::date + 1)`);
  if (q.q) {
    const t = p(`%${String(q.q).trim()}%`);
    cond.push(`(e.folio ILIKE ${t} OR d.nombre ILIKE ${t} OR d.telefono ILIKE ${t} OR di.calle ILIKE ${t} OR c.nombre ILIKE ${t})`);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

envios.get('/', ruta(async (req, res) => {
  const { where, params } = filtrosListado(req);
  const limite = Math.min(Number(req.query.limite) || 20, 100);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);
  const total = await uno(
    `SELECT count(*)::int AS n FROM envio e JOIN destinatario d ON d.id = e.destinatario_id
     JOIN direccion di ON di.id = e.direccion_id JOIN comuna c ON c.id = e.comuna_id ${where}`, params);
  // orden=ruta: el orden que definió el repartidor (RF-60); lo no ordenado va al final agrupado por comuna.
  const orden = req.query.orden === 'ruta' ? 'e.orden_ruta NULLS LAST, c.nombre, e.creado_en' : 'e.creado_en DESC, e.id DESC';
  const { rows } = await query(
    `${SELECT_ENVIO} ${where} ORDER BY ${orden} LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`, params);
  res.json({ total: total.n, pagina, limite, items: rows.map((e) => presentar(e, req.usuario)) });
}));

// Exportación CSV de lo que se está viendo (RF-37). Separador ";" para Excel en español.
envios.get('/exportar.csv', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const { where, params } = filtrosListado(req);
  const { rows } = await query(`${SELECT_ENVIO} ${where} ORDER BY e.creado_en DESC LIMIT 20000`, params);
  const cols = [
    ['Folio', 'folio'], ['Estado', (e) => ESTADOS[e.estado]], ['Pago', 'estado_pago'], ['Creado', (e) => new Date(e.creado_en).toLocaleString('es-CL', { timeZone: 'America/Santiago' })],
    ['Cliente', 'cliente_nombre'], ['Destinatario', 'destinatario_nombre'], ['Teléfono', 'destinatario_telefono'],
    ['Dirección', (e) => `${e.calle} ${e.numero}${e.depto ? ' ' + e.depto : ''}`], ['Comuna', 'comuna_nombre'],
    ['Tipo destino', 'tipo_destino'], ['Courier', 'courier_empresa'], ['Producto', 'descripcion_producto'], ['Bultos', 'bultos'],
    ['Peso kg', 'peso_kg'], ['Valor declarado', 'valor_declarado'], ['Horario especial', (e) => (e.horario_especial ? 'Sí' : 'No')],
    ['Tarifa total', 'tarifa_total'], ['Repartidor', 'repartidor_nombre'], ['Intentos', 'intentos'],
    ['Entregado', (e) => (e.entregado_en ? new Date(e.entregado_en).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '')],
  ];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [cols.map(([t]) => celda(t)).join(';')];
  for (const e of rows) lineas.push(cols.map(([, c]) => celda(typeof c === 'function' ? c(e) : e[c])).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="envios-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lineas.join('\r\n'));
}));

// El repartidor ordena su ruta del día (RF-60). Solo puede ordenar envíos que tiene asignados.
envios.put('/ruta/orden', requiereRol('repartidor', 'admin'), ruta(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length || ids.length > 200 || ids.some((n) => !Number.isInteger(n) || n <= 0) || new Set(ids).size !== ids.length) {
    throw falla(422, 'Lista de envíos inválida');
  }
  const repartidorId = req.usuario.rol === 'repartidor' ? req.usuario.id : Number(req.body.repartidor_id);
  // En una transacción: si hay un envío ajeno en la lista no se cambia nada.
  const n = await transaccion(async (db) => {
    const r = await db.query(
      `UPDATE envio e SET orden_ruta = o.pos FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos)
       WHERE e.id = o.id AND e.repartidor_id = $2`, [ids, repartidorId]);
    if (r.rowCount !== ids.length) throw falla(403, 'Solo puedes ordenar envíos asignados a ti');
    return r.rowCount;
  });
  res.json({ ok: true, ordenados: n });
}));

async function envioAccesible(req) {
  const envio = await cargarEnvio(idNumerico(req.params.id));
  exigirAcceso(req.usuario, envio);
  return envio;
}

envios.get('/:id', ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  res.json(await detalleCompleto(envio, req.usuario));
}));

envios.post('/:id/confirmar', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (envio.estado !== 'borrador') throw falla(409, 'El envío ya fue confirmado');
  const folio = await transaccion((db) => confirmar(db, envio.id, req.usuario.id));
  await auditar(req, 'confirmar', 'envio', envio.id, { folio });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

envios.post('/:id/asignar', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const repartidorId = req.body.repartidor_id ? Number(req.body.repartidor_id) : null;
  if (!['creado', 'asignado'].includes(envio.estado)) throw falla(409, `No se puede asignar un envío en estado "${ESTADOS[envio.estado]}"`);
  if (repartidorId) {
    const rep = await uno("SELECT id FROM usuario WHERE id = $1 AND rol = 'repartidor' AND activo", [repartidorId]);
    if (!rep) throw falla(422, 'Repartidor no válido');
  }
  const nuevo = repartidorId ? 'asignado' : 'creado';
  await transaccion(async (db) => {
    exigirSinConflicto(await db.query(
      `UPDATE envio SET repartidor_id = $1, estado = $2, actualizado_en = now()
       WHERE id = $3 AND estado = $4 AND repartidor_id IS NOT DISTINCT FROM $5`,
      [repartidorId, nuevo, envio.id, envio.estado, envio.repartidor_id]));
    if (nuevo !== envio.estado || repartidorId !== envio.repartidor_id) {
      await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo, usuarioId: req.usuario.id, motivo: repartidorId ? null : 'Repartidor desasignado' });
    }
  });
  await auditar(req, 'asignar', 'envio', envio.id, { repartidor_id: repartidorId });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// Cambio de estado genérico (retirar, fallido, reagendar, devolver, anular).
envios.post('/:id/estado', ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const { estado: nuevo, motivo, detalle } = req.body || {};
  if (nuevo === 'entregado') throw falla(400, 'Para entregar usa /entregar (foto y GPS obligatorios)');
  if (nuevo === 'creado' && envio.estado === 'borrador') throw falla(400, 'Para confirmar usa /confirmar');
  if (!ESTADOS[nuevo]) throw falla(422, 'Estado inválido');
  const permitido = rolPuedeTransicionar(req.usuario.rol, envio.estado, nuevo, {
    esDueno: envio.cliente_id === req.usuario.id, esAsignado: envio.repartidor_id === req.usuario.id, estadoPago: envio.estado_pago,
  });
  if (!permitido) throw falla(403, 'Tu perfil no puede realizar este cambio de estado');

  const conf = await leerConfig();
  validarTransicion({ actual: envio.estado, nuevo, estadoPago: envio.estado_pago, intentos: envio.intentos, config: conf, motivo, llegadaEn: envio.llegada_en });
  const ubic = nuevo === 'fallido' ? validarUbicacion(req.body, false) : null;
  const textoMotivo = [motivo, detalle].filter(Boolean).join(' — ') || null;

  await transaccion(async (db) => {
    const sets = ['estado = $1', 'actualizado_en = now()'];
    if (nuevo === 'fallido') sets.push('intentos = intentos + 1', 'llegada_en = NULL');
    if (nuevo === 'reagendado') sets.push('llegada_en = NULL');
    if (nuevo === 'creado') sets.push('repartidor_id = NULL');
    exigirSinConflicto(await db.query(`UPDATE envio SET ${sets.join(', ')} WHERE id = $2 AND estado = $3 AND intentos = $4`,
      [nuevo, envio.id, envio.estado, envio.intentos]));
    await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo, motivo: textoMotivo, usuarioId: req.usuario.id, lat: ubic?.lat, lon: ubic?.lon });
  });
  await auditar(req, 'cambiar_estado', 'envio', envio.id, { de: envio.estado, a: nuevo, motivo: textoMotivo });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// El repartidor registra que llegó al destino: empieza la espera máxima (5 min).
envios.post('/:id/llegada', requiereRol('admin', 'repartidor'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (envio.estado !== 'en_ruta') throw falla(409, 'Solo se registra la llegada de un envío en ruta');
  const conf = await leerConfig();
  const { rows: [act] } = await query('UPDATE envio SET llegada_en = COALESCE(llegada_en, now()), actualizado_en = now() WHERE id = $1 RETURNING llegada_en', [envio.id]);
  await auditar(req, 'llegada', 'envio', envio.id);
  res.json({ llegada_en: act.llegada_en, espera_max_min: conf.operacion.espera_max_min });
}));

// Cierre de entrega: foto OBLIGATORIA + ubicación GPS.
envios.post('/:id/entregar', requiereRol('admin', 'repartidor'), subida.single('foto'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (req.usuario.rol === 'repartidor' && envio.repartidor_id !== req.usuario.id) throw falla(403, 'El envío no está asignado a ti');
  const conf = await leerConfig();
  validarTransicion({ actual: envio.estado, nuevo: 'entregado', estadoPago: envio.estado_pago, intentos: envio.intentos, config: conf });
  if (!req.file) throw falla(422, 'La foto de la entrega es obligatoria para cerrar el envío', { foto: 'Obligatoria' });
  if (!MIME_IMAGEN.includes(req.file.mimetype)) throw falla(422, 'La foto debe ser JPG, PNG o WebP', { foto: 'Formato inválido' });
  const ubic = validarUbicacion(req.body, conf.operacion.gps_obligatorio);

  const archivo = await guardarArchivo(quitarExif(req.file.buffer), req.file.mimetype);
  await transaccion(async (db) => {
    await db.query(
      `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
       VALUES ($1, 'foto_entrega', $2, $3, $4, $5, $6, $7)`,
      [envio.id, req.file.originalname, req.file.mimetype, archivo.tamano, archivo.ruta, archivo.sha256, req.usuario.id],
    );
    exigirSinConflicto(await db.query(
      `UPDATE envio SET estado = 'entregado', entregado_en = now(), entrega_lat = $1, entrega_lon = $2, entrega_precision_m = $3,
         entrega_receptor = $4, actualizado_en = now() WHERE id = $5 AND estado = $6`,
      [ubic?.lat ?? null, ubic?.lon ?? null, req.body.precision ? Number(req.body.precision) : null, req.body.receptor || null, envio.id, envio.estado],
    ));
    await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo: 'entregado', usuarioId: req.usuario.id, lat: ubic?.lat, lon: ubic?.lon, motivo: req.body.receptor ? `Recibe: ${req.body.receptor}` : null });
  });
  await auditar(req, 'entregar', 'envio', envio.id, { lat: ubic?.lat, lon: ubic?.lon });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// Adjuntar foto del paquete o boleta de compra (respaldo del valor declarado para el seguro).
envios.post('/:id/adjuntos', requiereRol('admin', 'cliente'), subida.single('archivo'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const tipo = req.body.tipo;
  if (!['foto_paquete', 'boleta'].includes(tipo)) throw falla(422, 'Tipo de adjunto inválido');
  if (!req.file) throw falla(422, 'Adjunta un archivo');
  const permitidos = tipo === 'boleta' ? [...MIME_IMAGEN, 'application/pdf'] : MIME_IMAGEN;
  if (!permitidos.includes(req.file.mimetype)) throw falla(422, 'Formato de archivo no permitido');
  const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
  const archivo = await guardarArchivo(buffer, req.file.mimetype);
  const adj = await uno(
    `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, tipo, nombre_original, mime, tamano, subido_en`,
    [envio.id, tipo, req.file.originalname, req.file.mimetype, archivo.tamano, archivo.ruta, archivo.sha256, req.usuario.id],
  );
  await auditar(req, 'adjuntar', 'envio', envio.id, { tipo, adjunto_id: adj.id });
  res.status(201).json(adj);
}));

// ---------- Pago previo al retiro ----------

envios.post('/:id/pago', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (['borrador', 'anulado'].includes(envio.estado)) throw falla(409, 'Confirma el envío antes de pagar');
  if (envio.estado_pago === 'pagado') throw falla(409, 'El envío ya está pagado');
  const conf = await leerConfig();
  const token = crypto.randomBytes(18).toString('base64url');
  const pago = await uno(
    'INSERT INTO pago (envio_id, proveedor, monto, token) VALUES ($1, $2, $3, $4) RETURNING id, proveedor, monto, estado, token',
    [envio.id, conf.pagos.proveedor, envio.tarifa_total, token],
  );
  await auditar(req, 'iniciar_pago', 'envio', envio.id, { pago_id: pago.id, monto: pago.monto });
  res.status(201).json(pago);
}));

envios.post('/:id/pago-manual', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const medio = req.body.medio;
  if (!['transferencia', 'efectivo', 'otro'].includes(medio)) throw falla(422, 'Medio de pago inválido');
  if (envio.estado_pago === 'pagado') throw falla(409, 'El envío ya está pagado');
  if (['borrador', 'anulado'].includes(envio.estado)) throw falla(409, 'No se puede registrar pago en este estado');
  exigirSinConflicto(await query(
    `UPDATE envio SET estado_pago = 'pagado', pago_medio = $1, pago_referencia = $2, pagado_en = now(), actualizado_en = now()
     WHERE id = $3 AND estado_pago <> 'pagado' AND estado NOT IN ('borrador', 'anulado')`,
    [medio, req.body.referencia || null, envio.id],
  ));
  await auditar(req, 'pago_manual', 'envio', envio.id, { medio, referencia: req.body.referencia });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// Reembolso del pago de un envío anulado o devuelto (RF-57). La política (total o parcial) la define el cliente (C-7).
envios.post('/:id/reembolso', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const monto = Number(req.body?.monto ?? envio.tarifa_total);
  const medio = req.body?.medio;
  if (!['anulado', 'devuelto'].includes(envio.estado)) throw falla(409, 'Solo se reembolsa un envío anulado o devuelto');
  if (envio.estado_pago !== 'pagado') throw falla(409, envio.estado_pago === 'reembolsado' ? 'El envío ya fue reembolsado' : 'El envío no está pagado');
  const errores = {};
  if (!Number.isInteger(monto) || monto <= 0 || monto > envio.tarifa_total) errores.monto = `Entre $1 y $${envio.tarifa_total.toLocaleString('es-CL')}`;
  if (!['transferencia', 'efectivo', 'pasarela', 'otro'].includes(medio)) errores.medio = 'Medio inválido';
  exigirSinErrores(errores);
  exigirSinConflicto(await query(
    `UPDATE envio SET estado_pago = 'reembolsado', reembolso_monto = $1, reembolso_medio = $2, reembolso_nota = $3, reembolsado_en = now(), actualizado_en = now()
     WHERE id = $4 AND estado_pago = 'pagado'`, [monto, medio, String(req.body?.nota || '').trim() || null, envio.id]));
  await auditar(req, 'reembolsar', 'envio', envio.id, { monto, medio });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// ---------- Ticket y QR ----------

envios.get('/:id/qr.png', ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (!envio.folio) throw falla(409, 'El envío aún no tiene folio');
  res.type('png').send(await generarQrPng(urlQr(envio)));
}));

envios.get('/:id/ticket.pdf', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (!envio.folio) throw falla(409, 'Confirma el envío para emitir el ticket');
  const pdf = await generarTicketPdf(envio, await leerConfig(), req.query.formato === 'a4' ? 'a4' : '80mm');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ticket-${envio.folio}.pdf"`);
  res.send(pdf);
}));
