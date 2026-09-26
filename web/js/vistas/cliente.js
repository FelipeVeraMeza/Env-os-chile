import { app, ir } from '../app.js';
import { enviarForm, get, post, patch, api } from '../api.js';
import {
  $, $$, abrirBlob, badgePago, clp, comprimirFoto, datosForm, errorToast, esqueleto, html, icono, marcarErrores, modal, montar, toast, vacio,
} from '../ui.js';
import { comunasCobertura, direccionTexto, itemEnvio, opcionesComunas } from './comun.js';
import { pagar } from './envios.js';

// ================= Inicio del cliente =================
export async function inicio() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const { items, total } = await get('/api/envios?limite=100');
  const enCurso = items.filter((e) => ['creado', 'asignado', 'en_ruta', 'fallido', 'reagendado'].includes(e.estado));
  const porPagar = items.filter((e) => e.estado_pago === 'pendiente' && !['borrador', 'anulado'].includes(e.estado));
  const entregados = items.filter((e) => e.estado === 'entregado');
  const nombre = app.usuario.nombre.split(' ')[0];
  montar(vista, html`
    <section class="hero">
      <h1>Hola, ${nombre} 👋</h1>
      <p>Crea tu envío en menos de un minuto. Dentro de Santiago desde <b>${clp(app.conf.tarifas.base)}</b> hasta ${app.conf.tarifas.peso_max_kg} kg y ${app.conf.tarifas.dim_max_cm}×${app.conf.tarifas.dim_max_cm}×${app.conf.tarifas.dim_max_cm} cm. También llevamos tus paquetes a puntos Blue Express, Starken y otros, sin límite de bultos.</p>
      <div class="fila" style="margin-top:16px">
        <a class="btn blanco grande" href="#/nuevo">${icono('nuevo')} Nuevo envío</a>
        <a class="btn sec grande" href="#/seguimiento">Seguir un folio</a>
      </div>
    </section>
    <div class="grid g4" style="margin-bottom:20px">
      <div class="kpi"><div class="etiqueta">En curso</div><div class="valor">${enCurso.length}</div><div class="nota">envíos activos</div></div>
      <div class="kpi"><div class="etiqueta">Por pagar</div><div class="valor">${porPagar.length}</div><div class="nota">${clp(porPagar.reduce((s, e) => s + e.tarifa_total, 0))}</div></div>
      <div class="kpi"><div class="etiqueta">Entregados</div><div class="valor">${entregados.length}</div><div class="nota">con foto y GPS</div></div>
      <div class="kpi destacado"><div class="etiqueta">Total</div><div class="valor">${total}</div><div class="nota">envíos registrados</div></div>
    </div>
    ${porPagar.length ? html`<div class="aviso magenta" style="margin-bottom:16px"><b>Tienes ${porPagar.length} envío(s) pendientes de pago.</b> El repartidor solo puede retirar envíos pagados.</div>` : ''}
    <div class="card">
      <div class="card-titulo"><h2>Envíos recientes</h2><a class="btn sec chico" href="#/envios">Ver todos</a></div>
      <div class="lista-envios">${items.length ? items.slice(0, 6).map((e) => itemEnvio(e)) : vacio('Aún no tienes envíos.', html`<a class="btn" href="#/nuevo">Crear mi primer envío</a>`)}</div>
    </div>`);
}

// ================= Nuevo envío (asistente en 4 pasos) =================
const PASOS = ['Destinatario', 'Destino', 'Paquete', 'Confirmar'];

