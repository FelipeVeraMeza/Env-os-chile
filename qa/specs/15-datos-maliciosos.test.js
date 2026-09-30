// Barrido de TODA la API con datos malformados o maliciosos (textos donde van números, listas, objetos,
// valores enormes, inyección SQL/HTML, ids imposibles). Ninguna respuesta puede ser un error interno (500).
// Usa usuarios QA propios y restaura la configuración al terminar: no deja rastros en la base.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { conPagoEnLinea, datosEnvio, escenario, formulario, peticion } from '../cliente.js';

let esc;
let ids;
let configOriginal;

before(async () => {
  esc = await escenario();
  const e = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id), confirmar: true } });
  assert.equal(e.status, 201);
  let token = 'sin-pago-en-linea';
  await conPagoEnLinea({ skip() {} }, esc, async () => { token = (await peticion('POST', `/api/envios/${e.datos.id}/pago`, { sesion: esc.cliente })).datos.token; });
  ids = { envio: e.datos.id, destinatario: e.datos.destinatario_id, direccion: e.datos.direccion_id, usuario: esc.clienteB.usuario.id, token, comuna: esc.comuna.id };
  configOriginal = (await peticion('GET', '/api/config/publica')).datos;
});

after(async () => {
  for (const clave of ['negocio', 'tarifas', 'operacion', 'ticket', 'pagos']) {
    await peticion('PUT', `/api/config/${clave}`, { sesion: esc.admin, json: configOriginal[clave] });
  }
});

const BASURA = [null, true, -1, 0, 1.5, 1e308, 'abc', '', ' ', 'x'.repeat(5000), "' OR 1=1 --", '<script>alert(1)</script>', '../../etc/passwd',
  '2026-99-99', [], [1, 2], {}, { $gt: '' }, '١٢٣', '\u0000', '9'.repeat(40)];
const CAMPOS = ['estado', 'motivo', 'detalle', 'repartidor_id', 'medio', 'referencia', 'tipo', 'monto', 'fecha', 'nota', 'envio_id', 'nombre', 'correo',
  'telefono', 'rut', 'rol', 'password', 'activo', 'es_principal', 'calle', 'numero', 'depto', 'comuna_id', 'tarifa_base', 'tarifa', 'en_cobertura', 'zona_id',
  'destinatario', 'direccion', 'destinatario_id', 'direccion_id', 'descripcion_producto', 'bultos', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm',
  'valor_declarado', 'horario_especial', 'franja_horaria', 'tipo_destino', 'courier_empresa', 'courier_punto', 'cliente_id', 'tarifa_manual', 'confirmar',
  'resultado', 'decision', 'monto_aprobado', 'monto_abonado', 'abonado_en', 'actual', 'nueva', 'lat', 'lon', 'precision', 'receptor', 'boleta_numero',
  'boleta_fecha', 'boleta_monto', 'monto_reclamado', 'boleta_adjunto_id', 'color'];
const IDS_MALOS = ['abc', '-1', '0', '1.5', '99999999999999999999', '%27', 'null'];

const cuerpos = () => [[], 'texto', null, 42, ...BASURA.map((v) => Object.fromEntries(CAMPOS.map((c) => [c, v])))];
const consultas = () => BASURA.filter((v) => typeof v !== 'object' || v === null).map((v) => new URLSearchParams(
  Object.fromEntries(['estado', 'estado_pago', 'comuna_id', 'repartidor_id', 'cliente_id', 'desde', 'hasta', 'q', 'limite', 'pagina', 'monto', 'envios_mes',
    'horas', 'tipo', 'nivel', 'ip', 'usuario_id', 'conciliado', 'rol', 'cobertura', 'region', 'formato', 'cerrados', 'exp', 'sig', 'u'].map((k) => [k, String(v)]))).toString());

