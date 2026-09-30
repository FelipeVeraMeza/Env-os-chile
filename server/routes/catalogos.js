import { Router } from 'express';
import { query, transaccion, uno } from '../db/pool.js';
import { auditar, exigirSinErrores, falla, idNumerico, ruta } from '../lib/http.js';
import { leerConfig } from '../lib/configuracion.js';
import { correoConfigurado } from '../lib/correo.js';
import { normalizarRut, normalizarTelefono, validarDestinatario, validarDireccion, normalizarLista, ESTADOS, ESTADOS_RECLAMO, MOTIVOS_FALLO, MOTIVOS_RECLAMO, CONFIG_POR_DEFECTO } from '../lib/reglas.js';
import { autenticar, requiereRol } from '../middleware/auth.js';
import { config } from '../config.js';
import { registrarEvento } from '../lib/seguridad.js';

// ---------- Comunas y zonas ----------
export const comunas = Router();

comunas.get('/', ruta(async (req, res) => {
  const cond = [];
  const params = [];
  if (req.query.cobertura === '1') cond.push('c.en_cobertura');
  if (req.query.region) { params.push(req.query.region); cond.push(`c.region = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); cond.push(`c.nombre ILIKE $${params.length}`); }
  const { rows } = await query(
    `SELECT c.id, c.nombre, c.provincia, c.region, c.en_cobertura, c.zona_id, c.tarifa_base, z.nombre AS zona_nombre,
       COALESCE(c.tarifa_base, z.tarifa) AS tarifa
     FROM comuna c LEFT JOIN zona z ON z.id = c.zona_id ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
     ORDER BY c.region = 'Metropolitana' DESC, c.region, c.nombre`, params);
  res.json(rows);
}));

comunas.patch('/:id', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const id = idNumerico(req.params.id);
  const b = req.body || {};
  const tarifa = b.tarifa_base === '' || b.tarifa_base === null ? null : b.tarifa_base;
  if (tarifa !== undefined && tarifa !== null && (!Number.isInteger(Number(tarifa)) || Number(tarifa) < 0 || Number(tarifa) > 10_000_000)) throw falla(422, 'Tarifa inválida');
  const c = await uno(
    `UPDATE comuna SET en_cobertura = COALESCE($1, en_cobertura), zona_id = CASE WHEN $2::boolean THEN $3::int ELSE zona_id END,
       tarifa_base = CASE WHEN $4::boolean THEN $5::int ELSE tarifa_base END
     WHERE id = $6 RETURNING *`,
    [b.en_cobertura ?? null, b.zona_id !== undefined, b.zona_id || null, tarifa !== undefined, tarifa === null || tarifa === undefined ? null : Number(tarifa), id],
  );
  if (!c) throw falla(404, 'Comuna no encontrada');
  await auditar(req, 'editar', 'comuna', id, b);
  res.json(c);
}));

export const zonas = Router();
zonas.use(autenticar);
zonas.get('/', ruta(async (_req, res) => res.json((await query('SELECT * FROM zona ORDER BY orden, nombre')).rows)));
zonas.post('/', requiereRol('admin'), ruta(async (req, res) => {
  const { nombre, tarifa, color } = req.body || {};
  if (!String(nombre || '').trim() || !Number.isInteger(Number(tarifa)) || Number(tarifa) < 0) throw falla(422, 'Nombre y tarifa obligatorios');
  res.status(201).json(await uno('INSERT INTO zona (nombre, tarifa, color) VALUES ($1, $2, $3) RETURNING *', [nombre.trim(), Number(tarifa), color || null]));
}));
zonas.patch('/:id', requiereRol('admin'), ruta(async (req, res) => {
  const { nombre, tarifa, color } = req.body || {};
  if (tarifa !== undefined && (!Number.isInteger(Number(tarifa)) || Number(tarifa) < 0)) throw falla(422, 'Tarifa inválida');
  const z = await uno('UPDATE zona SET nombre = COALESCE($1, nombre), tarifa = COALESCE($2, tarifa), color = COALESCE($3, color) WHERE id = $4 RETURNING *',
    [nombre ?? null, tarifa !== undefined ? Number(tarifa) : null, color ?? null, idNumerico(req.params.id)]);
  if (!z) throw falla(404, 'Zona no encontrada');
  await auditar(req, 'editar', 'zona', z.id, req.body);
  res.json(z);
}));

// ---------- Configuración ----------
export const configuracion = Router();

// Datos públicos que necesita la interfaz (sin secretos).
configuracion.get('/publica', ruta(async (_req, res) => {
  const conf = await leerConfig();
  res.json({
    negocio: conf.negocio, tarifas: conf.tarifas, operacion: conf.operacion, ticket: conf.ticket,
    pagos: { proveedor: conf.pagos.proveedor }, couriers: conf.listas.couriers, franjas: conf.listas.franjas, estados: ESTADOS, motivos_fallo: MOTIVOS_FALLO,
    motivos_reclamo: MOTIVOS_RECLAMO, estados_reclamo: ESTADOS_RECLAMO, auth_mode: config.authMode, demo_protegida: config.authMode === 'demo' && Boolean(config.demoClave), recuperacion_por_correo: correoConfigurado(),
  });
}));

configuracion.put('/:clave', autenticar, requiereRol('admin'), ruta(async (req, res) => {
  const clave = req.params.clave;
  if (!(clave in CONFIG_POR_DEFECTO)) throw falla(404, 'Clave de configuración desconocida');
  const actual = (await leerConfig())[clave];
  const nuevo = { ...actual };
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in CONFIG_POR_DEFECTO[clave])) continue; // se ignoran claves desconocidas
    const tipo = Array.isArray(CONFIG_POR_DEFECTO[clave][k]) ? 'lista' : typeof CONFIG_POR_DEFECTO[clave][k];
    if (tipo === 'lista') {
      const { lista, error } = normalizarLista(v);
      if (error) throw falla(422, `${k}: ${error}`);
      nuevo[k] = lista;
    } else if (tipo === 'number') {
      if (!Number.isFinite(Number(v)) || Number(v) < 0) throw falla(422, `Valor inválido para ${k}`);
      nuevo[k] = Number(v);
    } else if (tipo === 'boolean') nuevo[k] = v === true || v === 'true';
    else nuevo[k] = String(v ?? '');
  }
  if (clave === 'operacion' && !['pagina', 'google', 'waze'].includes(nuevo.qr_destino)) throw falla(422, 'Destino de QR inválido');
  // Valores que dejarían la operación sin sentido (sin intentos, sin espera, montos con decimales).
  const errores = {};
  if (clave === 'operacion') {
    for (const k of ['intentos_max', 'espera_max_min']) if (!Number.isInteger(nuevo[k]) || nuevo[k] < 1 || nuevo[k] > 60) errores[k] = 'Debe ser un número entero entre 1 y 60';
  }
  if (clave === 'tarifas') {
    for (const k of ['base', 'bulto_adicional_domicilio', 'bulto_adicional_punto', 'recargo_horario_especial']) if (!Number.isInteger(nuevo[k]) || nuevo[k] > 10_000_000) errores[k] = 'Pesos enteros';
    if (!(nuevo.peso_max_kg > 0) || nuevo.peso_max_kg > 1000) errores.peso_max_kg = 'Entre 1 y 1000 kg';
    if (!Number.isInteger(nuevo.dim_max_cm) || nuevo.dim_max_cm < 1 || nuevo.dim_max_cm > 500) errores.dim_max_cm = 'Entre 1 y 500 cm';
  }
  // Solo el simulador está conectado: elegir otra pasarela hoy dejaría a los clientes sin poder pagar.
  if (clave === 'pagos' && nuevo.proveedor !== 'simulado') errores.proveedor = 'Esa pasarela aún no está integrada (etapa de desarrollo)';
  exigirSinErrores(errores, 'Revisa los valores');
  await query('INSERT INTO config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [clave, JSON.stringify(nuevo)]);
  await auditar(req, 'editar', 'config', clave, nuevo);
  const cambios = Object.keys(nuevo).filter((k) => JSON.stringify(nuevo[k]) !== JSON.stringify(actual[k]));
  if (cambios.length) await registrarEvento(req, 'config_cambiada', { detalle: { clave, cambios: Object.fromEntries(cambios.map((k) => [k, { antes: actual[k], despues: nuevo[k] }])) } });
  res.json(nuevo);
}));

// ---------- Libreta de destinatarios (con varias direcciones) ----------
export const destinatarios = Router();
destinatarios.use(autenticar, requiereRol('admin', 'cliente'));

function clienteObjetivo(req) {
  if (req.usuario.rol === 'cliente') return req.usuario.id;
  const id = Number(req.query.cliente_id || req.body?.cliente_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

destinatarios.get('/', ruta(async (req, res) => {
  const clienteId = clienteObjetivo(req);
  const params = [];
  const cond = [];
  if (clienteId) { params.push(clienteId); cond.push(`d.cliente_id = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); cond.push(`(d.nombre ILIKE $${params.length} OR d.telefono ILIKE $${params.length})`); }
  const { rows } = await query(
    `SELECT d.*, COALESCE(json_agg(json_build_object('id', di.id, 'alias', di.alias, 'calle', di.calle, 'numero', di.numero,
        'depto', di.depto, 'referencia', di.referencia, 'comuna_id', di.comuna_id, 'comuna_nombre', c.nombre, 'es_principal', di.es_principal)
        ORDER BY di.es_principal DESC, di.id DESC) FILTER (WHERE di.id IS NOT NULL), '[]') AS direcciones,
       (SELECT count(*)::int FROM envio e WHERE e.destinatario_id = d.id) AS envios
     FROM destinatario d
     LEFT JOIN direccion di ON di.destinatario_id = d.id AND di.activa
     LEFT JOIN comuna c ON c.id = di.comuna_id
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
     GROUP BY d.id ORDER BY d.actualizado_en DESC LIMIT 200`, params);
  res.json(rows);
}));

