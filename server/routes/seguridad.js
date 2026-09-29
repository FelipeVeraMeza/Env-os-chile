import { Router } from 'express';
import { query, uno } from '../db/pool.js';
import { falla, idNumerico, ruta } from '../lib/http.js';
import { registrarEvento, TIPOS } from '../lib/seguridad.js';
import { autenticar, requiereRol } from '../middleware/auth.js';

// Panel de seguridad (solo administración): alertas, eventos, quién extrajo qué datos y respuesta a incidentes.
export const seguridad = Router();
seguridad.use(autenticar, requiereRol('admin'));

const horasValidas = (v, def) => Math.min(Math.max(Math.trunc(Number(v)) || def, 1), 24 * 90);

seguridad.get('/resumen', ruta(async (req, res) => {
  const horas = horasValidas(req.query.horas, 24);
  const p = [horas];
  const desde = "fecha > now() - make_interval(hours => $1)";
  const [totales, porTipo, ips, alertas, sesiones] = await Promise.all([
    uno(`SELECT
        count(*) FILTER (WHERE tipo = 'login_ok')::int AS logins,
        count(*) FILTER (WHERE tipo = 'login_fallido')::int AS logins_fallidos,
        count(*) FILTER (WHERE tipo = 'cuenta_bloqueada')::int AS bloqueos,
        count(*) FILTER (WHERE tipo = 'sondeo_ajeno')::int AS sondeos,
        count(*) FILTER (WHERE tipo = 'acceso_denegado')::int AS denegados,
        count(*) FILTER (WHERE tipo IN ('token_invalido', 'enlace_invalido'))::int AS falsificaciones,
        count(*) FILTER (WHERE tipo = 'exportacion')::int AS exportaciones,
        COALESCE(sum(registros) FILTER (WHERE tipo = 'exportacion'), 0)::int AS registros_exportados,
        count(*) FILTER (WHERE tipo = 'descarga_archivo')::int AS descargas,
        count(*) FILTER (WHERE tipo = 'limite_peticiones')::int AS excesos
      FROM evento_seguridad WHERE ${desde}`, p),
    query(`SELECT tipo, nivel, count(*)::int AS n FROM evento_seguridad WHERE ${desde} GROUP BY tipo, nivel ORDER BY n DESC`, p),
    // IPs con más señales de ataque (fallos, sondeos, tokens falsos, excesos).
    query(`SELECT ip, count(*)::int AS eventos, count(*) FILTER (WHERE nivel <> 'info')::int AS sospechosos,
             count(DISTINCT correo) FILTER (WHERE tipo = 'login_fallido')::int AS cuentas_probadas, max(fecha) AS ultima
           FROM evento_seguridad WHERE ${desde} AND ip IS NOT NULL GROUP BY ip
           HAVING count(*) FILTER (WHERE nivel <> 'info') > 0 ORDER BY sospechosos DESC LIMIT 10`, p),
    uno("SELECT count(*)::int AS abiertas, count(*) FILTER (WHERE nivel = 'critica')::int AS criticas FROM alerta_seguridad WHERE estado = 'abierta'"),
    query(`SELECT u.id, u.nombre, u.correo, u.rol, u.ultimo_acceso,
             (SELECT ip FROM evento_seguridad e WHERE e.usuario_id = u.id AND e.tipo = 'login_ok' ORDER BY fecha DESC LIMIT 1) AS ultima_ip
           FROM usuario u WHERE u.ultimo_acceso > now() - make_interval(hours => $1) ORDER BY u.ultimo_acceso DESC LIMIT 50`, p),
  ]);
  res.json({
    horas, totales, alertas, por_tipo: porTipo.rows.map((r) => ({ ...r, etiqueta: TIPOS[r.tipo]?.[1] || r.tipo })),
    ips_sospechosas: ips.rows, sesiones_recientes: sesiones.rows,
  });
}));

// Qué datos salieron de la plataforma y quién los sacó (exportaciones y descargas de archivos).
seguridad.get('/extraccion', ruta(async (req, res) => {
  const horas = horasValidas(req.query.horas, 24 * 7);
  const { rows } = await query(
    `SELECT e.usuario_id, u.nombre, u.correo, u.rol,
       count(*) FILTER (WHERE e.tipo = 'exportacion')::int AS exportaciones,
       COALESCE(sum(e.registros) FILTER (WHERE e.tipo = 'exportacion'), 0)::int AS registros_exportados,
       count(*) FILTER (WHERE e.tipo = 'descarga_archivo')::int AS archivos_descargados,
       count(*) FILTER (WHERE e.tipo = 'sondeo_ajeno')::int AS intentos_ajenos,
       count(DISTINCT e.ip)::int AS ips, max(e.fecha) AS ultima
     FROM evento_seguridad e LEFT JOIN usuario u ON u.id = e.usuario_id
     WHERE e.tipo IN ('exportacion', 'descarga_archivo', 'sondeo_ajeno') AND e.fecha > now() - make_interval(hours => $1)
     GROUP BY e.usuario_id, u.nombre, u.correo, u.rol
     ORDER BY COALESCE(sum(e.registros) FILTER (WHERE e.tipo = 'exportacion'), 0) + count(*) FILTER (WHERE e.tipo = 'descarga_archivo') DESC LIMIT 100`, [horas]);
  res.json({ horas, usuarios: rows });
}));

