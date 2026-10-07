import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, fechaFiltro, idNumerico, patronBusqueda, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import {
  calcularTarifa, normalizarRut, normalizarTelefono, rolPuedeTransicionar, validarDestinatario, validarDestino, vistaDisponible,
  validarCambioDestino, validarDireccion, validarPaquete, validarReagendarRetiro, validarRetiro, validarSubidaComprobante, validarTransicion, validarUbicacion,
  ESTADOS, LIMITES, MIME_COMPROBANTE, TAMANOS,
} from '../lib/reglas.js';
import {
  cargarEnvio, detalleCompleto, exigirAcceso, exigirSinConflicto, presentar, puedeVerTicket, registrarEstado, SELECT_ENVIO, siguienteFolio, tarifaDeComuna,
} from '../lib/envios.js';
import { conArchivo, firmarLote, subida, subidaEntrega, verificarLote, verificarTicket } from '../lib/archivos.js';
import { optimizarRuta } from '../lib/rutas.js';
import { INICIO_PLAZO, PREFIJO_VENCIDO } from '../lib/vencimientos.js';
import { quitarExif } from '../lib/exif.js';
import { generarEtiquetasPdf, generarQrPng, generarTicketPdf, urlQr } from '../lib/ticket.js';
import { COMPROBANTE_EN_REVISION, PAGO_EN_LINEA_APAGADO, cerrarCobrosAbiertos, iniciarPago, registrarComprobante, registrarComprobanteLote, registrarEventoPago, registrarPagoManual } from '../lib/pagos.js';
import { registrarEvento } from '../lib/seguridad.js';
import { requiereRol } from '../middleware/auth.js';

export const envios = Router();

const MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];
const ESTADOS_PAGO = { pendiente: 'Pendiente', en_revision: 'Pendiente de aprobación', pagado: 'Pagado', reembolsado: 'Reembolsado' };
// Fotos y boletas que un envío puede acumular (evita llenar el almacenamiento subiendo archivos sin fin).
const MAX_ADJUNTOS = 20;
// Estados en que el envío sigue en la ruta de un repartidor.
const EN_RUTA_REPARTIDOR = ['asignado', 'en_ruta', 'fallido', 'reagendado'];

// Medida opcional (con tamaño declarado puede venir vacía): vacío → null, si no, número.
const medida = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function datosPaquete(b) {
  return {
    tipo_destino: b.tipo_destino || 'domicilio',
    courier_empresa: b.tipo_destino === 'punto_courier' ? b.courier_empresa : null,
    courier_punto: b.tipo_destino === 'punto_courier' ? String(b.courier_punto || '').trim() : null,
    courier_codigo: b.tipo_destino === 'punto_courier' ? String(b.courier_codigo || '').trim() || null : null,
    descripcion_producto: String(b.descripcion_producto || '').trim(),
    tamano: b.tamano || null, // estandar | sobredimensionado (el cliente solo marca una opción)
    bultos: Number(b.bultos ?? 1),
    // La base guarda el peso con 2 decimales: se redondea antes de cotizar para cobrar por el mismo peso que queda guardado
    // (10,004 kg se guardaba como 10,00 kg pero se cobraba como sobredimensionado).
    peso_kg: b.peso_kg === '' || b.peso_kg === null || b.peso_kg === undefined ? null : Math.round(Number(b.peso_kg) * 100) / 100,
    largo_cm: medida(b.largo_cm),
    ancho_cm: medida(b.ancho_cm),
    alto_cm: medida(b.alto_cm),
    valor_declarado: Number(b.valor_declarado || 0),
    horario_especial: b.horario_especial === true || b.horario_especial === 'true',
    franja_horaria: String(b.franja_horaria || '').trim() || null,
    observaciones: String(b.observaciones || '').trim() || null,
  };
}

// Valida paquete + destino y calcula la tarifa. Usado por /cotizar y al crear.
async function cotizar(body, usuario, conf) {
  const paquete = datosPaquete(body);
  // Sobre 20 kg o 60×60×60 cm por bulto no se toma el despacho (ni con tarifa manual).
  const errores = { ...validarDestino(paquete, conf.listas, conf.operacion.punto_courier), ...validarPaquete(paquete, conf.tarifas) };
  const tarifaManual = usuario.rol === 'admin' && body.tarifa_manual !== undefined && body.tarifa_manual !== '' && body.tarifa_manual !== null
    ? Number(body.tarifa_manual) : null;

  let comuna = null;
  const comunaId = body.direccion?.comuna_id || body.comuna_id;
  if (comunaId) {
    comuna = await tarifaDeComuna(Number(comunaId));
    if (!comuna) errores.comuna_id = 'Comuna inexistente';
    else if (!comuna.en_cobertura) errores.comuna_id = `${comuna.nombre} está fuera de la zona de cobertura`;
  }

  const tarifa = calcularTarifa(paquete, conf.tarifas, comuna?.tarifa ?? null);
  if (tarifaManual !== null) {
    if (!Number.isInteger(tarifaManual) || tarifaManual < 0 || tarifaManual > LIMITES.monto) errores.tarifa_manual = 'Tarifa manual inválida';
    else Object.assign(tarifa, { tarifa_base: tarifaManual, recargo_bultos: 0, recargo_sobredimension: 0, recargo_horario: 0, tarifa_total: tarifaManual });
  }
  return { paquete, tarifa, errores, comuna };
}

// El repartidor no ve montos: cotizar es solo para quien crea envíos.
// Dirección de retiro guardada del cliente (la última que usó), para precargarla en un envío nuevo.
envios.get('/retiro-guardado', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const clienteId = req.usuario.rol === 'cliente' ? req.usuario.id : idNumerico(req.query.cliente_id);
  const r = await uno(
    `SELECT u.retiro_calle AS calle, u.retiro_numero AS numero, u.retiro_depto AS depto, u.retiro_referencia AS referencia,
       u.retiro_comuna_id AS comuna_id, c.nombre AS comuna_nombre
     FROM usuario u LEFT JOIN comuna c ON c.id = u.retiro_comuna_id WHERE u.id = $1`, [clienteId]);
  res.json(r?.calle ? r : null);
}));

