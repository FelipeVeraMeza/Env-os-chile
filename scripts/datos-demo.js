// Carga envíos de ejemplo en distintos estados para recorrer la demo.
// Uso: node scripts/datos-demo.js [local|railway|produccion]
// Con AUTH_MODE=jwt entra con las cuentas demo (Demo.2026) y el admin de QA_ADMIN_CORREO / QA_ADMIN_PASSWORD.
import { cargarEntornos, resolverObjetivo } from '../qa/entornos.js';

const vars = cargarEntornos();
const { api: API } = resolverObjetivo(process.argv[2] || 'local', vars);
const CLAVE = vars.QA_DEMO_CLAVE ? { 'X-Demo-Clave': vars.QA_DEMO_CLAVE } : {};
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const modo = (await (await fetch(`${API}/api/health`)).json()).auth_mode;
const tokens = {};
async function llamar(metodo, ruta, { usuario, json, form } = {}) {
  const headers = { ...CLAVE, ...(modo === 'jwt' ? { Authorization: `Bearer ${tokens[usuario]}` } : { 'X-Demo-Usuario': String(usuario) }) };
  if (json) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers, body: json ? JSON.stringify(json) : form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(d)}`);
  return d;
}

async function perfilesJwt() {
  const cuentas = [[process.env.QA_ADMIN_CORREO || vars.QA_ADMIN_CORREO, process.env.QA_ADMIN_PASSWORD || vars.QA_ADMIN_PASSWORD],
    ['cliente@demo.cl', 'Demo.2026'], ['tienda@demo.cl', 'Demo.2026'], ['repartidor@demo.cl', 'Demo.2026'], ['repartidora@demo.cl', 'Demo.2026']];
  const lista = [];
  for (const [correo, password] of cuentas) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, password }) });
    const d = await r.json();
    if (!r.ok) throw new Error(`No se pudo entrar como ${correo}: ${d.error} (¿SEED_DEMO=true y QA_ADMIN_CORREO/QA_ADMIN_PASSWORD definidos?)`);
    tokens[d.usuario.id] = d.token;
    lista.push(d.usuario);
  }
  return lista;
}
const perfiles = modo === 'jwt' ? await perfilesJwt() : await (await fetch(`${API}/api/demo/usuarios`, { headers: CLAVE })).json();
if (!Array.isArray(perfiles)) throw new Error(`No se pudieron leer los perfiles demo: ${JSON.stringify(perfiles)} (¿falta QA_DEMO_CLAVE en entornos.local.env?)`);
const admin = perfiles.find((p) => p.rol === 'admin').id;
const [clienteA, clienteB] = perfiles.filter((p) => p.rol === 'cliente').map((p) => p.id);
const [repA, repB] = perfiles.filter((p) => p.rol === 'repartidor').map((p) => p.id);
const comunas = await (await fetch(`${API}/api/comunas?cobertura=1`)).json();
const comuna = (n) => comunas.find((c) => c.nombre === n).id;

const destinatarios = [
  ['Javiera Pérez', '+56 9 6123 4455', 'Av. Irarrázaval', '2340', 'Depto 804', 'Ñuñoa', 'Conserje recibe hasta las 20:00'],
  ['Matías González', '+56 9 7231 0098', 'Los Leones', '1180', '', 'Providencia', 'Portón negro'],
  ['Fernanda Silva', '+56 9 5566 7788', 'Av. Pajaritos', '4500', 'Casa 12', 'Maipú', 'Frente a la plaza'],
  ['Benjamín Araya', '+56 9 8899 1122', 'Vicuña Mackenna', '7110', '', 'La Florida', ''],
  ['Catalina Fuentes', '+56 9 4455 6677', 'Apoquindo', '3600', 'Of. 1502', 'Las Condes', 'Recepción piso 15'],
  ['Tomás Reyes', '+56 9 3344 5566', 'Gran Avenida', '5890', '', 'San Miguel', 'Timbre 2'],
  ['Sofía Castillo', '+56 9 2211 3344', 'Concha y Toro', '1450', '', 'Puente Alto', 'Casa esquina reja verde'],
];
const productos = [['Zapatillas running talla 40', 2.1, 35, 25, 15, 59990], ['Set de ollas acero', 6.5, 45, 40, 30, 89990], ['Libros (3 unidades)', 1.8, 30, 22, 12, 32000],
  ['Audífonos inalámbricos', 0.6, 20, 15, 10, 45990], ['Chaqueta de invierno', 1.2, 40, 30, 10, 74990], ['Lámpara de escritorio', 2.4, 50, 25, 25, 28990], ['Juguete didáctico', 1.1, 30, 30, 20, 19990]];

async function crear(cliente, i, extra = {}) {
  const [nombre, telefono, calle, numero, depto, com, referencia] = destinatarios[i % destinatarios.length];
  const [descripcion, peso, l, a, h, valor] = productos[i % productos.length];
  return llamar('POST', '/api/envios', { usuario: cliente, json: {
    destinatario: { nombre, telefono }, direccion: { calle, numero, depto, referencia, comuna_id: comuna(com) },
    descripcion_producto: descripcion, bultos: 1, peso_kg: peso, largo_cm: l, ancho_cm: a, alto_cm: h, valor_declarado: valor, confirmar: true, ...extra,
  } });
}
async function pagarYAsignar(e, cliente, rep) {
  const p = await llamar('POST', `/api/envios/${e.id}/pago`, { usuario: cliente });
  await llamar('POST', `/api/pagos/${p.token}/confirmar`, { usuario: cliente, json: { resultado: 'aprobado' } });
  if (rep) await llamar('POST', `/api/envios/${e.id}/asignar`, { usuario: admin, json: { repartidor_id: rep } });
}
async function entregar(e, rep) {
  await llamar('POST', `/api/envios/${e.id}/estado`, { usuario: rep, json: { estado: 'en_ruta' } });
  const fd = new FormData();
  fd.append('foto', new Blob([jpeg], { type: 'image/jpeg' }), 'entrega.jpg');
  fd.append('lat', String(-33.45 + Math.random() * 0.1));
  fd.append('lon', String(-70.65 + Math.random() * 0.1));
  fd.append('receptor', 'Titular');
  await llamar('POST', `/api/envios/${e.id}/entregar`, { usuario: rep, form: fd });
}

let n = 0;
for (let i = 0; i < 7; i++) { const e = await crear(clienteA, i); await pagarYAsignar(e, clienteA, i % 2 ? repA : repB); await entregar(e, i % 2 ? repA : repB); n++; }
for (let i = 0; i < 3; i++) { const e = await crear(clienteA, i + 2, i === 0 ? { horario_especial: true, franja_horaria: '19:00 – 21:00' } : {}); await pagarYAsignar(e, clienteA, repA); await llamar('POST', `/api/envios/${e.id}/estado`, { usuario: repA, json: { estado: 'en_ruta' } }); n++; }
for (let i = 0; i < 2; i++) { const e = await crear(clienteB, i + 4, { bultos: 4 + i }); await pagarYAsignar(e, clienteB, repB); n++; }
for (let i = 0; i < 2; i++) { await crear(clienteA, i + 5); n++; }
{ const e = await crear(clienteB, 1); await pagarYAsignar(e, clienteB, null); n++; }
{
  const e = await crear(clienteA, 3); await pagarYAsignar(e, clienteA, repA);
  await llamar('POST', `/api/envios/${e.id}/estado`, { usuario: repA, json: { estado: 'en_ruta' } });
  await llamar('POST', `/api/envios/${e.id}/estado`, { usuario: repA, json: { estado: 'fallido', motivo: 'nadie_en_domicilio' } }); n++;
}
{
  const e = await crear(clienteA, 1); await pagarYAsignar(e, clienteA, repB); await entregar(e, repB);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ motivo: 'dano', descripcion: 'La caja llegó aplastada', monto_reclamado: 30000, boleta_numero: '458211', boleta_fecha: new Date().toISOString().slice(0, 10), boleta_monto: 89990 })) fd.append(k, String(v));
  fd.append('boleta', new Blob([jpeg], { type: 'image/jpeg' }), 'boleta.jpg');
  await llamar('POST', `/api/reclamos/envio/${e.id}`, { usuario: clienteA, form: fd }); n++;
}
await llamar('POST', '/api/costos', { usuario: admin, json: { tipo: 'bencina', monto: 18000, nota: 'Carga semanal' } });
await llamar('POST', '/api/costos', { usuario: admin, json: { tipo: 'comision', monto: 12000, nota: 'Comisiones repartidores' } });
console.log(`✔ ${n} envíos de ejemplo creados en ${API}`);
