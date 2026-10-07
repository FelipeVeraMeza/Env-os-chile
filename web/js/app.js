import { fijarClaveDemo, fijarPerfil, fijarToken, fijarUrlApi, get, hayToken, perfilActual, post, urlApi } from './api.js';
import { $, datosForm, errorToast, html, icono, marcarErrores, modal, montar, raw, toast } from './ui.js';
import * as cliente from './vistas/cliente.js';
import * as envios from './vistas/envios.js';
import * as repartidor from './vistas/repartidor.js';
import * as admin from './vistas/admin.js';
import * as publico from './vistas/publico.js';
import * as cuenta from './vistas/cuenta.js';

// Estado compartido de la aplicación.
export const app = { conf: null, usuario: null, perfiles: [], refrescar: null };

const MENUS = {
  cliente: [
    ['#/inicio', 'inicio', 'Inicio'],
    ['#/nuevo', 'nuevo', 'Nuevo envío'],
    ['#/envios', 'envios', 'Mis envíos'],
    ['#/carrito', 'cobranza', 'Por pagar'],
    ['#/libreta', 'libreta', 'Guardados'],
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
    ['#/ruta', 'ruta', 'Mi ruta'], // administración también reparte
    ['#/cobranza', 'cobranza', 'Cobranza'],
    ['#/nuevo', 'nuevo', 'Nuevo', 'solo-escritorio'],
    ['#/reclamos', 'seguro', 'Seguros', 'solo-escritorio'],
    ['#/tarifas', 'tarifas', 'Tarifas'],
    ['#/usuarios', 'usuarios', 'Usuarios', 'solo-escritorio'],
    ['#/seguridad', 'candado', 'Seguridad', 'solo-escritorio'],
    ['#/ajustes', 'ajustes', 'Ajustes', 'solo-escritorio'],
  ],
};