envios.post('/cotizar', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
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
    // Solo clientes activos: un cliente desactivado no puede tener envíos nuevos a su nombre.
    const cli = Number.isInteger(clienteId) ? await uno("SELECT id FROM usuario WHERE id = $1 AND rol = 'cliente' AND activo", [clienteId]) : null;
    if (!cli) throw falla(422, 'Selecciona el cliente dueño del envío (debe estar activo)', { cliente_id: 'Obligatorio' });
  }

  const errores = {};
  // Una dirección guardada define a su destinatario: no se puede combinar con otro destinatario.
  if (b.direccion_id && !b.destinatario_id) {
    const dueno = await uno('SELECT destinatario_id FROM direccion WHERE id = $1', [Number(b.direccion_id)]);
    if (dueno) b.destinatario_id = dueno.destinatario_id;
  }
  if (!b.destinatario_id) Object.assign(errores, prefijar('destinatario', validarDestinatario(b.destinatario)));
  // Dirección de RETIRO (dónde el repartidor recoge el paquete). Si no viene, se usa la guardada del cliente.
  let retiro = b.retiro && typeof b.retiro === 'object' ? b.retiro : null;
  if (!retiro) {
    const g = await uno('SELECT retiro_calle AS calle, retiro_numero AS numero, retiro_depto AS depto, retiro_referencia AS referencia, retiro_comuna_id AS comuna_id FROM usuario WHERE id = $1', [clienteId]);
    if (g?.calle) retiro = g;
  }
  Object.assign(errores, prefijar('retiro', validarRetiro(retiro || {})));
  if (retiro?.comuna_id) {
    const rc = await tarifaDeComuna(Number(retiro.comuna_id));
    if (!rc) errores['retiro.comuna_id'] = 'Comuna inexistente';
    else if (!rc.en_cobertura) errores['retiro.comuna_id'] = `${rc.nombre} está fuera de la zona de cobertura: no retiramos ahí`;
  }
  if (!b.direccion_id) Object.assign(errores, prefijar('direccion', validarDireccion(b.direccion)));
  // Coordenadas opcionales de la dirección nueva: si vienen, deben ser números dentro de rango.
  let coords = null;
  if (!b.direccion_id && b.direccion) {
    try { coords = validarUbicacion({ lat: b.direccion.lat, lon: b.direccion.lon }, false); } catch { errores['direccion.lat'] = 'Coordenadas GPS inválidas'; }
  }

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
      const { rows } = await db.query('SELECT id, anonimizado_en FROM destinatario WHERE id = $1 AND cliente_id = $2', [destinatarioId, clienteId]);
      if (!rows[0]) throw falla(422, 'Destinatario no encontrado en la libreta del cliente');
      // Un titular anonimizado (Ley 21.719) no recibe envíos nuevos: se le volvería a asociar una dirección y datos.
      if (rows[0].anonimizado_en) throw falla(409, 'Este destinatario fue anonimizado: crea uno nuevo para enviarle', { destinatario_id: 'Anonimizado' });
    } else {
      const d = b.destinatario;
      // Si el cliente ya tiene en su libreta a esta persona (mismo nombre y teléfono), se reutiliza: antes cada envío
      // creaba otro registro igual y la libreta se llenaba de repetidos.
      const { rows: [existente] } = await db.query(
        `SELECT id FROM destinatario WHERE cliente_id = $1 AND telefono = $2 AND lower(btrim(nombre)) = lower($3) AND anonimizado_en IS NULL
         ORDER BY id LIMIT 1`, [clienteId, normalizarTelefono(d.telefono), d.nombre.trim()]);
      if (existente) destinatarioId = existente.id;
      else {
        const { rows: [nuevo] } = await db.query(
          `INSERT INTO destinatario (cliente_id, nombre, telefono, correo, rut, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [clienteId, d.nombre.trim(), normalizarTelefono(d.telefono), d.correo || null, normalizarRut(d.rut), d.notas || null],
        );
        destinatarioId = nuevo.id;
      }
    }

    let direccionId = b.direccion_id ? Number(b.direccion_id) : null;
    if (!direccionId) {
      // La misma dirección (calle, número, depto y comuna) ya guardada para este destinatario se reutiliza.
      const di = b.direccion;
      const { rows: [igual] } = await db.query(
        `SELECT id FROM direccion WHERE destinatario_id = $1 AND activa AND comuna_id = $2 AND lower(btrim(calle)) = lower($3)
           AND lower(btrim(numero)) = lower($4) AND lower(COALESCE(btrim(depto), '')) = lower($5) ORDER BY id LIMIT 1`,
        [destinatarioId, Number(di.comuna_id), di.calle.trim(), String(di.numero).trim(), String(di.depto || '').trim()]);
      if (igual) {
        direccionId = igual.id;
        // Si la dirección guardada no tenía coordenadas y ahora vienen, se completan (no se pierde el dato nuevo).
        if (coords) await db.query('UPDATE direccion SET lat = $1, lon = $2 WHERE id = $3 AND lat IS NULL', [coords.lat, coords.lon, igual.id]);
      }
    }
    if (!direccionId) {
      const di = b.direccion;
      const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM direccion WHERE destinatario_id = $1 AND activa', [destinatarioId]);
      const { rows: [nueva] } = await db.query(
        `INSERT INTO direccion (destinatario_id, alias, calle, numero, depto, referencia, comuna_id, lat, lon, es_principal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [destinatarioId, di.alias || null, di.calle.trim(), String(di.numero).trim(), di.depto || null, di.referencia || null,
          Number(di.comuna_id), coords?.lat ?? null, coords?.lon ?? null, n === 0],
      );
      direccionId = nueva.id;
    }

    const { rows: [e] } = await db.query(
      `INSERT INTO envio (token_qr, cliente_id, destinatario_id, direccion_id, comuna_id, tipo_destino, courier_empresa, courier_punto,
         courier_codigo, descripcion_producto, bultos, peso_kg, largo_cm, ancho_cm, alto_cm, valor_declarado, horario_especial,
         franja_horaria, tarifa_base, recargo_bultos, recargo_horario, tarifa_total, observaciones, creado_por, recargo_sobredimension,
         tamano, retiro_calle, retiro_numero, retiro_depto, retiro_referencia, retiro_comuna_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31) RETURNING id`,
      [crypto.randomBytes(18).toString('base64url'), clienteId, destinatarioId, direccionId, Number(comunaId), paquete.tipo_destino,
        paquete.courier_empresa, paquete.courier_punto, paquete.courier_codigo, paquete.descripcion_producto, paquete.bultos,
        paquete.peso_kg, paquete.largo_cm, paquete.ancho_cm, paquete.alto_cm, paquete.valor_declarado, paquete.horario_especial,
        paquete.horario_especial ? paquete.franja_horaria : null, tarifa.tarifa_base, tarifa.recargo_bultos, tarifa.recargo_horario,
        tarifa.tarifa_total, paquete.observaciones, req.usuario.id, tarifa.recargo_sobredimension,
        paquete.tamano, retiro.calle.trim(), String(retiro.numero).trim(), String(retiro.depto || '').trim() || null,
        String(retiro.referencia || '').trim() || null, Number(retiro.comuna_id)],
    );
    await registrarEstado(db, { envioId: e.id, anterior: null, nuevo: 'borrador', usuarioId: req.usuario.id });
    // La dirección de retiro queda guardada en el cliente: el próximo envío la trae lista.
    if (b.retiro && b.guardar_retiro !== false) {
      await db.query(
        `UPDATE usuario SET retiro_calle = $1, retiro_numero = $2, retiro_depto = $3, retiro_referencia = $4, retiro_comuna_id = $5 WHERE id = $6`,
        [retiro.calle.trim(), String(retiro.numero).trim(), String(retiro.depto || '').trim() || null, String(retiro.referencia || '').trim() || null,
          Number(retiro.comuna_id), clienteId]);
    }
    // Solo true confirma: el texto "false" (formularios) no debe confirmar el envío ni gastar un folio.
    if (b.confirmar === true || b.confirmar === 'true') await confirmar(db, e.id, req.usuario.id);
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
const TZ = "AT TIME ZONE 'America/Santiago'";
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
// Cuándo se anuló el envío (último cambio a "anulado" en su historial).
const ANULADO_EN = "COALESCE((SELECT max(h.fecha) FROM envio_estado h WHERE h.envio_id = e.id AND h.estado_nuevo = 'anulado'), e.actualizado_en)";

function filtrosListado(req) {
  const q = req.query;
  const cond = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const idFiltro = (v, nombre) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw falla(400, `${nombre} inválido`); return n; };
  if (req.usuario.rol === 'cliente') {
    cond.push(`e.cliente_id = ${p(req.usuario.id)}`);
    // Los anulados desaparecen de la cuenta del cliente 24 h después de anularse, o antes si los elimina (pedido 07-10).
    cond.push(`NOT (e.estado = 'anulado' AND (e.oculto_cliente_en IS NOT NULL OR ${ANULADO_EN} < now() - interval '24 hours'))`);
  }
  if (req.usuario.rol === 'repartidor') cond.push(`e.repartidor_id = ${p(req.usuario.id)}`);
  if (q.estado) cond.push(`e.estado = ANY(${p(String(q.estado).split(','))})`);
  if (q.estado_pago) cond.push(`e.estado_pago = ${p(String(q.estado_pago))}`);
  if (q.comuna_id) cond.push(`e.comuna_id = ${p(idFiltro(q.comuna_id, 'comuna_id'))}`);
  if (q.repartidor_id) cond.push(q.repartidor_id === 'sin' ? 'e.repartidor_id IS NULL' : `e.repartidor_id = ${p(idFiltro(q.repartidor_id, 'repartidor_id'))}`);
  if (q.cliente_id && req.usuario.rol === 'admin') cond.push(`e.cliente_id = ${p(idFiltro(q.cliente_id, 'cliente_id'))}`);
  // Las fechas se comparan en hora de Chile (la base puede estar en UTC).
  const desde = fechaFiltro(q.desde, 'desde');
  const hasta = fechaFiltro(q.hasta, 'hasta');
  if (desde) cond.push(`(e.creado_en ${TZ})::date >= ${p(desde)}::date`);
  if (hasta) cond.push(`(e.creado_en ${TZ})::date <= ${p(hasta)}::date`);
  // Envíos cerrados (entregados o devueltos) hoy, sin importar cuándo se crearon.
  // La fecha del cierre es la del cambio a entregado/devuelto (no la última modificación: un reembolso u otro cambio
  // posterior hacía contar como "cerrado hoy" un envío devuelto otro día).
  if (q.cerrados === 'hoy') {
    cond.push(`e.estado IN ('entregado', 'devuelto') AND (COALESCE(e.entregado_en,
      (SELECT max(h.fecha) FROM envio_estado h WHERE h.envio_id = e.id AND h.estado_nuevo = e.estado)) ${TZ})::date = ${p(hoyChile())}::date`);
  }
  if (q.q) {
    const t = p(patronBusqueda(q.q));
    cond.push(`(e.folio ILIKE ${t} OR d.nombre ILIKE ${t} OR d.telefono ILIKE ${t} OR di.calle ILIKE ${t} OR c.nombre ILIKE ${t})`);
  }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

envios.get('/', ruta(async (req, res) => {
  const { where, params } = filtrosListado(req);
  const limite = Math.min(Math.max(Math.trunc(Number(req.query.limite)) || 20, 1), 100);
  const pagina = Math.min(Math.max(Math.trunc(Number(req.query.pagina)) || 1, 1), 100000);
  const total = await uno(
    `SELECT count(*)::int AS n FROM envio e JOIN destinatario d ON d.id = e.destinatario_id
     JOIN direccion di ON di.id = e.direccion_id JOIN comuna c ON c.id = e.comuna_id ${where}`, params);
  // orden=ruta: el orden que definió el repartidor (RF-60); lo no ordenado va al final agrupado por comuna.
  const orden = req.query.orden === 'ruta' ? 'e.orden_ruta NULLS LAST, c.nombre, e.creado_en' : 'e.creado_en DESC, e.id DESC';
  const { rows } = await query(
    `${SELECT_ENVIO} ${where} ORDER BY ${orden} LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`, params);
  res.json({ total: total.n, pagina, limite, items: rows.map((e) => presentar(e, req.usuario)) });
}));

// Resumen para la pantalla de inicio: cuenta TODOS los envíos visibles (no solo los últimos 100 de la lista).
envios.get('/resumen', ruta(async (req, res) => {
  const { where, params } = filtrosListado({ usuario: req.usuario, query: {} });
  const r = await uno(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE e.estado IN ('creado','asignado','en_ruta','fallido','reagendado'))::int AS en_curso,
       count(*) FILTER (WHERE e.estado_pago = 'pendiente' AND e.estado NOT IN ('borrador','anulado'))::int AS por_pagar,
       COALESCE(sum(e.tarifa_total) FILTER (WHERE e.estado_pago = 'pendiente' AND e.estado NOT IN ('borrador','anulado')), 0)::int AS monto_por_pagar,
       count(*) FILTER (WHERE e.estado_pago = 'en_revision' AND e.estado <> 'anulado')::int AS en_revision,
       count(*) FILTER (WHERE e.estado = 'entregado')::int AS entregados,
       min(${INICIO_PLAZO}) FILTER (WHERE e.estado = 'creado' AND e.estado_pago = 'pendiente' AND e.repartidor_id IS NULL)
         + make_interval(hours => ${Number(config.horasSinPago)}) AS proximo_vence_en
     FROM envio e JOIN destinatario d ON d.id = e.destinatario_id JOIN direccion di ON di.id = e.direccion_id JOIN comuna c ON c.id = e.comuna_id ${where}`, params);
  if (req.usuario.rol === 'repartidor') delete r.monto_por_pagar;
  res.json(r);
}));

// Exportación CSV de lo que se está viendo (RF-37). Separador ";" para Excel en español.
envios.get('/exportar.csv', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const { where, params } = filtrosListado(req);
  const { rows } = await query(`${SELECT_ENVIO} ${where} ORDER BY e.creado_en DESC LIMIT 20000`, params);
  const cols = [
    ['Folio', 'folio'], ['Estado', (e) => ESTADOS[e.estado]], ['Pago', (e) => ESTADOS_PAGO[e.estado_pago] || e.estado_pago], ['Creado', (e) => new Date(e.creado_en).toLocaleString('es-CL', { timeZone: 'America/Santiago' })],
    ['Cliente', 'cliente_nombre'], ['Destinatario', 'destinatario_nombre'], ['Teléfono', 'destinatario_telefono'],
    ['Dirección', (e) => `${e.calle} ${e.numero}${e.depto ? ' ' + e.depto : ''}`], ['Comuna', 'comuna_nombre'],
    ['Tipo destino', 'tipo_destino'], ['Courier', 'courier_empresa'], ['Producto', 'descripcion_producto'], ['Bultos', 'bultos'],
    // Excel en español (Chile) usa coma decimal: "2.5" se leería como 25 o como texto.
    ['Tamaño', (e) => TAMANOS[e.tamano] || ''], ['Peso kg', (e) => (e.peso_kg == null ? '' : String(e.peso_kg).replace('.', ','))], ...(req.usuario.rol === 'admin' ? [['Valor declarado', 'valor_declarado']] : []), ['Horario especial', (e) => (e.horario_especial ? 'Sí' : 'No')],
    ['Tarifa total', 'tarifa_total'], ['Repartidor', 'repartidor_nombre'], ['Intentos', 'intentos'],
    ['Entregado', (e) => (e.entregado_en ? new Date(e.entregado_en).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '')],
  ];
  // Inyección de fórmulas: un texto que empieza con = + - @ se ejecutaría como fórmula al abrirlo en Excel.
  const celda = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const lineas = [cols.map(([t]) => celda(t)).join(';')];
  for (const e of rows) lineas.push(cols.map(([, c]) => celda(typeof c === 'function' ? c(e) : e[c])).join(';'));
  await registrarEvento(req, 'exportacion', { registros: rows.length, detalle: { filtros: req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="envios-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lineas.join('\r\n'));
}));

// Envíos pagados que aún no tienen repartidor: el repartidor los ve y puede tomarlos.
// Sin esto, un envío recién pagado no le aparece a ningún repartidor hasta que administración lo asigne.
const SIN_ASIGNAR = "e.estado = 'creado' AND e.repartidor_id IS NULL AND e.estado_pago = 'pagado'";

envios.get('/disponibles', requiereRol('admin', 'repartidor'), ruta(async (req, res) => {
  const conf = await leerConfig();
  if (req.usuario.rol === 'repartidor' && !conf.operacion.autoasignacion) return res.json({ autoasignacion: false, total: 0, items: [] });
  // Por páginas y con el total real: antes devolvía solo los 100 más antiguos y decía que eran todos, así que con más
  // de 100 envíos pagados sin asignar, los nuevos no le aparecían a ningún repartidor.
  const limite = Math.min(Math.max(Math.trunc(Number(req.query.limite)) || 100, 1), 500);
  const pagina = Math.min(Math.max(Math.trunc(Number(req.query.pagina)) || 1, 1), 100000);
  const [{ rows }, total] = await Promise.all([
    query(`${SELECT_ENVIO} WHERE ${SIN_ASIGNAR} ORDER BY e.horario_especial DESC, e.pagado_en, e.id LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`),
    uno(`SELECT count(*)::int AS n FROM envio e WHERE ${SIN_ASIGNAR}`),
  ]);
  const vista = req.usuario.rol === 'repartidor' ? (e) => vistaDisponible(presentar(e, req.usuario)) : (e) => presentar(e, req.usuario);
  res.json({ autoasignacion: conf.operacion.autoasignacion, total: total.n, pagina, limite, items: rows.map(vista) });
}));

// El repartidor toma un envío disponible. La condición va en el UPDATE para que, si dos
// repartidores lo toman al mismo tiempo, solo uno lo consiga.
envios.post('/:id/tomar', requiereRol('repartidor', 'admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const conf = await leerConfig();
  if (req.usuario.rol === 'repartidor' && !conf.operacion.autoasignacion) throw falla(403, 'Administración asigna los envíos: espera a que te asignen uno');
  const tomado = await transaccion(async (db) => {
    const { rows: [e] } = await db.query(
      `UPDATE envio e SET repartidor_id = $1, estado = 'asignado', actualizado_en = now() WHERE e.id = $2 AND ${SIN_ASIGNAR} RETURNING e.id`,
      [req.usuario.id, id]);
    if (!e) return null;
    await registrarEstado(db, { envioId: id, anterior: 'creado', nuevo: 'asignado', usuarioId: req.usuario.id, motivo: 'Tomado por el repartidor' });
    return e;
  });
  if (!tomado) {
    const actual = await uno('SELECT estado, estado_pago, repartidor_id FROM envio WHERE id = $1', [id]);
    if (!actual) throw falla(404, 'Envío no encontrado');
    if (actual.estado_pago !== 'pagado') throw falla(409, 'El envío aún no está pagado');
    throw falla(409, 'Este envío ya fue tomado por otro repartidor o ya no está disponible');
  }
  await auditar(req, 'tomar', 'envio', id);
  res.json(presentar(await cargarEnvio(id), req.usuario));
}));

// El repartidor ordena su ruta del día (RF-60). Solo puede ordenar envíos que tiene asignados.
envios.put('/ruta/orden', requiereRol('repartidor', 'admin'), ruta(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length || ids.length > 200 || ids.some((n) => !Number.isInteger(n) || n <= 0) || new Set(ids).size !== ids.length) {
    throw falla(422, 'Lista de envíos inválida');
  }
  // Sin repartidor_id, administración ordena su propia ruta (también reparte).
  const repartidorId = req.usuario.rol === 'repartidor' || !req.body.repartidor_id ? req.usuario.id : Number(req.body.repartidor_id);
  res.json({ ok: true, ordenados: await guardarOrden(ids, repartidorId) });
}));

// En una transacción: si hay un envío ajeno en la lista no se cambia nada.
function guardarOrden(ids, repartidorId) {
  return transaccion(async (db) => {
    const r = await db.query(
      `UPDATE envio e SET orden_ruta = o.pos FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos)
       WHERE e.id = o.id AND e.repartidor_id = $2 AND e.estado = ANY($3)`, [ids, repartidorId, EN_RUTA_REPARTIDOR]);
    if (r.rowCount !== ids.length) throw falla(403, 'Solo puedes ordenar envíos asignados a ti que siguen en tu ruta');
    return r.rowCount;
  });
}

// Ordena la ruta sola (pedido 03-10): desde donde está el repartidor (GPS del teléfono, opcional) hacia la parada
// más cercana. Igual que la pantalla: primero lo que va en ruta (a entregar) y después lo por retirar o reintentar.
envios.post('/ruta/optimizar', requiereRol('repartidor', 'admin'), ruta(async (req, res) => {
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const inicio = req.body?.lat != null && req.body?.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
  const { rows } = await query(
    `SELECT e.id, e.estado, di.lat, di.lon, di.calle, c.nombre AS comuna, e.retiro_calle, rc.nombre AS retiro_comuna, e.retiro_fecha
       FROM envio e JOIN direccion di ON di.id = e.direccion_id JOIN comuna c ON c.id = e.comuna_id
       LEFT JOIN comuna rc ON rc.id = e.retiro_comuna_id
      WHERE e.repartidor_id = $1 AND e.estado = ANY($2) ORDER BY e.id LIMIT 200`, [req.usuario.id, EN_RUTA_REPARTIDOR]);
  // Un envío por retirar se ubica en la dirección de retiro; los demás en la de entrega.
  const parada = (e) => (e.estado === 'asignado' && e.retiro_calle
    ? { id: e.id, comuna: e.retiro_comuna, calle: e.retiro_calle }
    : { id: e.id, lat: e.lat, lon: e.lon, comuna: e.comuna, calle: e.calle });
  // Los retiros reagendados para otro día (pedido 07-10) no entran en la ruta de hoy: van al final, por fecha.
  const hoy = hoyChile();
  const otroDia = (e) => e.estado === 'asignado' && e.retiro_fecha && e.retiro_fecha > hoy;
  const ids = [
    ...optimizarRuta(rows.filter((e) => e.estado === 'en_ruta').map(parada), inicio),
    ...optimizarRuta(rows.filter((e) => e.estado !== 'en_ruta' && !otroDia(e)).map(parada), inicio),
    ...rows.filter(otroDia).sort((a, b) => a.retiro_fecha.localeCompare(b.retiro_fecha) || a.id - b.id).map((e) => e.id),
  ];
  if (ids.length) await guardarOrden(ids, req.usuario.id);
  res.json({ ok: true, ids, con_gps: Boolean(inicio) });
}));

// Escanear el QR de la etiqueta (pedido 03-10): el QR lleva el token del envío. El repartidor solo encuentra los
// envíos de su ruta; administración, cualquiera.
envios.get('/por-qr/:token', requiereRol('repartidor', 'admin'), ruta(async (req, res) => {
  const token = String(req.params.token || '');
  const fila = /^[A-Za-z0-9_-]{8,100}$/.test(token) ? await uno('SELECT id FROM envio WHERE token_qr = $1', [token]) : null;
  if (!fila) throw falla(404, 'Código QR no reconocido');
  const envio = await cargarEnvio(fila.id);
  if (req.usuario.rol === 'repartidor' && envio.repartidor_id !== req.usuario.id) throw falla(404, 'Este envío no está en tu ruta');
  res.json(presentar(envio, req.usuario));
}));

// Cobranza: envíos que se anulan pronto por falta de pago y los anulados así en los últimos 7 días (para reactivarlos).
const ULTIMA_ANULACION_AUTOMATICA = `(SELECT h.usuario_id IS NULL AND h.motivo LIKE '${PREFIJO_VENCIDO}%' AND h.fecha > now() - interval '7 days'
   FROM envio_estado h WHERE h.envio_id = e.id AND h.estado_nuevo = 'anulado' ORDER BY h.fecha DESC, h.id DESC LIMIT 1)`;
envios.get('/vencimientos', requiereRol('admin'), ruta(async (req, res) => {
  const [porVencer, anulados] = await Promise.all([
    query(`${SELECT_ENVIO} WHERE e.estado = 'creado' AND e.estado_pago = 'pendiente' AND e.repartidor_id IS NULL ORDER BY ${INICIO_PLAZO}, e.id LIMIT 200`),
    query(`${SELECT_ENVIO} WHERE e.estado = 'anulado' AND e.estado_pago = 'pendiente' AND ${ULTIMA_ANULACION_AUTOMATICA} ORDER BY e.actualizado_en DESC LIMIT 100`),
  ]);
  res.json({ horas: config.horasSinPago, por_vencer: porVencer.rows.map((e) => presentar(e, req.usuario)), anulados: anulados.rows.map((e) => presentar(e, req.usuario)) });
}));

// Etiquetas de los envíos confirmados un día (pedido 03-10): cuenta y enlace firmado al PDF con todas.
const DEL_DIA = "e.folio IS NOT NULL AND e.estado NOT IN ('borrador', 'anulado') AND (e.confirmado_en AT TIME ZONE 'America/Santiago')::date = $1::date";
const fechaValida = (f) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f; // descarta 2026-02-30 y similares
};
envios.get('/etiquetas-del-dia', requiereRol('admin'), ruta(async (req, res) => {
  const fecha = fechaValida(req.query.fecha) ? req.query.fecha : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const r = await uno(`SELECT count(*)::int AS envios, COALESCE(sum(e.bultos), 0)::int AS bultos FROM envio e WHERE ${DEL_DIA}`, [fecha]);
  res.json({ fecha, ...r, url: r.envios ? firmarLote(fecha, req.usuario.id) : null });
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
  if (!['creado', 'asignado', 'reagendado'].includes(envio.estado)) throw falla(409, `No se puede asignar un envío en estado "${ESTADOS[envio.estado]}"`);
  if (repartidorId) {
    // El pago manda: un envío sin pago aprobado no se entrega a ningún repartidor.
    if (envio.estado_pago !== 'pagado') {
      throw falla(409, envio.estado_pago === 'en_revision'
        ? 'El comprobante de pago está en revisión: apruébalo antes de asignar un repartidor'
        : 'El envío aún no está pagado: se asigna cuando el pago esté aprobado');
    }
    // Administración también reparte: se le puede asignar un envío a un administrador.
    const rep = await uno("SELECT id FROM usuario WHERE id = $1 AND rol IN ('repartidor', 'admin') AND activo", [repartidorId]);
    if (!rep) throw falla(422, 'Repartidor no válido');
  }
  // Un envío reagendado cambia de repartidor pero sigue "reagendado" (conserva sus intentos).
  if (envio.estado === 'reagendado' && !repartidorId) throw falla(422, 'Un envío reagendado debe quedar con un repartidor');
  const nuevo = envio.estado === 'reagendado' ? 'reagendado' : repartidorId ? 'asignado' : 'creado';
  await transaccion(async (db) => {
    exigirSinConflicto(await db.query(
      `UPDATE envio SET repartidor_id = $1, estado = $2, actualizado_en = now(),
         orden_ruta = CASE WHEN repartidor_id IS NOT DISTINCT FROM $1 THEN orden_ruta END
       WHERE id = $3 AND estado = $4 AND repartidor_id IS NOT DISTINCT FROM $5`,
      [repartidorId, nuevo, envio.id, envio.estado, envio.repartidor_id]));
    if (nuevo !== envio.estado || repartidorId !== envio.repartidor_id) {
      await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo, usuarioId: req.usuario.id, motivo: repartidorId ? (envio.repartidor_id && envio.repartidor_id !== repartidorId ? 'Cambio de repartidor' : null) : 'Repartidor desasignado' });
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
    if (nuevo === 'creado') sets.push('repartidor_id = NULL', 'orden_ruta = NULL');
    exigirSinConflicto(await db.query(`UPDATE envio SET ${sets.join(', ')} WHERE id = $2 AND estado = $3 AND intentos = $4`,
      [nuevo, envio.id, envio.estado, envio.intentos]));
    await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo, motivo: textoMotivo, usuarioId: req.usuario.id, lat: ubic?.lat, lon: ubic?.lon });
  });
  await auditar(req, 'cambiar_estado', 'envio', envio.id, { de: envio.estado, a: nuevo, motivo: textoMotivo });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// Reactivar un envío anulado automáticamente por falta de pago (pedido 03-10): vuelve a "creado" y el plazo de
// pago empieza de nuevo. Solo administración, y solo si la última anulación fue la automática.
envios.post('/:id/reactivar', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (envio.estado !== 'anulado') throw falla(409, 'Solo se reactiva un envío anulado');
  const ultima = await uno(
    "SELECT usuario_id, motivo FROM envio_estado WHERE envio_id = $1 AND estado_nuevo = 'anulado' ORDER BY fecha DESC, id DESC LIMIT 1", [envio.id]);
  if (!ultima || ultima.usuario_id !== null || !String(ultima.motivo || '').startsWith(PREFIJO_VENCIDO)) {
    throw falla(409, 'Solo se reactivan los envíos que se anularon solos por falta de pago');
  }
  if (envio.estado_pago !== 'pendiente') throw falla(409, 'El pago de este envío ya no está pendiente');
  await transaccion(async (db) => {
    exigirSinConflicto(await db.query(
      "UPDATE envio SET estado = 'creado', reactivado_en = now(), aviso_vencimiento_en = NULL, oculto_cliente_en = NULL, actualizado_en = now() WHERE id = $1 AND estado = 'anulado'", [envio.id]));
    await registrarEstado(db, { envioId: envio.id, anterior: 'anulado', nuevo: 'creado', motivo: `Reactivado por administración: tiene ${config.horasSinPago} horas más para pagar`, usuarioId: req.usuario.id });
  });
  await auditar(req, 'reactivar', 'envio', envio.id);
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// El cliente elimina de su cuenta un envío anulado (pedido 07-10). Solo se oculta: administración lo sigue viendo.
envios.post('/:id/ocultar', requiereRol('cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (envio.estado !== 'anulado') throw falla(409, 'Solo se pueden eliminar los envíos anulados');
  await query('UPDATE envio SET oculto_cliente_en = now() WHERE id = $1 AND oculto_cliente_en IS NULL', [envio.id]);
  await auditar(req, 'ocultar_anulado', 'envio', envio.id);
  res.json({ ok: true });
}));

// ---------- Cambiar el destino antes del retiro (pedido 07-10) ----------
// El cliente (o administración) elige otra dirección guardada del mismo destinatario o escribe una nueva. Se puede aunque
// el envío esté pagado, mientras el repartidor no haya retirado el paquete. Queda en el historial y hay que reimprimir la etiqueta.
const clpTexto = (n) => `$${Number(n).toLocaleString('es-CL')}`;
const textoDireccion = (d, comuna) => `${d.calle} ${d.numero}${d.depto ? `, ${d.depto}` : ''}, ${comuna}`;

envios.post('/:id/cambiar-destino', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const b = req.body || {};
  const conf = await leerConfig();
  const rol = req.usuario.rol;
  // Primero lo que no depende de la dirección nueva (estado, pago, cambios hechos): se responde sin pedir datos de más.
  validarCambioDestino(envio, 0, { rol });

  let nueva = null; // dirección guardada elegida
  let coords = null;
  let comunaId;
  if (b.direccion_id) {
    nueva = await uno('SELECT * FROM direccion WHERE id = $1 AND destinatario_id = $2 AND activa', [Number(b.direccion_id) || 0, envio.destinatario_id]);
    if (!nueva) throw falla(422, 'Esa dirección no es de este destinatario', { direccion_id: 'Dirección no encontrada' });
    if (nueva.id === envio.direccion_id) throw falla(422, 'El envío ya va a esa dirección', { direccion_id: 'Es la dirección actual' });
    comunaId = nueva.comuna_id;
  } else {
    const d = b.direccion && typeof b.direccion === 'object' ? b.direccion : {};
    const errores = prefijar('direccion', validarDireccion(d));
    try { coords = validarUbicacion({ lat: d.lat, lon: d.lon }, false); } catch { errores['direccion.lat'] = 'Coordenadas GPS inválidas'; }
    exigirSinErrores(errores);
    comunaId = Number(d.comuna_id);
  }
  const comuna = await tarifaDeComuna(Number(comunaId));
  if (!comuna) throw falla(422, 'Comuna inexistente', { 'direccion.comuna_id': 'Comuna inexistente' });
  if (!comuna.en_cobertura) throw falla(422, `${comuna.nombre} está fuera de la zona de cobertura`, { 'direccion.comuna_id': 'Fuera de cobertura' });
  // Misma comuna: el precio no cambia. Otra comuna: se recalcula con la tarifa de la nueva (mismos recargos del paquete).
  const tarifa = Number(comunaId) === envio.comuna_id
    ? { tarifa_base: envio.tarifa_base, recargo_bultos: envio.recargo_bultos, recargo_sobredimension: envio.recargo_sobredimension, recargo_horario: envio.recargo_horario, tarifa_total: envio.tarifa_total }
    : calcularTarifa(envio, conf.tarifas, comuna.tarifa);

  const resultado = await transaccion(async (db) => {
    // Se relee bloqueado: si mientras tanto el repartidor lo retiró o cambió el pago, se aplica la regla con lo actual.
    const { rows: [actual] } = await db.query('SELECT * FROM envio WHERE id = $1 FOR UPDATE', [envio.id]);
    const { actualizarTarifa } = validarCambioDestino(actual, tarifa.tarifa_total, { rol });
    let direccionId = nueva?.id;
    if (!direccionId) {
      const d = b.direccion;
      const { rows: [igual] } = await db.query(
        `SELECT id FROM direccion WHERE destinatario_id = $1 AND activa AND comuna_id = $2 AND lower(btrim(calle)) = lower($3)
           AND lower(btrim(numero)) = lower($4) AND lower(COALESCE(btrim(depto), '')) = lower($5) ORDER BY id LIMIT 1`,
        [actual.destinatario_id, Number(comunaId), String(d.calle).trim(), String(d.numero).trim(), String(d.depto || '').trim()]);
      if (igual?.id === actual.direccion_id) throw falla(422, 'El envío ya va a esa dirección', { 'direccion.calle': 'Es la dirección actual' });
      if (igual) direccionId = igual.id;
      else {
        const { rows: [creada] } = await db.query(
          `INSERT INTO direccion (destinatario_id, calle, numero, depto, referencia, comuna_id, lat, lon)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [actual.destinatario_id, String(d.calle).trim(), String(d.numero).trim(), String(d.depto || '').trim() || null,
            String(d.referencia || '').trim() || null, Number(comunaId), coords?.lat ?? null, coords?.lon ?? null]);
        direccionId = creada.id;
      }
    }
    const { rows: [anterior] } = await db.query(
      'SELECT di.calle, di.numero, di.depto, c.nombre AS comuna FROM direccion di JOIN comuna c ON c.id = di.comuna_id WHERE di.id = $1', [actual.direccion_id]);
    const { rows: [nuevaDir] } = await db.query(
      'SELECT di.calle, di.numero, di.depto, c.nombre AS comuna FROM direccion di JOIN comuna c ON c.id = di.comuna_id WHERE di.id = $1', [direccionId]);
    const cambiaMonto = actualizarTarifa && tarifa.tarifa_total !== actual.tarifa_total;
    await db.query(
      `UPDATE envio SET direccion_id = $1, comuna_id = $2, destino_cambiado = destino_cambiado + 1, orden_ruta = NULL, actualizado_en = now()
         ${actualizarTarifa ? ', tarifa_base = $4, recargo_sobredimension = $5, recargo_horario = $6, tarifa_total = $7' : ''}
       WHERE id = $3`,
      actualizarTarifa
        ? [direccionId, Number(comunaId), actual.id, tarifa.tarifa_base, tarifa.recargo_sobredimension, tarifa.recargo_horario, tarifa.tarifa_total]
        : [direccionId, Number(comunaId), actual.id]);
    // Un cobro abierto por el monto anterior ya no sirve.
    if (cambiaMonto) await cerrarCobrosAbiertos(db, actual.id, 'Cambió la dirección de destino y con ella el monto');
    const motivo = `Destino cambiado: ${textoDireccion(anterior, anterior.comuna)} → ${textoDireccion(nuevaDir, nuevaDir.comuna)}`
      + (cambiaMonto ? ` (nuevo monto ${clpTexto(tarifa.tarifa_total)})` : '');
    await registrarEstado(db, { envioId: actual.id, anterior: actual.estado, nuevo: actual.estado, motivo, usuarioId: req.usuario.id });
    return { cambiaMonto, antes: actual.tarifa_total };
  });
  await auditar(req, 'cambiar_destino', 'envio', envio.id, { direccion_id: Number(b.direccion_id) || null, monto_anterior: resultado.antes });
  res.json({ ...presentar(await cargarEnvio(envio.id), req.usuario), cambio_monto: resultado.cambiaMonto });
}));