async function destinatarioPropio(req, id) {
  const d = await uno('SELECT * FROM destinatario WHERE id = $1', [id]);
  if (!d || (req.usuario.rol === 'cliente' && d.cliente_id !== req.usuario.id)) throw falla(404, 'Destinatario no encontrado');
  return d;
}

// ---------- Derechos del titular de datos (RF-58, Ley 21.719) — solo administración ----------
// Acceso/portabilidad: todo lo que la empresa guarda de un destinatario, en JSON.
destinatarios.get('/:id/exportar', requiereRol('admin'), ruta(async (req, res) => {
  const d = await destinatarioPropio(req, idNumerico(req.params.id));
  const [direcciones, envios] = await Promise.all([
    query('SELECT alias, calle, numero, depto, referencia, lat, lon, activa, creado_en FROM direccion WHERE destinatario_id = $1 ORDER BY id', [d.id]),
    query(`SELECT e.folio, e.estado, e.creado_en, e.entregado_en, e.descripcion_producto, e.entrega_receptor, c.nombre AS comuna
           FROM envio e JOIN comuna c ON c.id = e.comuna_id WHERE e.destinatario_id = $1 ORDER BY e.id`, [d.id]),
  ]);
  await auditar(req, 'exportar_datos', 'destinatario', d.id);
  res.setHeader('Content-Disposition', `attachment; filename="datos-destinatario-${d.id}.json"`);
  res.json({
    generado_en: new Date().toISOString(),
    titular: { nombre: d.nombre, telefono: d.telefono, correo: d.correo, rut: d.rut, notas: d.notas, registrado_en: d.creado_en, anonimizado_en: d.anonimizado_en },
    direcciones: direcciones.rows, envios: envios.rows,
  });
}));