// Rutas con :id → se prueban con un id real (llega a la lógica) y con ids imposibles.
const RUTAS = [
  ['GET', '/api/envios'], ['GET', '/api/envios/disponibles'], ['GET', '/api/envios/exportar.csv'], ['POST', '/api/envios'], ['POST', '/api/envios/cotizar'],
  ['GET', '/api/envios/:envio'], ['GET', '/api/envios/:envio/qr.png'], ['GET', '/api/envios/:envio/ticket.pdf'],
  ['POST', '/api/envios/:envio/confirmar'], ['POST', '/api/envios/:envio/asignar'], ['POST', '/api/envios/:envio/estado'], ['POST', '/api/envios/:envio/llegada'],
  ['POST', '/api/envios/:envio/pago'], ['POST', '/api/envios/:envio/pago-manual'], ['POST', '/api/envios/:envio/tomar'],
  ['POST', '/api/envios/:envio/entregar', 'form'], ['POST', '/api/envios/:envio/adjuntos', 'form'], ['POST', '/api/envios/:envio/comprobante', 'form'], ['POST', '/api/reclamos/envio/:envio', 'form'],
  ['GET', '/api/pagos/:token'], ['POST', '/api/pagos/:token/confirmar'],
  ['GET', '/api/reclamos'], ['GET', '/api/reclamos/:envio'], ['POST', '/api/reclamos/:envio/revision'], ['POST', '/api/reclamos/:envio/resolver'], ['POST', '/api/reclamos/:envio/pagar'],
  ['GET', '/api/destinatarios'], ['POST', '/api/destinatarios'], ['PATCH', '/api/destinatarios/:destinatario'],
  ['POST', '/api/destinatarios/:destinatario/direcciones'], ['PATCH', '/api/destinatarios/:destinatario/direcciones/:direccion'],
  ['GET', '/api/usuarios'], ['GET', '/api/usuarios/repartidores'], ['POST', '/api/usuarios'], ['PATCH', '/api/usuarios/:usuario'], ['POST', '/api/usuarios/:usuario/cerrar-sesiones'],
  ['GET', '/api/comunas'], ['PATCH', '/api/comunas/:comuna'], ['GET', '/api/zonas'], ['PATCH', '/api/zonas/:envio'],
  ['GET', '/api/config/publica'], ['PUT', '/api/config/no-existe'],
  ['GET', '/api/costos'], ['POST', '/api/costos'], ['GET', '/api/reportes/ganancias'],
  ['GET', '/api/cobranza/resumen'], ['GET', '/api/cobranza/pagos'], ['GET', '/api/cobranza/estimar'], ['GET', '/api/cobranza/pagos/:envio/eventos'], ['POST', '/api/cobranza/pagos/:envio/conciliar'],
  ['GET', '/api/cobranza/comprobantes'], ['POST', '/api/cobranza/comprobantes/:envio/aprobar'], ['POST', '/api/cobranza/comprobantes/:envio/rechazar'],
  ['GET', '/api/seguridad/resumen'], ['GET', '/api/seguridad/extraccion'], ['GET', '/api/seguridad/eventos'], ['GET', '/api/seguridad/alertas'],
  ['POST', '/api/seguridad/alertas/:envio/revisar'], ['POST', '/api/seguridad/cerrar-todas-las-sesiones'],
  ['GET', '/api/seguimiento/:folio'], ['GET', '/q/:token'], ['GET', '/api/adjuntos/:envio/archivo'], ['GET', '/api/auth/yo'], ['POST', '/api/auth/cambiar-clave'],
];
// El inicio de sesión se prueba aparte (09-sesion): aquí solo cuerpos que no cuentan como intento fallido,
// para no activar el bloqueo por IP que protege contra fuerza bruta.
const LOGIN_MALFORMADOS = [[], 'texto', null, 42, {}, { correo: '' }, { password: '' }, { correo: '\u0000', password: '\u0000' }];

// Rutas cuyo :id apuntaría a registros que no son de QA (reclamos, zonas, comunas, pagos, alertas): solo con ids imposibles,
// para que el barrido nunca modifique datos reales aunque se ejecute contra producción.
const SOLO_IDS_MALOS = /\/api\/(reclamos\/:envio\/|zonas\/:|comunas\/:|cobranza\/pagos\/:envio\/conciliar|cobranza\/comprobantes\/:|seguridad\/alertas\/:)/;

function variantes(ruta) {
  if (SOLO_IDS_MALOS.test(ruta)) return IDS_MALOS.map((m) => ruta.replace(/:\w+/g, encodeURIComponent(m)));
  const reales = ruta.replace(':envio', ids.envio).replace(':destinatario', ids.destinatario).replace(':direccion', ids.direccion)
    .replace(':usuario', ids.usuario).replace(':token', ids.token).replace(':comuna', ids.comuna).replace(':folio', 'ENV-2026-000001');
  const malos = /:\w+/.test(ruta) ? IDS_MALOS.map((m) => ruta.replace(/:\w+/g, encodeURIComponent(m))) : [];
  return [reales, ...malos];
}

test('CP-139 · Ninguna ruta responde error interno ante datos malformados o maliciosos (3 perfiles)', { timeout: 300_000 }, async () => {
  const fallas = [];
  let total = 0;
  const probar = async (metodo, url, opciones, perfil) => {
    total++;
    const r = await peticion(metodo, url, opciones);
    if (r.status >= 500) fallas.push(`${perfil} ${metodo} ${url} ${JSON.stringify(opciones.json ?? '[form]').slice(0, 80)} → ${r.status}`);
  };
  for (const [perfil, sesion] of [['admin', esc.admin], ['cliente', esc.cliente], ['repartidor', esc.repartidor]]) {
    for (const [metodo, ruta, tipo] of RUTAS) {
      for (const url of variantes(ruta)) {
        if (metodo === 'GET') {
          await probar('GET', url, { sesion }, perfil);
          for (const q of consultas()) await probar('GET', `${url}?${q}`, { sesion }, perfil);
        } else if (tipo === 'form') {
          for (const v of BASURA.filter((x) => typeof x !== 'object' || x === null)) {
            await probar(metodo, url, { sesion, form: formulario(Object.fromEntries(CAMPOS.map((c) => [c, v ?? '']))) }, perfil);
          }
          await probar(metodo, url, { sesion, form: formulario({}, { campo_equivocado: [new Blob(['x']), 'x.jpg'] }) }, perfil);
        } else {
          for (const cuerpo of cuerpos()) await probar(metodo, url, { sesion, json: cuerpo }, perfil);
        }
      }
    }
  }
  for (const cuerpo of LOGIN_MALFORMADOS) await probar('POST', '/api/auth/login', { json: cuerpo }, 'anónimo');
  // Cuerpos que no son JSON válido o son demasiado grandes.
  for (const cuerpo of ['{roto', 'x'.repeat(1_100_000)]) {
    const r = await peticion('POST', '/api/envios/cotizar', { sesion: { headers: { ...esc.cliente.headers, 'Content-Type': 'application/json' } }, crudo: true, form: cuerpo });
    total++;
    if (r.status >= 500) fallas.push(`cuerpo ${cuerpo.slice(0, 10)}… → ${r.status}`);
  }
  // Resumen compacto: una línea por perfil + ruta (sin la consulta completa).
  const unicas = [...new Set(fallas.map((f) => f.replace(/\?[^ ]*/, '?…').slice(0, 140)))];
  assert.deepEqual(unicas, [], `${fallas.length} de ${total} peticiones respondieron error interno`);
});