// ---------- Reagendar el retiro (pedido 07-10) ----------
// Con el repartidor ya asignado (o antes), el cliente elige otro día de retiro. El repartidor lo sigue teniendo y ve la fecha.
const fechaLarga = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

envios.post('/:id/reagendar-retiro', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const rol = req.usuario.rol;
  validarReagendarRetiro(envio, req.body?.fecha, { hoy: hoyChile(), rol });
  const fecha = await transaccion(async (db) => {
    const { rows: [actual] } = await db.query('SELECT * FROM envio WHERE id = $1 FOR UPDATE', [envio.id]);
    const f = validarReagendarRetiro(actual, req.body?.fecha, { hoy: hoyChile(), rol });
    await db.query(
      'UPDATE envio SET retiro_fecha = $1, retiro_reagendado = retiro_reagendado + 1, orden_ruta = NULL, actualizado_en = now() WHERE id = $2', [f, actual.id]);
    const horario = (await leerConfig()).operacion.horario_retiro ? ' en el horario de retiro' : '';
    await registrarEstado(db, { envioId: actual.id, anterior: actual.estado, nuevo: actual.estado, motivo: `Retiro reagendado para el ${fechaLarga(f)}${horario}`, usuarioId: req.usuario.id });
    return f;
  });
  await auditar(req, 'reagendar_retiro', 'envio', envio.id, { fecha });
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
envios.post('/:id/entregar', requiereRol('admin', 'repartidor'), subidaEntrega.fields([{ name: 'foto', maxCount: 1 }, { name: 'firma', maxCount: 1 }]), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (req.usuario.rol === 'repartidor' && envio.repartidor_id !== req.usuario.id) throw falla(403, 'El envío no está asignado a ti');
  const conf = await leerConfig();
  validarTransicion({ actual: envio.estado, nuevo: 'entregado', estadoPago: envio.estado_pago, intentos: envio.intentos, config: conf });
  req.file = req.files?.foto?.[0];
  // Firma del destinatario en la pantalla (opcional, pedido 03-10): PNG dibujado en el teléfono del repartidor.
  const firma = req.files?.firma?.[0] || null;
  if (!req.file) throw falla(422, 'La foto de la entrega es obligatoria para cerrar el envío', { foto: 'Obligatoria' });
  if (!MIME_IMAGEN.includes(req.file.mimetype)) throw falla(422, 'La foto debe ser JPG, PNG o WebP', { foto: 'Formato inválido' });
  if (firma && (firma.mimetype !== 'image/png' || !firma.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))) {
    throw falla(422, 'La firma debe ser una imagen PNG', { firma: 'Formato inválido' });
  }
  const ubic = validarUbicacion(req.body, conf.operacion.gps_obligatorio);
  // Precisión del GPS en metros: número positivo o nada (Postgres aceptaría "NaN" y lo guardaría).
  const precision = req.body.precision === undefined || req.body.precision === '' ? null : Number(req.body.precision);
  if (precision !== null && (!Number.isFinite(precision) || precision < 0 || precision > 100_000)) throw falla(422, 'Precisión GPS inválida', { precision: 'Inválida' });
  const receptor = String(req.body.receptor ?? '').trim().slice(0, 120) || null;
  // Entrega guardada sin señal y enviada después: se respeta la hora real en que se entregó (últimas 72 h, no futura).
  const hora = req.body.hora_entrega ? new Date(req.body.hora_entrega) : null;
  const horaReal = hora && !Number.isNaN(hora.getTime()) && hora.getTime() <= Date.now() + 5 * 60_000 && hora.getTime() >= Date.now() - 72 * 3600_000 ? hora : null;

  // La firma se guarda primero (si viene); la foto y el cambio de estado van en la misma transacción.
  const conFirma = (fn) => (firma ? conArchivo(firma.buffer, 'image/png', fn) : fn(null));
  await conFirma((archivoFirma) => conArchivo(quitarExif(req.file.buffer), req.file.mimetype, (archivo) => transaccion(async (db) => {
    await db.query(
      `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
       VALUES ($1, 'foto_entrega', $2, $3, $4, $5, $6, $7)`,
      [envio.id, req.file.originalname, req.file.mimetype, archivo.tamano, archivo.ruta, archivo.sha256, req.usuario.id],
    );
    if (archivoFirma) {
      await db.query(
        `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
         VALUES ($1, 'firma_entrega', 'firma.png', 'image/png', $2, $3, $4, $5)`,
        [envio.id, archivoFirma.tamano, archivoFirma.ruta, archivoFirma.sha256, req.usuario.id],
      );
    }
    exigirSinConflicto(await db.query(
      `UPDATE envio SET estado = 'entregado', entregado_en = COALESCE($7, now()), entrega_lat = $1, entrega_lon = $2, entrega_precision_m = $3,
         entrega_receptor = $4, actualizado_en = now() WHERE id = $5 AND estado = $6`,
      [ubic?.lat ?? null, ubic?.lon ?? null, precision, receptor, envio.id, envio.estado, horaReal],
    ));
    const notas = [receptor && `Recibe: ${receptor}`, firma && 'con firma', horaReal && 'registrada sin conexión', !ubic && 'sin GPS'].filter(Boolean).join(' · ') || null;
    await registrarEstado(db, { envioId: envio.id, anterior: envio.estado, nuevo: 'entregado', usuarioId: req.usuario.id, lat: ubic?.lat, lon: ubic?.lon, motivo: notas });
  })));
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
  const { n } = await uno("SELECT count(*)::int AS n FROM adjunto WHERE envio_id = $1 AND tipo IN ('foto_paquete', 'boleta')", [envio.id]);
  if (n >= MAX_ADJUNTOS) throw falla(409, `El envío ya tiene ${MAX_ADJUNTOS} archivos adjuntos (máximo)`);
  const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
  const adj = await conArchivo(buffer, req.file.mimetype, (archivo) => uno(
    `INSERT INTO adjunto (envio_id, tipo, nombre_original, mime, tamano, ruta, sha256, subido_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, tipo, nombre_original, mime, tamano, subido_en`,
    [envio.id, tipo, req.file.originalname, req.file.mimetype, archivo.tamano, archivo.ruta, archivo.sha256, req.usuario.id],
  ));
  await auditar(req, 'adjuntar', 'envio', envio.id, { tipo, adjunto_id: adj.id });
  res.status(201).json(adj);
}));