// Supresión: se borran los datos personales pero se conservan los envíos (respaldo contable) sin identificar a nadie.
destinatarios.post('/:id/anonimizar', requiereRol('admin'), ruta(async (req, res) => {
  const d = await destinatarioPropio(req, idNumerico(req.params.id));
  if (d.anonimizado_en) throw falla(409, 'Este destinatario ya fue anonimizado');
  const activos = await uno(
    "SELECT count(*)::int AS n FROM envio WHERE destinatario_id = $1 AND estado NOT IN ('entregado','devuelto','anulado')", [d.id]);
  if (activos.n) throw falla(409, `Tiene ${activos.n} envío(s) en curso: se puede anonimizar cuando terminen`, { envios_activos: activos.n });
  await transaccion(async (db) => {
    await db.query(`UPDATE destinatario SET nombre = 'Titular anonimizado', telefono = '', correo = NULL, rut = NULL, notas = NULL,
                      anonimizado_en = now(), actualizado_en = now() WHERE id = $1`, [d.id]);
    await db.query(`UPDATE direccion SET alias = NULL, calle = 'Dirección anonimizada', numero = '-', depto = NULL, referencia = NULL,
                      lat = NULL, lon = NULL, activa = FALSE WHERE destinatario_id = $1`, [d.id]);
    await db.query('UPDATE envio SET entrega_receptor = NULL, entrega_lat = NULL, entrega_lon = NULL, observaciones = NULL WHERE destinatario_id = $1', [d.id]);
    await db.query(`UPDATE envio_estado SET lat = NULL, lon = NULL WHERE envio_id IN (SELECT id FROM envio WHERE destinatario_id = $1)`, [d.id]);
  });
  await auditar(req, 'anonimizar', 'destinatario', d.id); // no se guardan los datos borrados en la auditoría
  res.json({ ok: true });
}));

