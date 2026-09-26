import { fijarClaveDemo, fijarPerfil, fijarUrlApi, get, perfilActual, urlApi } from './api.js';
import { $, errorToast, html, icono, modal, montar, raw, toast } from './ui.js';
import * as cliente from './vistas/cliente.js';
import * as envios from './vistas/envios.js';
import * as repartidor from './vistas/repartidor.js';
import * as admin from './vistas/admin.js';
import * as publico from './vistas/publico.js';

// Estado compartido de la aplicación.
export const app = { conf: null, usuario: null, perfiles: [] };

const MENUS = {
  cliente: [
    ['#/inicio', 'inicio', 'Inicio'],
    ['#/nuevo', 'nuevo', 'Nuevo envío'],
    ['#/envios', 'envios', 'Mis envíos'],
    ['#/libreta', 'libreta', 'Destinatarios'],
    ['#/reclamos', 'seguro', 'Seguros', 'solo-escritorio'],
    ['#/seguimiento', 'seguimiento', 'Seguimiento', 'solo-escritorio'],
  ],
  repartidor: [
    ['#/ruta', 'ruta', 'Mi ruta'],
    ['#/envios', 'envios', 'Historial'],
    ['#/seguimiento', 'seguimiento', 'Seguimiento'],
  ],
  admin: [
    ['#/panel', 'panel', 'Panel'],
    ['#/envios', 'envios', 'Envíos'],
    ['#/nuevo', 'nuevo', 'Nuevo', 'solo-escritorio'],
    ['#/reclamos', 'seguro', 'Seguros'],
    ['#/tarifas', 'tarifas', 'Tarifas'],
    ['#/usuarios', 'usuarios', 'Usuarios', 'solo-escritorio'],
    ['#/ajustes', 'ajustes', 'Ajustes', 'solo-escritorio'],
  ],
};