// ---------- Pago previo al retiro ----------

envios.post('/:id/pago', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const pago = await iniciarPago(envio, req.usuario.id);
  await auditar(req, 'iniciar_pago', 'envio', envio.id, { pago_id: pago.id, monto: pago.monto });
  res.status(201).json(pago);
}));

// Link de pago (se comparte por WhatsApp o correo): quien lo abre paga sin iniciar sesión. Vence en 7 días,
// se reutiliza mientras esté vigente y nunca aparece en la etiqueta del paquete.
envios.post('/:id/link-pago', requiereRol('admin', 'cliente'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  if (['borrador', 'anulado'].includes(envio.estado)) throw falla(409, 'Confirma el envío antes de generar el link de pago');
  if (envio.estado_pago === 'pagado') throw falla(409, 'El envío ya está pagado');
  if (envio.estado_pago === 'en_revision') throw falla(409, COMPROBANTE_EN_REVISION);
  if (!(envio.tarifa_total > 0)) throw falla(409, 'Este envío no tiene monto a pagar');
  if (!(await leerConfig()).pagos.en_linea) throw falla(409, PAGO_EN_LINEA_APAGADO);
  let link = await uno(
    `SELECT token, vence_en FROM link_pago WHERE envio_id = $1 AND revocado_en IS NULL AND pagado_en IS NULL AND vence_en > now() + interval '1 day'
     ORDER BY id DESC LIMIT 1`, [envio.id]);
  if (!link) {
    link = await uno(
      `INSERT INTO link_pago (token, envio_id, creado_por, vence_en) VALUES ($1, $2, $3, now() + interval '7 days') RETURNING token, vence_en`,
      [crypto.randomBytes(24).toString('base64url'), envio.id, req.usuario.id]);
    await auditar(req, 'link_pago', 'envio', envio.id);
    await registrarEvento(req, 'link_pago_creado', { detalle: { envio: envio.id, folio: envio.folio } });
  }
  res.status(201).json({ url: `${config.publicBaseUrl}/#/pagar/${link.token}`, vence_en: link.vence_en, monto: envio.tarifa_total, folio: envio.folio });
}));