const RUTAS = [
  [/^#\/seguimiento(?:\/([\w-]+))?$/, (m) => publico.seguimiento(m[1])],
  [/^#\/pagar\/([\w-]+)$/, (m) => publico.pagoPublico(m[1])],
  [/^#\/restablecer\/([\w.-]+)$/, (m) => cuenta.restablecer(m[1])],
  [/^#\/recuperar$/, () => cuenta.recuperar()],
  [/^#\/registro$/, () => cuenta.registro()],
  [/^#\/cuenta$/, () => cuenta.miCuenta(), ['admin', 'cliente', 'repartidor']],
  [/^#\/envio\/(\d+)$/, (m) => envios.detalle(Number(m[1]))],
  [/^#\/envios$/, () => envios.registro()],
  [/^#\/inicio$/, () => cliente.inicio(), 'cliente'],
  [/^#\/nuevo$/, () => cliente.nuevo(), ['cliente', 'admin']],
  [/^#\/libreta$/, () => cliente.libreta(), 'cliente'],
  [/^#\/carrito$/, () => cliente.carrito(), 'cliente'],
  [/^#\/reclamos$/, () => envios.reclamos(), ['cliente', 'admin']],
  [/^#\/ruta$/, () => repartidor.ruta(), ['repartidor', 'admin']],
  [/^#\/entrega\/(\d+)$/, (m) => repartidor.detalleRepartidor(Number(m[1])), ['repartidor', 'admin']],
  [/^#\/panel$/, () => admin.panel(), 'admin'],
  [/^#\/cobranza$/, () => admin.cobranza(), 'admin'],
  [/^#\/tarifas$/, () => admin.tarifas(), 'admin'],
  [/^#\/usuarios$/, () => admin.usuarios(), 'admin'],
  [/^#\/seguridad$/, () => admin.seguridad(), 'admin'],
  [/^#\/ajustes$/, () => admin.ajustes(), 'admin'],
];

const INICIO = { cliente: '#/inicio', repartidor: '#/ruta', admin: '#/panel' };

export function ir(hash) { if (location.hash === hash) enrutar(); else location.hash = hash; }

async function enrutar() {
  const hash = location.hash || '';
  const rol = app.usuario?.rol;
  document.body.classList.toggle('sin-sesion', !rol);
  // Pantallas que no requieren sesión: seguimiento público, recuperar/restablecer contraseña y registro de clientes.
  const publica = /^#\/(seguimiento|restablecer|recuperar|registro|pagar)/.test(hash);
  if (!rol && !publica) return conSesion() ? pantallaLogin() : pantallaSinPerfil();
  const ruta = RUTAS.find(([re, , roles]) => re.test(hash) && (!roles || [].concat(roles).includes(rol)));
  if (!ruta) return ir(INICIO[rol] || '#/seguimiento');
  pintarMenu(hash);
  $('#modal-raiz').replaceChildren(); // al navegar se cierran hojas y modales abiertos
  const vista = $('#vista');
  app.refrescar = null;
  try {
    await ruta[1](hash.match(ruta[0]));
    // Pantallas que se redibujan completas al refrescar (las listas con filtros definen su propio app.refrescar).
    if (!app.refrescar && /^#\/(ruta|inicio|envio\/\d+)$/.test(hash)) {
      app.refrescar = async () => {
        const y = window.scrollY;
        await ruta[1](hash.match(ruta[0]));
        window.scrollTo(0, y);
      };
    }
  } catch (err) {
    montar(vista, html`<div class="card"><h2>No se pudo cargar esta pantalla</h2><p class="sub">${err.message}</p>
      <button class="btn sec" onclick="location.reload()">Reintentar</button></div>`);
  }
  vista.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  // Contraseña asignada por administración: no se puede usar la plataforma sin cambiarla (también tras recargar).
  if (conSesion() && app.usuario?.debe_cambiar_clave && !$('#f-clave-nueva')) dialogoCambiarClave({ obligatorio: true });
}

function pintarMenu(hash) {
  const items = [...(MENUS[app.usuario?.rol] || []), ...(app.usuario && app.conf?.auth_mode === 'jwt' ? [['#/cuenta', 'usuarios', 'Mi cuenta', 'solo-escritorio']] : [])];
  const ocultos = items.filter(([, , , cls]) => cls === 'solo-escritorio');
  montar($('#menu'), html`<div class="titulo-menu">${app.usuario?.nombre || ''}</div>${items.map(([h, ic, txt, cls]) => html`
    <a href="${h}" class="${[hash.startsWith(h) ? 'activo' : '', cls].filter(Boolean).join(' ')}">${icono(ic)}<span>${txt}</span></a>`)}
    <button type="button" class="solo-movil ${ocultos.some(([h]) => hash.startsWith(h)) ? 'activo' : ''}" id="btn-mas" aria-label="Más opciones">${raw('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>')}<span>Más</span></button>`);
  $('#btn-mas').onclick = hojaMas;
}

// ---------- Celular: hoja "Más" (secciones extra y cambio de perfil) ----------
const INICIALES = { admin: 'AD', cliente: 'CL', repartidor: 'RE' };

const conSesion = () => app.conf?.auth_mode === 'jwt';
const iniciales = (nombre) => String(nombre || '?').split(/\s+/).filter((p) => /^\p{L}/u.test(p)).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

function pintarChip() {
  $('#chip-avatar').textContent = conSesion() ? iniciales(app.usuario?.nombre) : INICIALES[app.usuario?.rol] || '?';
  $('#chip-rol').textContent = !app.usuario ? 'Perfil' : conSesion() ? app.usuario.nombre.split(' ')[0] : ROL_TXT[app.usuario.rol];
}

function hojaMas() {
  const hash = location.hash;
  const ocultos = (MENUS[app.usuario?.rol] || []).filter(([, , , cls]) => cls === 'solo-escritorio');
  if (conSesion()) return hojaCuenta(ocultos, hash);
  if (!ocultos.length && !app.perfiles.length) return; // nada que mostrar (p. ej. antes de ingresar la clave)
  const m = modal(html`
    ${ocultos.length ? html`<div class="hoja-titulo" style="margin-top:0">Secciones</div><div class="hoja-lista">${ocultos.map(([h, ic, txt]) => html`
      <a href="${h}" class="${hash.startsWith(h) ? 'activo' : ''}">${icono(ic)}${txt}</a>`)}</div>` : ''}
    ${app.perfiles.length ? html`<div class="hoja-titulo" ${ocultos.length ? '' : raw('style="margin-top:0"')}>Ver la plataforma como</div>
    <div class="hoja-lista">${app.perfiles.map((p) => html`<button class="item ${p.id === app.usuario?.id ? 'activo' : ''}" data-perfil="${p.id}">
      <span class="perfil-chip" style="pointer-events:none;padding:0;border:0;background:none"><span class="avatar">${INICIALES[p.rol]}</span></span>${p.nombre}</button>`)}</div>` : ''}
  `);
  m.el.querySelectorAll('a').forEach((a) => { a.addEventListener('click', () => m.cerrar()); });
  m.el.querySelectorAll('[data-perfil]').forEach((b) => { b.onclick = () => { m.cerrar(); cambiarPerfil(Number(b.dataset.perfil)); }; });
}

// ---------- Sesión real (AUTH_MODE=jwt) ----------
function hojaCuenta(ocultos, hash) {
  if (!app.usuario) return;
  const m = modal(html`
    ${ocultos.length ? html`<div class="hoja-titulo" style="margin-top:0">Secciones</div><div class="hoja-lista">${ocultos.map(([h, ic, txt]) => html`
      <a href="${h}" class="${hash.startsWith(h) ? 'activo' : ''}">${icono(ic)}${txt}</a>`)}</div>` : ''}
    <div class="hoja-titulo" ${ocultos.length ? '' : raw('style="margin-top:0"')}>Mi cuenta</div>
    <div class="cuenta-resumen"><span class="avatar">${iniciales(app.usuario.nombre)}</span>
      <div><b>${app.usuario.nombre}</b><div class="sub">${app.usuario.correo} · ${ROL_TXT[app.usuario.rol]}</div></div></div>
    <div class="hoja-lista" style="margin-top:8px">
      <button class="item" id="cambiar-clave">${icono('llave')}Cambiar contraseña</button>
      <button class="item" id="cerrar-todas">${icono('candado')}Cerrar sesión en mis otros dispositivos</button>
      <button class="item" id="cerrar-sesion">${icono('salir')}Cerrar sesión</button>
    </div>`);
  m.el.querySelectorAll('a').forEach((a) => { a.addEventListener('click', () => m.cerrar()); });
  $('#cambiar-clave', m.el).onclick = () => { m.cerrar(); dialogoCambiarClave(); };
  $('#cerrar-sesion', m.el).onclick = () => { m.cerrar(); cerrarSesion(); };
  $('#cerrar-todas', m.el).onclick = async () => {
    try { const r = await post('/api/auth/cerrar-sesiones'); fijarToken(r.token); m.cerrar(); toast('Listo: se cerró tu sesión en los demás dispositivos', 'ok'); }
    catch (err) { errorToast(err); }
  };
}

function pantallaLogin(mensaje) {
  montar($('#menu'), '');
  const n = app.conf.negocio;
  montar($('#vista'), html`<div class="login-caja"><div class="card login">
    <img class="logo" src="${n.logo_url || 'icons/icono.svg'}" alt="">
    <h1>Iniciar sesión</h1><p class="sub">${n.nombre} · Gestión de envíos</p>
    ${mensaje ? html`<div class="aviso alerta" style="margin-top:14px">${mensaje}</div>` : ''}
    <form id="f-login" novalidate>
      <label class="campo">Correo<input name="correo" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="nombre@correo.cl" required></label>
      <label class="campo">Contraseña<span class="clave"><input name="password" type="password" autocomplete="current-password" required>
        <button type="button" class="btn sec chico ver-clave" aria-label="Mostrar contraseña">Mostrar</button></span></label>
      <button class="btn grande ancho" id="entrar">Entrar</button>
    </form>
    <div class="fila entre" style="margin-top:16px"><a href="#/recuperar">¿Olvidaste tu contraseña?</a>
      ${app.conf.operacion?.registro_clientes ? html`<a href="#/registro">Crear cuenta de cliente</a>` : ''}</div>
    <div class="pie"><a href="#/seguimiento">Seguimiento de envío →</a></div>
  </div></div>`);
  const f = $('#f-login');
  const clave = $('input[name="password"]', f);
  $('.ver-clave', f).onclick = (e) => {
    const ver = clave.type === 'password';
    clave.type = ver ? 'text' : 'password';
    e.currentTarget.textContent = ver ? 'Ocultar' : 'Mostrar';
    e.currentTarget.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  };
  $('input[name="correo"]', f).focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = datosForm(f);
    const errores = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo.trim())) errores.correo = 'Escribe un correo válido';
    if (!d.password) errores.password = 'Escribe tu contraseña';
    if (marcarErrores(f, errores)) return;
    const btn = $('#entrar', f);
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const r = await post('/api/auth/login', { correo: d.correo.trim(), password: d.password });
      fijarToken(r.token);
      app.usuario = r.usuario;
      // La configuración se vuelve a pedir con la sesión: los datos de la cuenta para transferir solo llegan a quien entró.
      app.conf = await get('/api/config/publica').catch(() => app.conf);
      pintarSelector();
      ir(INICIO[app.usuario.rol]);
    } catch (err) {
      // El error se muestra en el campo; solo lo que no tiene campo (bloqueo, sin conexión) va como aviso.
      if (!marcarErrores(f, err.status === 401 ? { password: err.message } : err.detalles)) errorToast(err);
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };
}

function dialogoCambiarClave({ obligatorio = false } = {}) {
  const m = modal(html`<h2>${obligatorio ? 'Crea tu contraseña' : 'Cambiar contraseña'}</h2>
    <p class="sub">${obligatorio ? 'Administración te asignó una contraseña temporal. Crea una propia para continuar.' : 'Al cambiarla se cierran tus sesiones en otros dispositivos.'}</p>
    <form class="pila" id="f-clave-nueva" novalidate>
      <label class="campo">Contraseña actual<input name="actual" type="password" autocomplete="current-password"></label>
      <label class="campo">Nueva contraseña <small>(mínimo 8 caracteres, con letras y números)</small><input name="nueva" type="password" autocomplete="new-password" minlength="8"></label>
      <label class="campo">Repite la nueva contraseña<input name="repetir" type="password" autocomplete="new-password"></label>
      <button class="btn grande">Guardar contraseña</button>
    </form>`, { fijo: obligatorio });
  $('#f-clave-nueva', m.el).onsubmit = async (e) => {
    e.preventDefault();
    const d = datosForm(e.target);
    const errores = {};
    if (!d.actual) errores.actual = 'Obligatoria';
    if (d.nueva.length < 8) errores.nueva = 'Mínimo 8 caracteres';
    else if (!/\p{L}/u.test(d.nueva) || !/\d/.test(d.nueva)) errores.nueva = 'Debe tener letras y números';
    else if (d.nueva !== d.repetir) errores.repetir = 'No coincide con la nueva contraseña';
    if (marcarErrores(e.target, errores)) return;
    try {
      const r = await post('/api/auth/cambiar-clave', { actual: d.actual, nueva: d.nueva });
      fijarToken(r.token);
      if (app.usuario) app.usuario.debe_cambiar_clave = false;
      m.cerrar();
      toast('Contraseña actualizada', 'ok');
      // Con la contraseña temporal la API no entregaba datos: se recarga la configuración y la pantalla de fondo.
      if (obligatorio) {
        app.conf = await get('/api/config/publica').catch(() => app.conf);
        ir(location.hash || INICIO[app.usuario?.rol]);
      }
    } catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
  };
}

function cerrarSesion(mensaje) {
  fijarToken(null);
  app.usuario = null;
  $('#modal-raiz').replaceChildren();
  pintarSelector();
  if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname + location.search);
  document.body.classList.add('sin-sesion');
  pantallaLogin(mensaje);
}

// Elegir servidor (localhost / Railway) es una herramienta de desarrollo: el cliente no la ve.
// Se muestra en localhost, o en la app publicada agregando ?dev a la URL (queda recordado).
function modoDesarrollo() {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return true;
  try {
    if (new URLSearchParams(location.search).has('dev')) localStorage.setItem('envios.dev', '1');
    return localStorage.getItem('envios.dev') === '1';
  } catch { return false; }
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
  pintarChip();
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
  if (!modoDesarrollo()) $('#btn-servidor').style.pointerEvents = 'none'; // solo muestra el punto de estado
  $('#chip-perfil').onclick = hojaMas;
  try {
    // Configuración y perfiles se piden en paralelo (una ida y vuelta menos al abrir la app).
    const perfilesP = get('/api/demo/usuarios').then((p) => ({ p }), (err) => ({ err })); // en modo jwt responde 404 y se ignora
    const conf = await get('/api/config/publica');
    let perfiles = [];
    if (conf.auth_mode === 'jwt') {
      app.conf = conf;
      document.body.classList.add('modo-sesion');
      // Sesión guardada en este dispositivo: se valida con el servidor (puede haber expirado).
      if (hayToken()) app.usuario = await get('/api/auth/yo').catch(() => null);
    } else {
      const r = await perfilesP;
      if (r.err?.detalles?.demo_clave) return pedirClaveDemo(conf);
      perfiles = r.p || [];
    }
    app.conf = conf;
    app.perfiles = conf.auth_mode === 'jwt' ? [] : perfiles;
    $('#estado-api').className = 'punto-estado ok';
    $('#marca-nombre').textContent = conf.negocio.nombre;
    document.title = `${conf.negocio.nombre} · Envíos`;
    if (conf.negocio.logo_url) document.querySelector('.marca img').src = conf.negocio.logo_url;
  } catch (err) {
    $('#estado-api').className = 'punto-estado error';
    errorToast(err);
  }
  if (!conSesion()) app.usuario = app.perfiles.find((p) => p.id === perfilActual()) || null;
  pintarSelector();
  window.addEventListener('sesion-expirada', (e) => { if (app.usuario) cerrarSesion(e.detail || 'Tu sesión expiró: vuelve a iniciar sesión.'); });
  window.addEventListener('cambiar-clave', () => { if (app.usuario && !$('#f-clave-nueva')) { app.usuario.debe_cambiar_clave = true; dialogoCambiarClave({ obligatorio: true }); } });
  window.addEventListener('hashchange', enrutar);
  vigilarTeclado();
  enrutar();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  vigilarVersion();
}

// Versión nueva publicada (pedido 07-10): la app abierta desde antes de publicar seguía con el código viejo (el
// repartidor no veía los botones nuevos). Se compara la publicación al volver a la app y cada 5 minutos; si cambió,
// se ofrece actualizar (no se recarga sola para no perder un formulario a medio llenar).
function vigilarVersion() {
  let cargada = null;
  const revisar = async () => {
    if (document.hidden || $('#aviso-version')) return;
    try {
      const r = await fetch(`${urlApi()}/api/health`, { cache: 'no-store' }).then((x) => x.json());
      if (!r?.build) return;
      if (!cargada) { cargada = r.build; return; }
      if (r.build === cargada) return;
      const aviso = document.createElement('div');
      aviso.id = 'aviso-version';
      aviso.className = 'aviso-version';
      aviso.setAttribute('role', 'status');
      montar(aviso, html`<span><b>Hay una versión nueva de la app.</b> Actualiza para ver los últimos cambios.</span><button class="btn blanco chico" type="button">Actualizar</button>`);
      $('button', aviso).onclick = async () => {
        try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* sin service worker */ }
        location.reload();
      };
      document.body.append(aviso);
    } catch { /* sin señal: se revisa la próxima vez */ }
  };
  revisar();
  document.addEventListener('visibilitychange', revisar);
  setInterval(revisar, 5 * 60 * 1000);
}

// Celular: con el teclado abierto la barra inferior tapa el formulario, así que se oculta. Se detecta por el alto
// visible (no por el foco): si se ocultara al enfocar un campo, la barra de botones saltaba justo al tocar "Continuar".
function vigilarTeclado() {
  const vv = window.visualViewport;
  if (!vv) return;
  const revisar = () => document.body.classList.toggle('teclado', vv.height < window.innerHeight * 0.75);
  vv.addEventListener('resize', revisar);
}

// Actualización automática (RNF-22): con muchas personas trabajando a la vez, lo que cambia otro usuario
// (asignaciones, entregas, pagos) aparece solo cada 30 s, sin interrumpir a quien está escribiendo.
setInterval(async () => {
  if (document.hidden || !app.refrescar || $('#modal-raiz').children.length) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
  try { await app.refrescar(); } catch { /* un fallo de red puntual no interrumpe: se reintenta en el próximo ciclo */ }
}, 30000);

iniciar();
