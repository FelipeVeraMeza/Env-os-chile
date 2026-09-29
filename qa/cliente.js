// Cliente HTTP para las pruebas QA. Funciona en modo demo (sin login) y en modo jwt.
import assert from 'node:assert/strict';

export const API = process.env.QA_API_URL || 'http://localhost:3000';
export const WEB = process.env.QA_WEB_URL || API;
const sufijo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let modo = null;
async function modoAuth() {
  if (!modo) modo = (await (await fetch(`${API}/api/health`)).json()).auth_mode;
  return modo;
}

// Si la demo publicada está protegida con DEMO_CLAVE, define QA_DEMO_CLAVE en entornos.local.env.
const CLAVE_DEMO = process.env.QA_DEMO_CLAVE ? { 'X-Demo-Clave': process.env.QA_DEMO_CLAVE } : {};

export async function peticion(metodo, ruta, { sesion, json, form, crudo } = {}) {
  const headers = { ...CLAVE_DEMO, ...(sesion?.headers || {}) };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${API}${ruta}`, { method: metodo, headers, body });
  if (crudo) return res;
  const tipo = res.headers.get('content-type') || '';
  const datos = tipo.includes('json') ? await res.json() : await res.text();
  return { status: res.status, datos, headers: res.headers };
}

// Sesión de administración: en demo por rol; en jwt con las credenciales de entornos.local.env.
export async function sesionAdmin() {
  if ((await modoAuth()) === 'demo') return { headers: { 'X-Demo-Rol': 'admin' } };
  const correo = process.env.QA_ADMIN_CORREO;
  const password = process.env.QA_ADMIN_PASSWORD;
  assert.ok(correo && password, 'Define QA_ADMIN_CORREO y QA_ADMIN_PASSWORD en entornos.local.env (modo jwt)');
  const r = await peticion('POST', '/api/auth/login', { json: { correo, password } });
  assert.equal(r.status, 200, `login admin: ${JSON.stringify(r.datos)}`);
  return { headers: { Authorization: `Bearer ${r.datos.token}` } };
}

// Crea un usuario de prueba aislado (correo qa-...) y devuelve su sesión.
export async function crearUsuarioQa(admin, rol, nombre) {
  const password = `Qa.${sufijo}.2026`;
  const r = await peticion('POST', '/api/usuarios', {
    sesion: admin,
    json: { nombre: `QA ${nombre}`, correo: `qa-${rol}-${nombre.toLowerCase().replace(/\W/g, '')}-${sufijo}@qa.test`, rol, password },
  });
  assert.equal(r.status, 201, `crear usuario QA: ${JSON.stringify(r.datos)}`);
  const usuario = r.datos;
  if ((await modoAuth()) === 'demo') return { usuario, password, headers: { 'X-Demo-Usuario': String(usuario.id) } };
  const login = await peticion('POST', '/api/auth/login', { json: { correo: usuario.correo, password } });
  assert.equal(login.status, 200, `login usuario QA: ${JSON.stringify(login.datos)}`);
  return { usuario, password, headers: { Authorization: `Bearer ${login.datos.token}` } };
}

export async function comunaEnCobertura(nombre = 'Providencia') {
  const r = await peticion('GET', `/api/comunas?cobertura=1&q=${encodeURIComponent(nombre)}`);
  const c = r.datos.find((x) => x.nombre === nombre) || r.datos[0];
  assert.ok(c, 'No hay comunas en cobertura');
  return c;
}

export function datosEnvio(comunaId, extra = {}) {
  return {
    destinatario: { nombre: 'Destinatario QA', telefono: '+56 9 8765 4321' },
    direccion: { calle: 'Av. Providencia', numero: '1234', depto: 'Of. 5', referencia: 'Conserje recibe', comuna_id: comunaId },
    descripcion_producto: 'Zapatillas talla 42',
    bultos: 1, peso_kg: 2.5, largo_cm: 35, ancho_cm: 25, alto_cm: 15,
    valor_declarado: 50000,
    ...extra,
  };
}

// Imagen JPEG mínima válida (1×1) con un segmento EXIF para probar que se elimina.
export function jpegPrueba() {
  const b64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQEPAAIAAAADUUEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz6iiiv0w8Q//Z';
  return new Blob([Buffer.from(b64, 'base64')], { type: 'image/jpeg' });
}

export function pdfPrueba() {
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}

export function formulario(campos, archivos = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v !== undefined && v !== null) f.append(k, String(v));
  for (const [k, [blob, nombre]] of Object.entries(archivos)) f.append(k, blob, nombre);
  return f;
}

// Prepara un escenario completo: admin, dos clientes y dos repartidores de prueba.
export async function escenario() {
  const admin = await sesionAdmin();
  const [cliente, clienteB, repartidor, repartidorB] = await Promise.all([
    crearUsuarioQa(admin, 'cliente', 'ClienteA'),
    crearUsuarioQa(admin, 'cliente', 'ClienteB'),
    crearUsuarioQa(admin, 'repartidor', 'RepartidorA'),
    crearUsuarioQa(admin, 'repartidor', 'RepartidorB'),
  ]);
  const comuna = await comunaEnCobertura();
  return { admin, cliente, clienteB, repartidor, repartidorB, comuna };
}

// Lleva un envío hasta "en ruta": creado → pagado → asignado → retirado.
export async function envioEnRuta(esc, extra = {}) {
  const c = await peticion('POST', '/api/envios', { sesion: esc.cliente, json: { ...datosEnvio(esc.comuna.id, extra), confirmar: true } });
  assert.equal(c.status, 201, JSON.stringify(c.datos));
  const pago = await peticion('POST', `/api/envios/${c.datos.id}/pago`, { sesion: esc.cliente });
  assert.equal(pago.status, 201, JSON.stringify(pago.datos));
  const conf = await peticion('POST', `/api/pagos/${pago.datos.token}/confirmar`, { sesion: esc.cliente, json: { resultado: 'aprobado' } });
  assert.equal(conf.status, 200, JSON.stringify(conf.datos));
  const asig = await peticion('POST', `/api/envios/${c.datos.id}/asignar`, { sesion: esc.admin, json: { repartidor_id: esc.repartidor.usuario.id } });
  assert.equal(asig.status, 200, JSON.stringify(asig.datos));
  const ret = await peticion('POST', `/api/envios/${c.datos.id}/estado`, { sesion: esc.repartidor, json: { estado: 'en_ruta' } });
  assert.equal(ret.status, 200, JSON.stringify(ret.datos));
  return ret.datos;
}