envios.post('/:id/pago-manual', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  const medio = req.body.medio;
  if (!['transferencia', 'efectivo', 'otro'].includes(medio)) throw falla(422, 'Medio de pago inválido');
  if (envio.estado_pago === 'pagado') throw falla(409, 'El envío ya está pagado');
  if (envio.estado_pago === 'en_revision') throw falla(409, 'Hay un comprobante de transferencia en revisión: apruébalo o recházalo en Cobranza');
  if (['borrador', 'anulado'].includes(envio.estado)) throw falla(409, 'No se puede registrar pago en este estado');
  const referencia = String(req.body.referencia || '').trim().slice(0, 60) || null;
  await transaccion(async (db) => {
    // Se bloquea la fila del envío: si otra persona lo pagó o anuló recién, 409 y no se registra nada.
    const { rows: [vigente] } = await db.query(
      "SELECT id FROM envio WHERE id = $1 AND estado_pago = 'pendiente' AND estado NOT IN ('borrador', 'anulado') FOR UPDATE", [envio.id]);
    exigirSinConflicto({ rowCount: vigente ? 1 : 0 });
    await registrarPagoManual(db, envio, { medio, referencia, usuarioId: req.usuario.id });
  });
  await auditar(req, 'pago_manual', 'envio', envio.id, { medio, referencia });
  res.json(presentar(await cargarEnvio(envio.id), req.usuario));
}));

