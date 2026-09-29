// Toma las capturas de pantalla del manual recorriendo la app real como cliente, repartidor y administrador.
// Requiere un servidor con datos de ejemplo (node scripts/datos-demo.js). Funciona en AUTH_MODE=demo y jwt.
import { chromium } from 'playwright-core';

const MOVIL = { width: 390, height: 844 };
const MOVIL_ALTO = { width: 390, height: 1250 }; // pantallas largas del celular (la barra inferior queda abajo)
const ESCRITORIO = { width: 1280, height: 860 };
const ESCRITORIO_ALTO = { width: 1280, height: 1350 };

export async function tomarCapturas({ url, credenciales, ejecutable, log = console.log }) {
  const salud = await (await fetch(`${url}/api/health`)).json();
  const modo = salud.auth_mode;
  const tokens = {};
  const ids = {};

  // ---------- Sesiones: demo (perfil elegido) o jwt (inicio de sesión real) ----------
  if (modo === 'demo') {
    const perfiles = await (await fetch(`${url}/api/demo/usuarios`)).json();
    for (const rol of ['admin', 'cliente', 'repartidor']) ids[rol] = perfiles.find((p) => p.rol === rol).id;
  } else {
    for (const rol of ['admin', 'cliente', 'repartidor']) {
      const r = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credenciales[rol]) });
      const d = await r.json();
      if (!r.ok) throw new Error(`No se pudo iniciar sesión como ${rol}: ${d.error}`);
      tokens[rol] = d.token;
      ids[rol] = d.usuario.id;
    }
  }
  const cab = (rol) => (modo === 'demo' ? { 'X-Demo-Usuario': String(ids[rol]) } : { Authorization: `Bearer ${tokens[rol]}` });
  const api = async (rol, ruta, json) => {
    const r = await fetch(`${url}${ruta}`, {
      method: json ? 'POST' : 'GET', headers: { ...cab(rol), ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`${ruta}: ${d.error}`);
    return d;
  };

  // ---------- Datos que necesitan las capturas ----------
  const comunas = await (await fetch(`${url}/api/comunas?cobertura=1`)).json();
  const nuevoPagado = async () => {
    const e = await api('cliente', '/api/envios', {
      confirmar: true, destinatario: { nombre: 'Ignacio Morales', telefono: '+56 9 6677 8899' },
      direccion: { calle: 'Av. Grecia', numero: '2150', comuna_id: comunas.find((c) => c.nombre === 'Ñuñoa').id, referencia: 'Casa con reja blanca' },
      descripcion_producto: 'Cafetera', peso_kg: 3, largo_cm: 35, ancho_cm: 30, alto_cm: 25, valor_declarado: 49990,
    });
    const p = await api('cliente', `/api/envios/${e.id}/pago`, {});
    await api('cliente', `/api/pagos/${p.token}/confirmar`, { resultado: 'aprobado' });
    return e;
  };
  const libreParaTomar = await nuevoPagado();
  const libreAdmin = await nuevoPagado();
  const delRep = (estado) => api('repartidor', `/api/envios?estado=${estado}&limite=20`).then((r) => r.items);
  const enRuta = await delRep('en_ruta');
  const fallido = (await api('admin', '/api/envios?estado=fallido&limite=5')).items[0];
  const sinPagar = (await api('admin', '/api/envios?estado=creado&estado_pago=pendiente&limite=5')).items[0];
  const entregados = (await api('cliente', '/api/envios?estado=entregado&limite=20')).items;
  const entregadoConReclamo = (await api('admin', '/api/reclamos')).find(() => true);
  const entregadoSinReclamo = entregados.find((e) => e.id !== entregadoConReclamo?.envio_id && e.valor_declarado > 0);
  if (enRuta.length < 3) throw new Error('Faltan envíos en ruta: carga los datos con node scripts/datos-demo.js');

  // ---------- Navegador ----------
  const navegador = await chromium.launch({ executablePath: ejecutable || undefined });
  const fotos = {};

  const avisos = [];
  async function captura(nombre, { rol = null, hash = '', tam = MOVIL, completa = false, antes, ruta = '/' } = {}) {
    for (let intento = 1; intento <= 3; intento++) {
      const ctx = await navegador.newContext({
        viewport: tam, deviceScaleFactor: 1.5, locale: 'es-CL', timezoneId: 'America/Santiago',
        permissions: ['geolocation'], geolocation: { latitude: -33.4263, longitude: -70.617, accuracy: 12 },
      });
      const page = await ctx.newPage();
      try {
        await page.goto(`${url}/`);
        await page.evaluate(({ modo, id, token }) => {
          localStorage.clear();
          if (modo === 'demo' && id) localStorage.setItem('envios.perfil', String(id));
          if (token) localStorage.setItem('envios.token', token);
        }, { modo, id: rol ? ids[rol] : null, token: rol ? tokens[rol] : null });
        await page.goto(`${url}${ruta}${hash}`);
        await page.waitForLoadState('networkidle');
        // Con perfil, la pantalla debe mostrar el menú de ese perfil (si no, se reintenta).
        if (rol) await page.waitForSelector('#menu a', { timeout: 5000 });
        await page.waitForTimeout(600);
        if (antes) { await antes(page); await page.waitForTimeout(700); }
        // Control de calidad: nada debe salirse del ancho de la pantalla.
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (desborde > 1) avisos.push(`${nombre}: la página se sale ${desborde}px del ancho de la pantalla`);
        fotos[nombre] = (await page.screenshot({ type: 'jpeg', quality: 72, fullPage: completa })).toString('base64');
        log(`  ✔ ${nombre}`);
        return;
      } catch (err) {
        if (intento === 3) log(`  ✖ ${nombre}: ${err.message.split('\n')[0]}`);
      } finally {
        await ctx.close();
      }
    }
  }
  const clic = (sel) => (p) => p.click(sel);

  // ---------- Inicio de sesión (solo con AUTH_MODE=jwt) ----------
  if (modo !== 'demo') {
    await captura('login', { tam: MOVIL });
    await captura('login-escritorio', { tam: ESCRITORIO });
  }

  // ---------- Cliente ----------
  await captura('c-inicio', { rol: 'cliente', hash: '#/inicio', tam: MOVIL_ALTO });
  const paso1 = async (p) => { await p.click('[data-modo="nuevo"]'); await p.fill('input[name="nombre"]', 'Daniela Rivas'); await p.fill('input[name="telefono"]', '+56 9 8123 4567'); };
  const paso2 = async (p) => {
    await paso1(p); await p.click('#siguiente'); await p.waitForSelector('input[name="calle"]');
    await p.fill('input[name="calle"]', 'Av. Providencia'); await p.fill('input[name="numero"]', '1650'); await p.fill('input[name="depto"]', 'Depto 402');
    await p.selectOption('select[name="comuna_id"]', { label: 'Providencia' }); await p.fill('input[name="referencia"]', 'Conserjería 24 horas');
  };
  const paso3 = async (p) => {
    await paso2(p); await p.click('#siguiente'); await p.waitForSelector('input[name="descripcion_producto"]');
    await p.fill('input[name="descripcion_producto"]', 'Polera de algodón (2 unidades)'); await p.fill('input[name="peso_kg"]', '0.8');
    for (const [k, v] of [['largo_cm', '30'], ['ancho_cm', '25'], ['alto_cm', '8'], ['valor_declarado', '25980']]) await p.fill(`input[name="${k}"]`, v);
    await p.waitForTimeout(900);
  };
  const paso4 = async (p) => { await paso3(p); await p.click('#siguiente'); await p.waitForSelector('.desglose .total'); };
  await captura('c-nuevo-1', { rol: 'cliente', hash: '#/nuevo', antes: paso1 });
  await captura('c-nuevo-2', { rol: 'cliente', hash: '#/nuevo', antes: paso2 });
  await captura('c-nuevo-3', { rol: 'cliente', hash: '#/nuevo', antes: paso3, tam: MOVIL_ALTO });
  await captura('c-nuevo-4', { rol: 'cliente', hash: '#/nuevo', antes: paso4, tam: MOVIL_ALTO });
  await captura('c-exito', { rol: 'cliente', hash: '#/nuevo', tam: MOVIL_ALTO, antes: async (p) => { await paso4(p); await p.click('#siguiente'); await p.waitForSelector('#pagar'); await p.waitForTimeout(800); } });
  await captura('c-pago', { rol: 'cliente', hash: `#/envio/${sinPagar.id}`, antes: async (p) => { await p.click('#pagar'); await p.waitForSelector('#aprobar'); } });
  await captura('c-envios', { rol: 'cliente', hash: '#/envios' });
  await captura('c-detalle', { rol: 'cliente', hash: `#/envio/${entregados[0].id}`, tam: ESCRITORIO, completa: true });
  await captura('c-libreta', { rol: 'cliente', hash: '#/libreta' });
  if (entregadoSinReclamo) await captura('c-reclamo', { rol: 'cliente', hash: `#/envio/${entregadoSinReclamo.id}`, tam: ESCRITORIO_ALTO, antes: clic('#reclamar') });
  await captura('c-seguros', { rol: 'cliente', hash: '#/reclamos', tam: ESCRITORIO });
  await captura('seguimiento', { hash: `#/seguimiento/${entregados[0].folio}` });

  // ---------- Repartidor ----------
  await captura('r-ruta', { rol: 'repartidor', hash: '#/ruta', tam: MOVIL_ALTO });
  await api('repartidor', `/api/envios/${libreParaTomar.id}/tomar`, {});
  await captura('r-asignado', { rol: 'repartidor', hash: `#/envio/${libreParaTomar.id}`, tam: MOVIL_ALTO });
  await captura('r-en-ruta', { rol: 'repartidor', hash: `#/envio/${enRuta[0].id}`, tam: MOVIL_ALTO });
  await captura('r-espera', { rol: 'repartidor', hash: `#/envio/${enRuta[1].id}`, antes: async (p) => { await p.click('#llegue'); await p.waitForSelector('#reloj'); await p.waitForTimeout(2500); } });
  await captura('r-entregar', { rol: 'repartidor', hash: `#/envio/${enRuta[2].id}`, antes: async (p) => { await p.click('#entregar'); await p.waitForSelector('#gps.ok', { timeout: 8000 }).catch(() => {}); } });
  await captura('r-fallido', { rol: 'repartidor', hash: `#/envio/${enRuta[0].id}`, antes: clic('#fallido') });
  await captura('r-historial', { rol: 'repartidor', hash: '#/envios' });

  // ---------- Administrador ----------
  await captura('a-panel', { rol: 'admin', hash: '#/panel', tam: ESCRITORIO_ALTO });
  await captura('a-panel-movil', { rol: 'admin', hash: '#/panel' });
  await captura('a-envios', { rol: 'admin', hash: '#/envios', tam: ESCRITORIO });
  await captura('a-asignar', { rol: 'admin', hash: `#/envio/${libreAdmin.id}`, tam: ESCRITORIO });
  if (fallido) await captura('a-fallido', { rol: 'admin', hash: `#/envio/${fallido.id}`, tam: ESCRITORIO, completa: true });
  await captura('a-pago-manual', { rol: 'admin', hash: `#/envio/${sinPagar.id}`, tam: ESCRITORIO, antes: clic('#pago-manual') });
  await captura('a-cobranza', { rol: 'admin', hash: '#/cobranza', tam: ESCRITORIO_ALTO });
  await captura('a-reclamos', { rol: 'admin', hash: '#/reclamos', tam: ESCRITORIO });
  await captura('a-tarifas', { rol: 'admin', hash: '#/tarifas', tam: ESCRITORIO_ALTO });
  await captura('a-usuarios', { rol: 'admin', hash: '#/usuarios', tam: ESCRITORIO });
  await captura('a-ajustes', { rol: 'admin', hash: '#/ajustes', tam: ESCRITORIO, completa: true });
  const conQr = await api('admin', `/api/envios/${entregados[0].id}`);
  await captura('qr', { ruta: `/q/${conQr.token_qr}` });

  await navegador.close();
  return { fotos, modo, avisos };
}