export async function nuevo() {
  const vista = $('#vista');
  montar(vista, esqueleto(2));
  const esAdmin = app.usuario.rol === 'admin';
  const [comunas, clientes] = await Promise.all([comunasCobertura(), esAdmin ? get('/api/usuarios?rol=cliente') : []]);
  const w = {
    paso: 0, clienteId: esAdmin ? clientes[0]?.id : app.usuario.id, modoDest: 'libreta', destinatario: null, nuevoDest: {},
    tipo_destino: 'domicilio', direccionId: null, nuevaDir: {}, courier: {}, paquete: { bultos: 1 }, boleta: null, foto: null, cotizacion: null,
  };
  let libreta = [];
  const cargarLibreta = async () => {
    libreta = w.clienteId ? await get(`/api/destinatarios${esAdmin ? `?cliente_id=${w.clienteId}` : ''}`) : [];
    if (!libreta.length) w.modoDest = 'nuevo';
  };
  await cargarLibreta();

  const cuerpo = () => {
    if (w.paso === 0) return pasoDestinatario();
    if (w.paso === 1) return pasoDestino();
    if (w.paso === 2) return pasoPaquete();
    return pasoResumen();
  };

  function pasoDestinatario() {
    return html`
      ${esAdmin ? html`<label class="campo" style="margin-bottom:16px">Cliente dueño del envío
        <select name="cliente_id" id="sel-cliente">${clientes.map((c) => html`<option value="${c.id}" ${c.id === w.clienteId ? html`selected` : ''}>${c.nombre}</option>`)}</select></label>` : ''}
      <div class="segmentos" style="margin-bottom:16px">
        <button type="button" data-modo="libreta" class="${w.modoDest === 'libreta' ? 'activo' : ''}" ${libreta.length ? '' : html`disabled`}>De mi libreta (${libreta.length})</button>
        <button type="button" data-modo="nuevo" class="${w.modoDest === 'nuevo' ? 'activo' : ''}">Nuevo destinatario</button>
      </div>
      ${w.modoDest === 'libreta' ? html`
        <input type="search" id="buscar-dest" placeholder="Buscar por nombre o teléfono…" style="margin-bottom:12px">
        <div class="lista-envios" id="lista-dest">${libreta.map((d) => html`
          <label class="item-envio" data-nombre="${(d.nombre + ' ' + d.telefono).toLowerCase()}" style="cursor:pointer">
            <div><div class="folio">${d.nombre}</div><div class="dir">${d.telefono} · ${d.direcciones.length} dirección(es)</div></div>
            <input type="radio" name="dest" value="${d.id}" ${w.destinatario?.id === d.id ? html`checked` : ''} style="width:22px;min-height:22px">
          </label>`)}</div>` : html`
        <div class="grid g2">
          <label class="campo">Nombre completo *<input name="nombre" value="${w.nuevoDest.nombre || ''}" autocomplete="name" required></label>
          <label class="campo">Teléfono móvil *<input name="telefono" value="${w.nuevoDest.telefono || ''}" inputmode="tel" placeholder="+56 9 1234 5678" autocomplete="tel"></label>
          <label class="campo">Correo <small>(opcional)</small><input name="correo" type="email" value="${w.nuevoDest.correo || ''}"></label>
          <label class="campo">RUT <small>(opcional)</small><input name="rut" value="${w.nuevoDest.rut || ''}" placeholder="12.345.678-5"></label>
        </div>
        <p class="muted" style="margin-top:10px">El destinatario queda guardado en tu libreta con todas sus direcciones.</p>`}`;
  }

  function pasoDestino() {
    const dirs = w.modoDest === 'libreta' && w.destinatario ? w.destinatario.direcciones : [];
    const nueva = !dirs.length || w.direccionId === 'nueva';
    return html`
      <div class="segmentos" style="margin-bottom:16px">
        <button type="button" data-tipo="domicilio" class="${w.tipo_destino === 'domicilio' ? 'activo' : ''}">A domicilio</button>
        <button type="button" data-tipo="punto_courier" class="${w.tipo_destino === 'punto_courier' ? 'activo' : ''}">Punto Blue / Starken / otro</button>
      </div>
      ${w.tipo_destino === 'punto_courier' ? html`
        <div class="aviso" style="margin-bottom:14px">Llevamos tus paquetes al punto de la empresa que elijas, <b>sin límite de bultos</b>, por ${clp(app.conf.tarifas.base)}.</div>
        <div class="grid g3" style="margin-bottom:16px">
          <label class="campo">Empresa *<select name="courier_empresa">${app.conf.couriers.map((c) => html`<option ${w.courier.courier_empresa === c ? html`selected` : ''}>${c}</option>`)}</select></label>
          <label class="campo">Punto / sucursal *<input name="courier_punto" value="${w.courier.courier_punto || ''}" placeholder="Ej. Sucursal Providencia"></label>
          <label class="campo">Código de envío <small>(opcional)</small><input name="courier_codigo" value="${w.courier.courier_codigo || ''}"></label>
        </div>
        <h3>Dirección del punto</h3>` : ''}
      ${dirs.length ? html`<div class="lista-envios" style="margin-bottom:14px">
        ${dirs.map((d) => html`<label class="item-envio" style="cursor:pointer"><div><div class="folio">${d.alias || 'Dirección'} ${d.es_principal ? html`<span class="badge e-creado">Principal</span>` : ''}</div>
          <div class="dir">${d.calle} ${d.numero}${d.depto ? ', ' + d.depto : ''} · ${d.comuna_nombre}</div></div>
          <input type="radio" name="dir" value="${d.id}" ${String(w.direccionId) === String(d.id) ? html`checked` : ''} style="width:22px;min-height:22px"></label>`)}
        <label class="item-envio" style="cursor:pointer"><div><div class="folio">+ Nueva dirección</div><div class="dir">¿Se cambió de casa? Agrega la nueva dirección</div></div>
          <input type="radio" name="dir" value="nueva" ${w.direccionId === 'nueva' ? html`checked` : ''} style="width:22px;min-height:22px"></label></div>` : ''}
      ${nueva ? html`<div class="grid g2">
        <label class="campo">Calle *<input name="calle" value="${w.nuevaDir.calle || ''}" autocomplete="address-line1"></label>
        <div class="grid g2"><label class="campo">Número *<input name="numero" value="${w.nuevaDir.numero || ''}" inputmode="numeric"></label>
          <label class="campo">Depto / casa<input name="depto" value="${w.nuevaDir.depto || ''}"></label></div>
        <label class="campo">Comuna *<select name="comuna_id">${opcionesComunas(comunas, w.nuevaDir.comuna_id)}</select><small>Solo comunas dentro de la cobertura</small></label>
        <label class="campo">Nombre de la dirección <small>(opcional)</small><input name="alias" value="${w.nuevaDir.alias || ''}" placeholder="Casa, oficina…"></label>
        <label class="campo" style="grid-column:1/-1">Referencia<input name="referencia" value="${w.nuevaDir.referencia || ''}" placeholder="Portón verde, conserje recibe hasta las 20:00"></label>
      </div>` : ''}`;
  }

  function pasoPaquete() {
    const p = w.paquete;
    const t = app.conf.tarifas;
    return html`
      <div class="grid g2">
        <label class="campo" style="grid-column:1/-1">Descripción del producto *<input name="descripcion_producto" value="${p.descripcion_producto || ''}" placeholder="Ej. Zapatillas talla 42"></label>
        <label class="campo">Bultos *<input name="bultos" type="number" min="1" value="${p.bultos || 1}">
          <small>${w.tipo_destino === 'punto_courier' ? 'Punto courier: sin límite de paquetes' : `Cada bulto adicional a domicilio: ${clp(t.bulto_adicional_domicilio)}`}</small></label>
        <label class="campo">Peso por bulto (kg) *<input name="peso_kg" type="number" step="0.1" min="0" max="${t.peso_max_kg}" value="${p.peso_kg || ''}"><small>Máximo ${t.peso_max_kg} kg</small></label>
      </div>
      <div class="grid g3" style="margin-top:14px">
        <label class="campo">Largo (cm) *<input name="largo_cm" type="number" min="1" max="${t.dim_max_cm}" value="${p.largo_cm || ''}"></label>
        <label class="campo">Ancho (cm) *<input name="ancho_cm" type="number" min="1" max="${t.dim_max_cm}" value="${p.ancho_cm || ''}"></label>
        <label class="campo">Alto (cm) *<input name="alto_cm" type="number" min="1" max="${t.dim_max_cm}" value="${p.alto_cm || ''}"></label>
      </div>
      <p class="muted" style="margin:6px 0 16px">Tarifa estándar hasta ${t.peso_max_kg} kg y ${t.dim_max_cm}×${t.dim_max_cm}×${t.dim_max_cm} cm por bulto.</p>
      <div class="card" style="box-shadow:none;background:rgba(224,33,138,.08);border-color:rgba(224,33,138,.35)">
        <h3>Seguro del envío</h3>
        <div class="grid g2">
          <label class="campo">Valor declarado (CLP)<input name="valor_declarado" type="number" min="0" step="1" value="${p.valor_declarado || ''}" placeholder="0"><small>Tope de la indemnización en caso de pérdida o daño</small></label>
          <label class="campo">Boleta de compra <small>(obligatoria para cobrar el seguro)</small><input type="file" name="boleta" accept="application/pdf,image/*">
            <small>${w.boleta ? `Adjunta: ${w.boleta.name}` : 'PDF o foto. Puedes adjuntarla ahora o al reclamar.'}</small></label>
        </div>
      </div>
      <div class="card" style="box-shadow:none">
        <label class="interruptor"><input type="checkbox" name="horario_especial" ${p.horario_especial ? html`checked` : ''}> Envío especial por horario <span class="badge e-en_ruta">+${clp(t.recargo_horario_especial)}</span></label>
        ${p.horario_especial ? html`<label class="campo" style="margin-top:12px">Franja horaria *<select name="franja_horaria"><option value="">Selecciona…</option>${app.conf.franjas.map((f) => html`<option ${p.franja_horaria === f ? html`selected` : ''}>${f}</option>`)}</select></label>` : ''}
      </div>
      <div class="grid g2" style="margin-top:16px">
        <label class="campo">Foto del paquete <small>(opcional)</small><input type="file" name="foto" accept="image/*" capture="environment"></label>
        <label class="campo">Observaciones<input name="observaciones" value="${p.observaciones || ''}" placeholder="Frágil, llamar antes…"></label>
      </div>`;
  }

  function pasoResumen() {
    const c = w.cotizacion || {};
    const d = w.modoDest === 'libreta' ? w.destinatario : w.nuevoDest;
    const dirSel = w.destinatario?.direcciones?.find((x) => String(x.id) === String(w.direccionId));
    const dir = dirSel || { ...w.nuevaDir, comuna_nombre: comunas.find((x) => String(x.id) === String(w.nuevaDir.comuna_id))?.nombre };
    const p = w.paquete;
    return html`<div class="grid g2">
      <div class="pila">
        <div><div class="muted">Destinatario</div><b>${d?.nombre}</b> · ${d?.telefono}</div>
        <div><div class="muted">${w.tipo_destino === 'punto_courier' ? `Punto ${w.courier.courier_empresa}` : 'Dirección'}</div>
          ${w.tipo_destino === 'punto_courier' ? html`<b>${w.courier.courier_punto}</b><br>` : ''}${dir.calle} ${dir.numero}${dir.depto ? ', ' + dir.depto : ''} · <b>${dir.comuna_nombre}</b></div>
        <div><div class="muted">Paquete</div>${p.descripcion_producto} · ${p.bultos} bulto(s) · ${p.peso_kg} kg · ${p.largo_cm}×${p.ancho_cm}×${p.alto_cm} cm</div>
        <div><div class="muted">Seguro</div>${Number(p.valor_declarado) > 0 ? html`Valor declarado ${clp(p.valor_declarado)} · ${w.boleta ? html`boleta adjunta ✔` : html`<span style="color:var(--alerta)">sin boleta (la necesitarás para cobrar el seguro)</span>`}` : 'Sin valor declarado'}</div>
        ${p.horario_especial ? html`<div><div class="muted">Horario especial</div>${p.franja_horaria}</div>` : ''}
      </div>
      <div class="card" style="box-shadow:none">
        <h3>Tarifa</h3>
        <div class="desglose">
          <div><span>Tarifa base</span><span>${clp(c.tarifa_base)}</span></div>
          ${c.recargo_bultos ? html`<div><span>Bultos adicionales</span><span>${clp(c.recargo_bultos)}</span></div>` : ''}
          ${c.recargo_horario ? html`<div><span>Horario especial</span><span>${clp(c.recargo_horario)}</span></div>` : ''}
          <div class="total"><span>Total</span><span>${clp(c.tarifa_total)}</span></div>
        </div>
        <p class="muted" style="margin-top:10px">El pago se realiza en línea antes del retiro.</p>
      </div></div>`;
  }

  const pintar = () => {
    montar(vista, html`
      <div class="encabezado"><div><h1>Nuevo envío</h1><p>Paso ${w.paso + 1} de 4 · ${PASOS[w.paso]}</p></div></div>
      <div class="pasos">${PASOS.map((p, i) => html`<div class="paso ${i < w.paso ? 'hecho' : i === w.paso ? 'actual' : ''}">${p}</div>`)}</div>
      <form class="card" id="form-envio" novalidate>
        ${cuerpo()}
        <div class="fila entre acciones-fijas" style="margin-top:22px">
          <button type="button" class="btn sec" id="atras" ${w.paso === 0 ? html`disabled` : ''}>Atrás</button>
          <div class="fila">${w.cotizacion && w.paso === 2 ? html`<span class="sub">Tarifa: <b>${clp(w.cotizacion.tarifa_total)}</b></span>` : ''}
          <button type="submit" class="btn grande" id="siguiente">${w.paso === 3 ? 'Confirmar envío' : 'Continuar'}</button></div>
        </div>
      </form>`);
    enlazar();
  };

  const form = () => $('#form-envio');

  function guardarPaso() {
    const d = datosForm(form());
    if (w.paso === 0) {
      if (esAdmin && d.cliente_id) w.clienteId = Number(d.cliente_id);
      if (w.modoDest === 'nuevo') w.nuevoDest = { nombre: d.nombre, telefono: d.telefono, correo: d.correo, rut: d.rut };
      else w.destinatario = libreta.find((x) => String(x.id) === d.dest) || null;
    } else if (w.paso === 1) {
      if (d.dir) w.direccionId = d.dir === 'nueva' ? 'nueva' : Number(d.dir);
      if ('calle' in d) w.nuevaDir = { calle: d.calle, numero: d.numero, depto: d.depto, comuna_id: d.comuna_id, alias: d.alias, referencia: d.referencia };
      if (w.tipo_destino === 'punto_courier') w.courier = { courier_empresa: d.courier_empresa, courier_punto: d.courier_punto, courier_codigo: d.courier_codigo };
    } else if (w.paso === 2) {
      w.paquete = { ...w.paquete, ...d };
    }
  }

  function payload() {
    const b = { tipo_destino: w.tipo_destino, ...(w.tipo_destino === 'punto_courier' ? w.courier : {}), ...w.paquete, cliente_id: w.clienteId };
    b.horario_especial = Boolean(w.paquete.horario_especial);
    if (w.modoDest === 'libreta' && w.destinatario) b.destinatario_id = w.destinatario.id;
    else b.destinatario = w.nuevoDest;
    const usaNueva = !(w.modoDest === 'libreta' && w.destinatario?.direcciones.length) || w.direccionId === 'nueva';
    if (usaNueva) b.direccion = w.nuevaDir;
    else b.direccion_id = w.direccionId;
    return b;
  }

  function validarLocal() {
    const e = {};
    if (w.paso === 0) {
      if (w.modoDest === 'libreta' && !w.destinatario) { toast('Selecciona un destinatario de tu libreta', 'error'); return false; }
      if (w.modoDest === 'nuevo') {
        if (!w.nuevoDest.nombre?.trim()) e.nombre = 'Nombre obligatorio';
        if (!/^(\+?56)?\s*9?\s*\d{4}\s*\d{4}$/.test((w.nuevoDest.telefono || '').replace(/\s+/g, ' ').trim())) e.telefono = 'Formato +56 9 XXXX XXXX';
      }
    }
    if (w.paso === 1) {
      const usaNueva = !(w.modoDest === 'libreta' && w.destinatario?.direcciones.length) || w.direccionId === 'nueva';
      if (!usaNueva && !w.direccionId) { toast('Elige una dirección', 'error'); return false; }
      if (usaNueva) {
        if (!w.nuevaDir.calle?.trim()) e.calle = 'Obligatorio';
        if (!w.nuevaDir.numero?.trim()) e.numero = 'Obligatorio';
        if (!w.nuevaDir.comuna_id) e.comuna_id = 'Selecciona la comuna';
      }
      if (w.tipo_destino === 'punto_courier' && !w.courier.courier_punto?.trim()) e.courier_punto = 'Indica el punto';
    }
    return !marcarErrores(form(), e);
  }

  async function cotizarAhora() {
    const b = payload();
    const comunaId = b.direccion?.comuna_id || w.destinatario?.direcciones.find((x) => x.id === w.direccionId)?.comuna_id;
    w.cotizacion = await post('/api/envios/cotizar', { ...b, comuna_id: comunaId });
    return w.cotizacion;
  }

  function enlazar() {
    const f = form();
    $$('[data-modo]', f).forEach((b) => { b.onclick = () => { guardarPaso(); w.modoDest = b.dataset.modo; pintar(); }; });
    $$('[data-tipo]', f).forEach((b) => { b.onclick = () => { guardarPaso(); w.tipo_destino = b.dataset.tipo; pintar(); }; });
    $('#sel-cliente', f)?.addEventListener('change', async (ev) => { w.clienteId = Number(ev.target.value); w.destinatario = null; w.modoDest = 'libreta'; await cargarLibreta(); pintar(); });
    $('#buscar-dest', f)?.addEventListener('input', (ev) => {
      const q = ev.target.value.toLowerCase();
      $$('#lista-dest [data-nombre]', f).forEach((el) => { el.style.display = el.dataset.nombre.includes(q) ? '' : 'none'; });
    });
    $$('input[name="dir"]', f).forEach((r) => { r.onchange = () => { guardarPaso(); pintar(); }; });
    $('input[name="horario_especial"]', f)?.addEventListener('change', () => { guardarPaso(); pintar(); cotizarAhora().then(pintarTarifa).catch(() => {}); });
    $('input[name="boleta"]', f)?.addEventListener('change', (ev) => { w.boleta = ev.target.files[0] || null; });
    $('input[name="foto"]', f)?.addEventListener('change', (ev) => { w.foto = ev.target.files[0] || null; });
    if (w.paso === 2) {
      f.addEventListener('input', () => { clearTimeout(w.t); w.t = setTimeout(() => { guardarPaso(); cotizarAhora().then(pintarTarifa).catch(() => {}); }, 400); });
    }
    $('#atras', f).onclick = () => { guardarPaso(); w.paso -= 1; pintar(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      guardarPaso();
      if (!validarLocal()) return;
      const btn = $('#siguiente', f);
      btn.disabled = true;
      try {
        if (w.paso === 2) {
          const c = await cotizarAhora();
          if (Object.keys(c.errores).length) { marcarErrores(f, c.errores); toast(Object.values(c.errores)[0], 'error'); return; }
        }
        if (w.paso < 3) { w.paso += 1; pintar(); return; }
        await crear();
      } catch (err) {
        errorToast(err);
        if (err.detalles) irAlError(err.detalles);
      } finally { btn.disabled = false; }
    };
  }

  function pintarTarifa() {
    const span = $('#form-envio .fila .sub');
    if (span && w.cotizacion) span.innerHTML = `Tarifa: <b>${clp(w.cotizacion.tarifa_total)}</b>`;
  }

  function irAlError(detalles) {
    const claves = Object.keys(detalles);
    if (!claves.length) return;
    const k = claves[0];
    w.paso = k.startsWith('destinatario') ? 0 : /^(direccion|tipo_destino|courier|comuna)/.test(k) ? 1 : 2;
    pintar();
    const limpio = Object.fromEntries(Object.entries(detalles).map(([c, v]) => [c.split('.').pop(), v]));
    marcarErrores(form(), limpio);
  }

  async function crear() {
    const envio = await post('/api/envios', { ...payload(), confirmar: true });
    const subir = async (archivo, tipo) => {
      const fd = new FormData();
      fd.append('tipo', tipo);
      fd.append('archivo', tipo === 'foto_paquete' ? await comprimirFoto(archivo) : archivo);
      await enviarForm(`/api/envios/${envio.id}/adjuntos`, fd);
    };
    try {
      if (w.boleta) await subir(w.boleta, 'boleta');
      if (w.foto) await subir(w.foto, 'foto_paquete');
    } catch (err) { toast(`Envío creado, pero un adjunto no se subió: ${err.message}`, 'error'); }
    exito(envio);
  }

  function exito(envio) {
    const seguimiento = `${location.origin}${location.pathname}#/seguimiento/${envio.folio}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(`Tu envío ${envio.folio} ya está registrado. Síguelo aquí: ${seguimiento}`)}`;
    montar(vista, html`
      <section class="hero"><p>Envío confirmado</p><h1 class="mono" style="font-size:2.4rem">${envio.folio}</h1>
        <p>${envio.destinatario_nombre} · ${direccionTexto(envio)}</p></section>
      <div class="grid g2">
        <div class="card" style="text-align:center"><div class="qr-caja"><img id="qr" alt="Código QR del envío ${envio.folio}"></div>
          <p class="sub" style="margin-top:10px">Al escanearlo se abre la ruta en Google Maps o Waze.</p></div>
        <div class="card pila">
          <div class="fila entre"><h2 style="margin:0">Total ${clp(envio.tarifa_total)}</h2>${badgePago(envio.estado_pago)}</div>
          <div class="aviso magenta">Paga ahora para que el repartidor pueda retirar tu envío.</div>
          <button class="btn grande ancho" id="pagar">Pagar ${clp(envio.tarifa_total)}</button>
          <div class="grid g2"><button class="btn sec" id="t80">Ticket 80 mm</button><button class="btn sec" id="ta4">Ticket A4</button></div>
          <a class="btn sec" href="${wa}" target="_blank" rel="noopener">Compartir por WhatsApp</a>
          <div class="fila"><a class="btn azul" href="#/envio/${envio.id}">Ver detalle</a><a class="btn sec" href="#/nuevo" id="otro">Crear otro envío</a></div>
        </div>
      </div>`);
    api(`/api/envios/${envio.id}/qr.png`, { blob: true }).then((b) => { $('#qr').src = URL.createObjectURL(b); }).catch(() => {});
    $('#pagar').onclick = () => pagar(envio, () => ir(`#/envio/${envio.id}`));
    $('#t80').onclick = () => abrirBlob(api(`/api/envios/${envio.id}/ticket.pdf?formato=80mm`, { blob: true })).catch(errorToast);
    $('#ta4').onclick = () => abrirBlob(api(`/api/envios/${envio.id}/ticket.pdf?formato=a4`, { blob: true })).catch(errorToast);
    $('#otro').onclick = (e) => { e.preventDefault(); nuevo(); };
  }

  pintar();
}

// ================= Libreta de destinatarios =================
export async function libreta() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const [lista, comunas] = await Promise.all([get('/api/destinatarios'), comunasCobertura()]);
  montar(vista, html`
    <div class="encabezado"><div><h1>Destinatarios</h1><p>Tu libreta: cada destinatario puede tener varias direcciones (por si se cambia de casa).</p></div>
      <button class="btn" id="nuevo-dest">${icono('nuevo')} Nuevo destinatario</button></div>
    ${lista.length ? html`<div class="grid g2">${lista.map((d) => html`
      <div class="card" style="margin:0">
        <div class="card-titulo"><div><h2>${d.nombre}</h2><div class="sub">${d.telefono}${d.correo ? ' · ' + d.correo : ''}</div></div><span class="badge e-creado">${d.envios} envío(s)</span></div>
        <div class="pila">${d.direcciones.map((di) => html`
          <div class="fila entre" style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05)">
            <div><b>${di.alias || 'Dirección'}</b> ${di.es_principal ? html`<span class="badge e-en_ruta">Principal</span>` : ''}<div class="sub">${di.calle} ${di.numero}${di.depto ? ', ' + di.depto : ''} · ${di.comuna_nombre}</div></div>
            <div class="fila">${di.es_principal ? '' : html`<button class="btn sec chico" data-principal="${d.id}:${di.id}">Principal</button>`}
              <button class="btn peligro chico" data-quitar="${d.id}:${di.id}" aria-label="Quitar dirección">Quitar</button></div>
          </div>`)}</div>
        <button class="btn sec chico" style="margin-top:12px" data-agregar="${d.id}">+ Agregar dirección</button>
      </div>`)}</div>` : html`<div class="card">${vacio('Tu libreta está vacía. Los destinatarios se guardan solos al crear un envío.')}</div>`}`);

  const formDireccion = (destId) => {
    const m = modal(html`<h2>Nueva dirección</h2><form class="pila" id="f-dir" novalidate>
      <label class="campo">Nombre de la dirección<input name="alias" placeholder="Casa nueva, oficina…"></label>
      <label class="campo">Calle *<input name="calle"></label>
      <div class="grid g2"><label class="campo">Número *<input name="numero"></label><label class="campo">Depto / casa<input name="depto"></label></div>
      <label class="campo">Comuna *<select name="comuna_id">${opcionesComunas(comunas)}</select></label>
      <label class="campo">Referencia<input name="referencia"></label>
      <label class="interruptor"><input type="checkbox" name="es_principal" checked> Usar como dirección principal</label>
      <button class="btn">Guardar dirección</button></form>`);
    $('#f-dir', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { await post(`/api/destinatarios/${destId}/direcciones`, datosForm(e.target)); m.cerrar(); toast('Dirección agregada', 'ok'); libreta(); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  };
  $$('[data-agregar]').forEach((b) => { b.onclick = () => formDireccion(b.dataset.agregar); });
  $$('[data-principal]').forEach((b) => { b.onclick = async () => { const [d, di] = b.dataset.principal.split(':'); await patch(`/api/destinatarios/${d}/direcciones/${di}`, { es_principal: true }).catch(errorToast); libreta(); }; });
  $$('[data-quitar]').forEach((b) => { b.onclick = async () => { const [d, di] = b.dataset.quitar.split(':'); await patch(`/api/destinatarios/${d}/direcciones/${di}`, { activa: false }).catch(errorToast); toast('Dirección quitada (se conserva en envíos anteriores)'); libreta(); }; });
  $('#nuevo-dest').onclick = () => {
    const m = modal(html`<h2>Nuevo destinatario</h2><form class="pila" id="f-dest" novalidate>
      <label class="campo">Nombre completo *<input name="nombre"></label>
      <label class="campo">Teléfono móvil *<input name="telefono" placeholder="+56 9 1234 5678"></label>
      <label class="campo">Correo<input name="correo" type="email"></label>
      <label class="campo">RUT<input name="rut"></label>
      <button class="btn">Guardar</button></form>`);
    $('#f-dest', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { const d = await post('/api/destinatarios', datosForm(e.target)); m.cerrar(); toast('Destinatario guardado. Ahora agrega su dirección.', 'ok'); await libreta(); formDireccion(d.id); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  };
}