// Pago por transferencia: el cliente sube la imagen (o PDF) del comprobante y el pago queda "en revisión"
// hasta que administración lo apruebe o lo rechace (ver /api/cobranza/comprobantes).
// Carrito (pedido 01-10): una sola transferencia y un solo comprobante pagan varios envíos del mismo cliente.
// Campo envio_ids: "12,13,14". Administración los revisa juntos (aprobar o rechazar el lote completo).
envios.post('/comprobante-lote', requiereRol('admin', 'cliente'), subida.single('archivo'), ruta(async (req, res) => {
  const ids = [...new Set(String(req.body.envio_ids || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw falla(422, 'Elige al menos un envío para pagar', { envio_ids: 'Obligatorio' });
  if (ids.length > 100) throw falla(422, 'Máximo 100 envíos por pago', { envio_ids: 'Demasiados' });
  const lista = [];
  for (const id of ids) {
    const envio = await cargarEnvio(id);
    exigirAcceso(req.usuario, envio);
    validarSubidaComprobante(envio);
    lista.push(envio);
  }
  if (new Set(lista.map((e) => e.cliente_id)).size > 1) throw falla(422, 'Un pago solo puede incluir envíos de un mismo cliente');
  if (!req.file) throw falla(422, 'Adjunta la imagen del comprobante de la transferencia', { archivo: 'Obligatorio' });
  if (!MIME_COMPROBANTE.includes(req.file.mimetype)) throw falla(422, 'El comprobante debe ser una imagen (JPG, PNG, WebP) o un PDF', { archivo: 'Formato inválido' });
  const referencia = String(req.body.referencia || '').trim().slice(0, 60) || null;
  const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
  const r = await conArchivo(buffer, req.file.mimetype, (guardado) => registrarComprobanteLote(
    lista, { ...guardado, nombre: req.file.originalname, mime: req.file.mimetype }, { referencia, usuarioId: req.usuario.id }));
  for (const e of lista) await auditar(req, 'comprobante_pago', 'envio', e.id, { lote: r.lote, referencia, envios: ids.length });
  res.status(201).json(r);
}));

envios.post('/:id/comprobante', requiereRol('admin', 'cliente'), subida.single('archivo'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  validarSubidaComprobante(envio);
  if (!req.file) throw falla(422, 'Adjunta la imagen del comprobante de la transferencia', { archivo: 'Obligatorio' });
  if (!MIME_COMPROBANTE.includes(req.file.mimetype)) throw falla(422, 'El comprobante debe ser una imagen (JPG, PNG, WebP) o un PDF', { archivo: 'Formato inválido' });
  const referencia = String(req.body.referencia || '').trim().slice(0, 60) || null;
  const buffer = req.file.mimetype === 'image/jpeg' ? quitarExif(req.file.buffer) : req.file.buffer;
  const pago = await conArchivo(buffer, req.file.mimetype, (guardado) => registrarComprobante(
    envio, { ...guardado, nombre: req.file.originalname, mime: req.file.mimetype }, { referencia, usuarioId: req.usuario.id }));
  await auditar(req, 'comprobante_pago', 'envio', envio.id, { pago_id: pago.id, referencia });
  res.status(201).json(pago);
}));

// Reembolso del pago de un envío anulado o devuelto (RF-57). La política (total o parcial) la define el cliente (C-7).
envios.post('/:id/reembolso', requiereRol('admin'), ruta(async (req, res) => {
  const envio = await envioAccesible(req);
  // Sin monto (o con el campo vacío) se reembolsa el total pagado.
  const monto = req.body?.monto === undefined || req.body?.monto === null || req.body?.monto === '' ? envio.tarifa_total : Number(req.body.monto);
  const medio = req.body?.medio;
  if (!['anulado', 'devuelto'].includes(envio.estado)) throw falla(409, 'Solo se reembolsa un envío anulado o devuelto');
  if (envio.estado_pago !== 'pagado') throw falla(409, envio.estado_pago === 'reembolsado' ? 'El envío ya fue reembolsado' : 'El envío no está pagado');
  const errores = {};
  if (!Number.isInteger(monto) || monto <= 0 || monto > envio.tarifa_total) errores.monto = `Entre $1 y $${envio.tarifa_total.toLocaleString('es-CL')}`;
  if (!['transferencia', 'efectivo', 'pasarela', 'otro'].includes(medio)) errores.medio = 'Medio inválido';
  exigirSinErrores(errores);
  const nota = String(req.body?.nota || '').trim().slice(0, 300) || null;
  await transaccion(async (db) => {
    exigirSinConflicto(await db.query(
      `UPDATE envio SET estado_pago = 'reembolsado', reembolso_monto = $1, reembolso_medio = $2, reembolso_nota = $3, reembolsado_en = now(), actualizado_en = now()
       WHERE id = $4 AND estado_pago = 'pagado'`, [monto, medio, nota, envio.id]));
    // El reembolso queda en la bitácora del pago que se devuelve (respaldo ante reclamos y para cuadrar la cobranza).
    const { rows: [p] } = await db.query("SELECT id FROM pago WHERE envio_id = $1 AND estado = 'aprobado' ORDER BY id DESC LIMIT 1", [envio.id]);
    if (p) await registrarEventoPago(db, { pagoId: p.id, tipo: 'reembolso', estado: 'reembolsado', monto, datos: { medio, nota }, usuarioId: req.usuario.id });
  });
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
  await enviarTicket(res, await envioAccesible(req), req.usuario, req.query.formato);
}));

// El cliente ve e imprime su etiqueta apenas confirma el envío, aunque no haya pagado (pedido 03-10): la etiqueta
// no muestra montos ni estado de pago, y el retiro igual exige el pago aprobado. Un envío anulado ya no tiene etiqueta.
async function enviarTicket(res, envio, usuario, formato) {
  if (!envio.folio) throw falla(409, 'Confirma el envío para emitir la etiqueta');
  if (!puedeVerTicket(usuario, envio)) throw falla(409, 'El envío está anulado: ya no tiene etiqueta');
  const pdf = await generarTicketPdf(envio, await leerConfig(), formato === 'a4' ? 'a4' : '80mm');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="etiqueta-${envio.folio}.pdf"`);
  res.send(pdf);
}

// Etiqueta por enlace firmado (sin cabeceras de sesión): lo abre el visor de PDF del celular directamente.
export const tickets = Router();
tickets.get('/lote', ruta(async (req, res) => {
  const { fecha, exp, u, sig } = req.query;
  if (!verificarLote(fecha, exp, u, sig)) {
    await registrarEvento(req, 'enlace_invalido', { usuarioId: null, detalle: { lote: String(fecha || '').slice(0, 10) } });
    throw falla(403, 'Enlace vencido: vuelve a abrir las etiquetas desde la app');
  }
  const usuario = await uno('SELECT id, rol, activo FROM usuario WHERE id = $1', [Number(u)]);
  if (!usuario?.activo || usuario.rol !== 'admin') throw falla(403, 'Enlace vencido: vuelve a abrir las etiquetas desde la app');
  const { rows } = await query(`${SELECT_ENVIO} WHERE ${DEL_DIA} ORDER BY e.folio LIMIT 300`, [fecha]);
  if (!rows.length) throw falla(404, 'No hay envíos confirmados ese día');
  const pdf = await generarEtiquetasPdf(rows, await leerConfig(), req.query.formato === 'a4' ? 'a4' : '80mm', `Etiquetas ${fecha}`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="etiquetas-${fecha}.pdf"`);
  res.send(pdf);
}));
tickets.get('/:id', ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  if (!verificarTicket(id, req.query.exp, req.query.u, req.query.sig)) {
    await registrarEvento(req, 'enlace_invalido', { usuarioId: null, detalle: { ticket: id } });
    throw falla(403, 'Enlace vencido: vuelve a abrir la etiqueta desde la app');
  }
  // Se revisa de nuevo quién es: si lo desactivaron o el envío cambió de dueño, el enlace deja de servir.
  const usuario = await uno('SELECT id, rol, activo FROM usuario WHERE id = $1', [Number(req.query.u)]);
  if (!usuario?.activo) throw falla(403, 'Enlace vencido: vuelve a abrir la etiqueta desde la app');
  const envio = await cargarEnvio(id);
  exigirAcceso(usuario, envio);
  await enviarTicket(res, envio, usuario, req.query.formato);
}));