const RUTAS = [
  [/^#\/seguimiento(?:\/([\w-]+))?$/, (m) => publico.seguimiento(m[1])],
  [/^#\/envio\/(\d+)$/, (m) => envios.detalle(Number(m[1]))],
  [/^#\/envios$/, () => envios.registro()],
  [/^#\/inicio$/, () => cliente.inicio(), 'cliente'],
  [/^#\/nuevo$/, () => cliente.nuevo(), ['cliente', 'admin']],
  [/^#\/libreta$/, () => cliente.libreta(), 'cliente'],
  [/^#\/reclamos$/, () => envios.reclamos(), ['cliente', 'admin']],
  [/^#\/ruta$/, () => repartidor.ruta(), 'repartidor'],
  [/^#\/panel$/, () => admin.panel(), 'admin'],
  [/^#\/tarifas$/, () => admin.tarifas(), 'admin'],
  [/^#\/usuarios$/, () => admin.usuarios(), 'admin'],
  [/^#\/ajustes$/, () => admin.ajustes(), 'admin'],
];

const INICIO = { cliente: '#/inicio', repartidor: '#/ruta', admin: '#/panel' };

export function ir(hash) { if (location.hash === hash) enrutar(); else location.hash = hash; }

async function enrutar() {
  const hash = location.hash || '';
  const rol = app.usuario?.rol;
  if (!rol && !hash.startsWith('#/seguimiento')) return pantallaSinPerfil();
  const ruta = RUTAS.find(([re, , roles]) => re.test(hash) && (!roles || [].concat(roles).includes(rol)));
  if (!ruta) return ir(INICIO[rol] || '#/seguimiento');
  pintarMenu(hash);
  const vista = $('#vista');
  try {
    await ruta[1](hash.match(ruta[0]));
  } catch (err) {
    montar(vista, html`<div class="card"><h2>No se pudo cargar esta pantalla</h2><p class="sub">${err.message}</p>
      <button class="btn sec" onclick="location.reload()">Reintentar</button></div>`);
  }
  vista.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function pintarMenu(hash) {
  const items = MENUS[app.usuario?.rol] || [];
  montar($('#menu'), html`<div class="titulo-menu">${app.usuario?.nombre || ''}</div>${items.map(([h, ic, txt, cls]) => html`
    <a href="${h}" class="${[hash.startsWith(h) ? 'activo' : '', cls].filter(Boolean).join(' ')}">${icono(ic)}<span>${txt}</span></a>`)}`);
}

function pantallaSinPerfil() {
  montar($('#menu'), '');
  montar($('#vista'), html`<div class="hero"><h1>Bienvenido a la plataforma de envíos</h1>
    <p>Esta es una versión de demostración sin inicio de sesión. Elige un perfil arriba (Administrador, Cliente o Repartidor) para recorrer la plataforma.</p>
    <div class="fila" style="margin-top:14px">${['admin', 'cliente', 'repartidor'].map((rol) => app.perfiles.find((p) => p.rol === rol)).filter(Boolean).map((p) => html`<button class="btn blanco" data-perfil="${p.id}">Entrar como ${ROL_TXT[p.rol]}</button>`)}</div></div>
    ${app.perfiles.length ? '' : html`<div class="aviso alerta">No se pudo conectar con la API en <b>${urlApi() || location.origin}</b>. Usa el botón de servidor (arriba a la derecha) para indicar la URL de localhost o Railway.</div>`}`);
  document.querySelectorAll('[data-perfil]').forEach((b) => { b.onclick = () => cambiarPerfil(Number(b.dataset.perfil)); });
}

const ROL_TXT = { admin: 'Administrador', cliente: 'Cliente', repartidor: 'Repartidor' };

function pintarSelector() {
  const sel = $('#selector-perfil');
  montar(sel, html`<option value="">Elegir perfil…</option>${['admin', 'cliente', 'repartidor'].map((rol) => html`
    <optgroup label="${ROL_TXT[rol]}">${app.perfiles.filter((p) => p.rol === rol).map((p) => html`
      <option value="${p.id}" ${p.id === app.usuario?.id ? raw('selected') : ''}>${p.nombre}</option>`)}</optgroup>`)}`);
  sel.onchange = () => cambiarPerfil(Number(sel.value) || null);
}

async function cambiarPerfil(id) {
  fijarPerfil(id);
  app.usuario = app.perfiles.find((p) => p.id === id) || null;
  pintarSelector();
  if (app.usuario) toast(`Ahora navegas como ${ROL_TXT[app.usuario.rol]}: ${app.usuario.nombre}`);
  ir(INICIO[app.usuario?.rol] || '#/');
}

// Configuración del servidor: permite apuntar la interfaz a localhost o a Railway sin recompilar.
function dialogoServidor() {
  const cfg = window.APP_CONFIG || {};
  const opciones = [
    ['', `Mismo origen (${location.origin})`],
    [cfg.URL_LOCAL || 'http://localhost:3000', `Local · ${cfg.URL_LOCAL || 'http://localhost:3000'}`],
    ...(cfg.URL_RAILWAY && !cfg.URL_RAILWAY.includes('CAMBIAR') ? [[cfg.URL_RAILWAY, `Railway · ${cfg.URL_RAILWAY}`]] : []),
    ...(cfg.URL_PRODUCCION ? [[cfg.URL_PRODUCCION, `Producción · ${cfg.URL_PRODUCCION}`]] : []),
  ];
  const m = modal(html`<h2>Servidor de la API</h2>
    <p class="sub">Elige a qué backend se conecta esta interfaz. Las URLs vienen de <code>entornos.env</code>; también puedes escribir otra (por ejemplo la de Railway).</p>
    <div class="pila">
      ${opciones.map(([url, txt]) => html`<button class="btn sec ancho" data-url="${url}" style="justify-content:flex-start">${txt}</button>`)}
      <label class="campo">Otra URL<input id="url-custom" placeholder="https://tu-app.up.railway.app" value="${urlApi()}"></label>
      <div class="fila"><button class="btn" id="usar-url">Probar y usar</button><span id="resultado-url" class="sub"></span></div>
    </div>`);
  const probar = async (url) => {
    montar($('#resultado-url', m.el), html`<span class="cargando"></span>`);
    try {
      const r = await fetch(`${url.replace(/\/+$/, '')}/api/health`).then((x) => x.json());
      if (!r.ok) throw new Error('La base de datos no responde');
      fijarUrlApi(url);
      m.cerrar();
      toast(`Conectado a ${url || location.origin} (${r.entorno}, modo ${r.auth_mode})`, 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      montar($('#resultado-url', m.el), html`<span style="color:var(--error)">No responde: ${e.message}</span>`);
    }
  };
  m.el.querySelectorAll('[data-url]').forEach((b) => { b.onclick = () => probar(b.dataset.url); });
  $('#usar-url', m.el).onclick = () => probar($('#url-custom', m.el).value.trim());
}

// La demo publicada puede estar protegida con una clave (DEMO_CLAVE en Railway).
function pedirClaveDemo(conf) {
  $('#marca-nombre').textContent = conf.negocio.nombre;
  $('#estado-api').className = 'punto-estado ok';
  montar($('#vista'), html`<div class="hero" style="max-width:560px"><h1>Acceso a la demo</h1>
    <p>Ingresa la clave que te compartieron para ver la plataforma.</p>
    <form class="fila" id="f-clave" style="margin-top:14px"><input type="password" name="clave" placeholder="Clave de acceso" autocomplete="current-password"
      style="flex:1;background:rgba(255,255,255,.95);color:#0a1a6b;font-weight:700" aria-label="Clave de acceso"><button class="btn blanco">Entrar</button></form></div>`);
  $('#f-clave').onsubmit = async (e) => {
    e.preventDefault();
    fijarClaveDemo(e.target.clave.value.trim());
    try { await get('/api/demo/usuarios'); location.reload(); }
    catch { fijarClaveDemo(null); toast('Clave incorrecta', 'error'); }
  };
}

async function iniciar() {
  $('#btn-servidor').onclick = dialogoServidor;
  try {
    const conf = await get('/api/config/publica');
    let perfiles = [];
    try {
      perfiles = await get('/api/demo/usuarios');
    } catch (err) {
      if (err.detalles?.demo_clave) return pedirClaveDemo(conf);
    }
    app.conf = conf;
    app.perfiles = perfiles;
    $('#estado-api').className = 'punto-estado ok';
    $('#marca-nombre').textContent = conf.negocio.nombre;
    document.title = `${conf.negocio.nombre} · Envíos`;
    if (conf.negocio.logo_url) document.querySelector('.marca img').src = conf.negocio.logo_url;
  } catch (err) {
    $('#estado-api').className = 'punto-estado error';
    errorToast(err);
  }
  app.usuario = app.perfiles.find((p) => p.id === perfilActual()) || null;
  pintarSelector();
  window.addEventListener('hashchange', enrutar);
  enrutar();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