destinatarios.post('/', ruta(async (req, res) => {
  const b = { ...(req.body || {}) };
  for (const k of ['nombre', 'telefono', 'correo', 'rut', 'notas']) if (b[k] !== null && b[k] !== undefined) b[k] = String(b[k]);
  const clienteId = clienteObjetivo(req);
  if (!clienteId) throw falla(422, 'Indica el cliente');
  exigirSinErrores(validarDestinatario(b));
  const d = await uno(
    'INSERT INTO destinatario (cliente_id, nombre, telefono, correo, rut, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [clienteId, b.nombre.trim(), normalizarTelefono(b.telefono), b.correo || null, normalizarRut(b.rut), b.notas || null]);
  res.status(201).json(d);
}));

destinatarios.patch('/:id', ruta(async (req, res) => {
  const d = await destinatarioPropio(req, idNumerico(req.params.id));
  const b = { ...d, ...req.body };
  for (const k of ['nombre', 'telefono', 'correo', 'rut', 'notas']) if (b[k] !== null && b[k] !== undefined) b[k] = String(b[k]);
  exigirSinErrores(validarDestinatario(b));
  const act = await uno(
    `UPDATE destinatario SET nombre = $1, telefono = $2, correo = $3, rut = $4, notas = $5, actualizado_en = now() WHERE id = $6 RETURNING *`,
    [b.nombre.trim(), normalizarTelefono(b.telefono), b.correo || null, normalizarRut(b.rut), b.notas || null, d.id]);
  res.json(act);
}));

// Agregar una nueva dirección (p. ej. cuando el destinatario se cambia de casa).
destinatarios.post('/:id/direcciones', ruta(async (req, res) => {
  const d = await destinatarioPropio(req, idNumerico(req.params.id));
  const b = { ...(req.body || {}) };
  for (const k of ['alias', 'calle', 'numero', 'depto', 'referencia']) if (b[k] !== null && b[k] !== undefined) b[k] = String(b[k]);
  exigirSinErrores(validarDireccion(b));
  const comuna = await uno('SELECT id FROM comuna WHERE id = $1', [Number(b.comuna_id)]);
  if (!comuna) throw falla(422, 'Comuna inexistente', { comuna_id: 'Inexistente' });
  if (b.es_principal) await query('UPDATE direccion SET es_principal = false WHERE destinatario_id = $1', [d.id]);
  const di = await uno(
    `INSERT INTO direccion (destinatario_id, alias, calle, numero, depto, referencia, comuna_id, es_principal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [d.id, b.alias || null, b.calle.trim(), String(b.numero).trim(), b.depto || null, b.referencia || null, comuna.id, Boolean(b.es_principal)]);
  await query('UPDATE destinatario SET actualizado_en = now() WHERE id = $1', [d.id]);
  res.status(201).json(di);
}));

// Las direcciones no se borran (hay envíos que las referencian): se desactivan.
destinatarios.patch('/:id/direcciones/:dirId', ruta(async (req, res) => {
  const d = await destinatarioPropio(req, idNumerico(req.params.id));
  const dirId = idNumerico(req.params.dirId);
  const bool = (v, campo) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'boolean') throw falla(422, `${campo} debe ser verdadero o falso`, { [campo]: 'Inválido' });
    return v;
  };
  const activa = bool(req.body?.activa, 'activa');
  const principal = bool(req.body?.es_principal, 'es_principal');
  // En una transacción: si la dirección no existe, no se desmarca la principal de las demás.
  const di = await transaccion(async (db) => {
    const { rows: [actual] } = await db.query('SELECT id FROM direccion WHERE id = $1 AND destinatario_id = $2 FOR UPDATE', [dirId, d.id]);
    if (!actual) return null;
    if (principal) await db.query('UPDATE direccion SET es_principal = false WHERE destinatario_id = $1', [d.id]);
    const { rows: [r] } = await db.query(
      'UPDATE direccion SET activa = COALESCE($1, activa), es_principal = COALESCE($2, es_principal) WHERE id = $3 RETURNING *', [activa, principal, dirId]);
    return r;
  });
  if (!di) throw falla(404, 'Dirección no encontrada');
  res.json(di);
}));