seguridad.get('/eventos', ruta(async (req, res) => {
  const cond = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (req.query.tipo) cond.push(`e.tipo = ${p(String(req.query.tipo))}`);
  if (['info', 'aviso', 'alerta'].includes(req.query.nivel)) cond.push(`e.nivel = ${p(req.query.nivel)}`);
  if (req.query.sospechosos === '1') cond.push("e.nivel <> 'info'");
  if (req.query.ip) cond.push(`e.ip = ${p(String(req.query.ip))}`);
  if (req.query.usuario_id) cond.push(`e.usuario_id = ${p(idNumerico(req.query.usuario_id, 'usuario_id'))}`);
  const limite = Math.min(Math.max(Math.trunc(Number(req.query.limite)) || 100, 1), 500);
  const { rows } = await query(
    `SELECT e.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol FROM evento_seguridad e LEFT JOIN usuario u ON u.id = e.usuario_id
     ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY e.fecha DESC, e.id DESC LIMIT ${limite}`, params);
  res.json(rows.map((r) => ({ ...r, etiqueta: TIPOS[r.tipo]?.[1] || r.tipo })));
}));

seguridad.get('/alertas', ruta(async (req, res) => {
  const estado = req.query.estado === 'revisada' ? 'revisada' : req.query.estado === 'todas' ? null : 'abierta';
  const { rows } = await query(
    `SELECT a.*, u.nombre AS usuario_nombre, r.nombre AS revisada_por_nombre FROM alerta_seguridad a
     LEFT JOIN usuario u ON u.id = a.usuario_id LEFT JOIN usuario r ON r.id = a.revisada_por
     ${estado ? 'WHERE a.estado = $1' : ''} ORDER BY (a.estado = 'abierta') DESC, CASE a.nivel WHEN 'critica' THEN 0 WHEN 'alerta' THEN 1 ELSE 2 END, a.ultima_en DESC LIMIT 200`,
    estado ? [estado] : []);
  res.json(rows);
}));

seguridad.post('/alertas/:id/revisar', ruta(async (req, res) => {
  const nota = String(req.body?.nota || '').trim().slice(0, 500);
  if (!nota) throw falla(422, 'Anota qué revisaste y qué hiciste', { nota: 'Obligatoria' });
  const a = await uno(
    `UPDATE alerta_seguridad SET estado = 'revisada', revisada_por = $1, revisada_en = now(), nota = $2 WHERE id = $3 AND estado = 'abierta' RETURNING *`,
    [req.usuario.id, nota, idNumerico(req.params.id)]);
  if (!a) throw falla(409, 'La alerta no existe o ya fue revisada');
  res.json(a);
}));

seguridad.post('/alertas/revisar-todas', ruta(async (req, res) => {
  const nota = String(req.body?.nota || '').trim().slice(0, 500);
  if (!nota) throw falla(422, 'Anota qué revisaste y qué hiciste', { nota: 'Obligatoria' });
  const { rowCount } = await query(
    "UPDATE alerta_seguridad SET estado = 'revisada', revisada_por = $1, revisada_en = now(), nota = $2 WHERE estado = 'abierta'", [req.usuario.id, nota]);
  res.json({ revisadas: rowCount });
}));

// Emergencia: cierra las sesiones de TODOS los usuarios (menos la tuya). Úsalo si sospechas que robaron una sesión.
seguridad.post('/cerrar-todas-las-sesiones', ruta(async (req, res) => {
  if (req.body?.confirmar !== 'CERRAR') throw falla(422, 'Escribe CERRAR para confirmar', { confirmar: 'Obligatorio' });
  const { rowCount } = await query('UPDATE usuario SET sesion_version = sesion_version + 1 WHERE id <> $1', [req.usuario.id]);
  await registrarEvento(req, 'sesiones_cerradas', { nivel: 'alerta', registros: rowCount, detalle: { alcance: 'todas' } });
  res.json({ usuarios: rowCount });
}));
