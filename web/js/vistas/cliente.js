import { app, ir } from '../app.js';
import { enviarForm, get, post, patch, api, urlApi } from '../api.js';
import {
  $, $$, badgePago, clp, comprimirFoto, datosForm, errorToast, esqueleto, html, icono, marcarErrores, modal, montar, mostrarBlob, toast, vacio,
} from '../ui.js';
import { comunasCobertura, direccionTexto, itemEnvio, mapaGoogle, opcionesComunas, textoPaquete, urlMapaGoogle } from './comun.js';
import { pagar, subirComprobante } from './envios.js';

// ================= Inicio del cliente =================
export async function inicio() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  // Las cifras vienen contadas por el servidor sobre TODOS los envíos (antes se contaban solo los últimos 100 de la lista).
  const [{ items }, r] = await Promise.all([get('/api/envios?limite=6'), get('/api/envios/resumen')]);
  const nombre = app.usuario.nombre.split(' ')[0];
  montar(vista, html`
    <section class="hero">
      <h1>Hola, ${nombre} 👋</h1>
      <p>Crea tu envío en menos de un minuto. Dentro de Santiago <b>${clp(app.conf.tarifas.base)}</b> hasta ${app.conf.tarifas.peso_estandar_kg} kg y ${app.conf.tarifas.dim_estandar_cm}×${app.conf.tarifas.dim_estandar_cm}×${app.conf.tarifas.dim_estandar_cm} cm, sin importar la cantidad de bultos.${app.conf.operacion.punto_courier ? ' También llevamos tus paquetes a puntos Blue Express, Starken y otros.' : ''}</p>
      <div class="fila" style="margin-top:16px">
        <a class="btn blanco grande" href="#/nuevo">${icono('nuevo')} Nuevo envío</a>
        <a class="btn sec grande" href="#/seguimiento">Seguir un folio</a>
      </div>
    </section>
    <div class="grid g4" style="margin-bottom:20px">
      <div class="kpi"><div class="etiqueta">En curso</div><div class="valor">${r.en_curso}</div><div class="nota">envíos activos</div></div>
      <div class="kpi"><div class="etiqueta">Por pagar</div><div class="valor">${r.por_pagar}</div><div class="nota">${clp(r.monto_por_pagar)}</div></div>
      <div class="kpi"><div class="etiqueta">Entregados</div><div class="valor">${r.entregados}</div><div class="nota">con foto y GPS</div></div>
      <div class="kpi destacado"><div class="etiqueta">Total</div><div class="valor">${r.total}</div><div class="nota">envíos registrados</div></div>
    </div>
    ${r.por_pagar ? html`<div class="aviso magenta fila entre" style="margin-bottom:16px"><span><b>Tienes ${r.por_pagar} envío(s) pendientes de pago (${clp(r.monto_por_pagar)}).</b> El repartidor solo puede retirar envíos pagados, y los que sigan sin pagar ${app.conf.operacion.horas_sin_pago || 24} horas después de creados se anulan solos.</span>
      <a class="btn chico" href="#/carrito">Pagar todos con una transferencia</a></div>` : ''}
    ${r.en_revision ? html`<div class="aviso" style="margin-bottom:16px"><b>${r.en_revision} comprobante(s) de transferencia en revisión.</b> El repartidor retira cuando administración apruebe el pago.</div>` : ''}
    <div class="card">
      <div class="card-titulo"><h2>Envíos recientes</h2><a class="btn sec chico" href="#/envios">Ver todos</a></div>
      <div class="lista-envios">${items.length ? items.map((e) => itemEnvio(e)) : vacio('Aún no tienes envíos.', html`<a class="btn" href="#/nuevo">Crear mi primer envío</a>`)}</div>
    </div>`);
}

// ================= Carrito: varios envíos se pagan con UNA transferencia y un solo comprobante =================
export async function carrito() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const [pendientes, enRevision] = await Promise.all([
    get('/api/envios?estado_pago=pendiente&estado=creado&limite=100'),
    get('/api/envios?estado_pago=en_revision&limite=100'),
  ]);
  const items = pendientes.items;
  const t = app.conf.transferencia || {};
  montar(vista, html`
    <div class="encabezado"><div><h1>Por pagar</h1><p>Marca los envíos que quieres pagar: haces <b>una sola transferencia</b> por el total y subes <b>un solo comprobante</b>. Los envíos sin pagar se anulan solos ${app.conf.operacion.horas_sin_pago || 24} horas después de creados.</p></div>
      <a class="btn sec" href="#/nuevo">${icono('nuevo')} Agregar otro envío</a></div>
    ${items.length ? html`
      <form class="card" id="f-carrito" novalidate>
        <div class="lista-envios">${items.map((e) => html`<label class="item-envio" style="cursor:pointer">
          <div><div class="folio">${e.folio}</div><div class="dir">${e.destinatario_nombre} · ${direccionTexto(e)}</div><div class="sub">${textoPaquete(e)}</div></div>
          <div class="der"><span class="monto">${clp(e.tarifa_total)}</span><input type="checkbox" name="envio" value="${e.id}" data-monto="${e.tarifa_total}" checked style="width:22px;min-height:22px"></div>
        </label>`)}</div>
        <div class="fila entre" style="margin:16px 0 8px"><span class="sub" id="cuenta-carrito"></span><div class="monto-grande" id="total-carrito"></div></div>
        ${t.banco && t.numero_cuenta ? html`<div class="desglose" style="margin-bottom:12px">
            <div><span>Banco</span><b>${t.banco}</b></div>
            ${t.tipo_cuenta ? html`<div><span>Tipo de cuenta</span><b>${t.tipo_cuenta}</b></div>` : ''}
            <div><span>N° de cuenta</span><b class="mono">${t.numero_cuenta}</b></div>
            ${t.titular ? html`<div><span>Titular</span><b>${t.titular}</b></div>` : ''}
            ${t.rut ? html`<div><span>RUT</span><b>${t.rut}</b></div>` : ''}
            ${t.correo ? html`<div><span>Correo</span><b>${t.correo}</b></div>` : ''}
          </div>` : html`<div class="aviso" style="margin-bottom:12px">Pide a la empresa los datos de la cuenta para transferir.</div>`}
        <label class="campo">Comprobante de la transferencia * <small>(imagen o PDF)</small><input type="file" name="archivo" accept="image/*,application/pdf"></label>
        <label class="campo" style="margin-top:10px">N° de operación <small>(opcional)</small><input name="referencia" maxlength="60" placeholder="Aparece en el comprobante"></label>
        <button class="btn grande ancho" id="pagar-carrito" style="margin-top:14px">Enviar comprobante</button>
        <p class="muted" style="margin-top:8px">Administración revisa el comprobante: al aprobarlo, todos los envíos marcados quedan pagados y listos para retirar.</p>
      </form>` : html`<div class="card">${vacio('No tienes envíos pendientes de pago.', html`<a class="btn" href="#/nuevo">Crear un envío</a>`)}</div>`}
    ${enRevision.items.length ? html`<div class="card"><h2>En revisión</h2><p class="sub">Ya enviaste el comprobante de estos envíos: administración lo está revisando.</p>
      <div class="lista-envios">${enRevision.items.map((e) => itemEnvio(e))}</div></div>` : ''}`);

  const f = $('#f-carrito');
  if (!f) return;
  const marcados = () => $$('input[name="envio"]:checked', f);
  const actualizar = () => {
    const sel = marcados();
    $('#total-carrito').textContent = clp(sel.reduce((s, x) => s + Number(x.dataset.monto), 0));
    $('#cuenta-carrito').textContent = `${sel.length} de ${items.length} envío(s) marcados · total a transferir`;
    $('#pagar-carrito').disabled = !sel.length;
  };
  f.addEventListener('change', actualizar);
  actualizar();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const sel = marcados();
    const archivo = f.archivo.files[0];
    if (!sel.length) return toast('Marca al menos un envío', 'error');
    if (!archivo) return marcarErrores(f, { archivo: 'Adjunta la imagen del comprobante' });
    const btn = $('#pagar-carrito');
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append('envio_ids', sel.map((x) => x.value).join(','));
      fd.append('archivo', archivo.type.startsWith('image/') ? await comprimirFoto(archivo, 2000, 0.85) : archivo);
      if (f.referencia.value.trim()) fd.append('referencia', f.referencia.value.trim());
      await enviarForm('/api/envios/comprobante-lote', fd);
      toast(`Comprobante enviado por ${sel.length} envío(s): queda pendiente de revisión`, 'ok');
      carrito();
    } catch (err) { marcarErrores(f, err.detalles); errorToast(err); btn.disabled = false; }
  };
}

// ================= Nuevo envío (asistente en 5 pasos) =================
// Pasos del asistente. Retiro (pedido 01-10): dónde el repartidor recoge el paquete.
const PASOS = ['Retiro', 'Destinatario', 'Destino', 'Paquete', 'Confirmar'];
const P = { retiro: 0, destinatario: 1, destino: 2, paquete: 3, resumen: 4 };

export async function nuevo() {
  const vista = $('#vista');
  montar(vista, esqueleto(2));
  const esAdmin = app.usuario.rol === 'admin';
  const [comunas, clientes] = await Promise.all([comunasCobertura(), esAdmin ? get('/api/usuarios?rol=cliente').then((l) => l.filter((c) => c.activo && !c.correo.startsWith('qa-'))) : []]);
  const w = {
    paso: 0, clienteId: esAdmin ? clientes[0]?.id : app.usuario.id, modoDest: 'libreta', destinatario: null, nuevoDest: {},
    tipo_destino: 'domicilio', direccionId: null, nuevaDir: {}, courier: {}, paquete: { bultos: 1 }, boleta: null, foto: null, cotizacion: null,
    retiro: {}, guardarRetiro: true,
  };
  let libreta = [];
  const cargarLibreta = async () => {
    libreta = w.clienteId ? await get(`/api/destinatarios${esAdmin ? `?cliente_id=${w.clienteId}` : ''}`) : [];
    if (!libreta.length) w.modoDest = 'nuevo';
  };
  // La dirección de retiro guardada del cliente (la última que usó) viene lista.
  const cargarRetiro = async () => {
    const r = w.clienteId ? await get(`/api/envios/retiro-guardado${esAdmin ? `?cliente_id=${w.clienteId}` : ''}`).catch(() => null) : null;
    w.retiro = r ? { calle: r.calle, numero: r.numero, depto: r.depto || '', referencia: r.referencia || '', comuna_id: r.comuna_id } : {};
  };
  await Promise.all([cargarLibreta(), cargarRetiro()]);
  const nombreComuna = (id) => comunas.find((x) => String(x.id) === String(id))?.nombre || '';

  const cuerpo = () => {
    if (w.paso === P.retiro) return pasoRetiro();
    if (w.paso === P.destinatario) return pasoDestinatario();
    if (w.paso === P.destino) return pasoDestino();
    if (w.paso === P.paquete) return pasoPaquete();
    return pasoResumen();
  };

  // Paso 1: dónde retiramos el paquete (dirección del remitente). Queda guardada para el próximo envío.
  function pasoRetiro() {
    const r = w.retiro;
    return html`
      ${esAdmin ? html`<label class="campo" style="margin-bottom:16px">Cliente dueño del envío
        <select name="cliente_id" id="sel-cliente">${clientes.map((c) => html`<option value="${c.id}" ${c.id === w.clienteId ? html`selected` : ''}>${c.nombre}</option>`)}</select></label>` : ''}
      <p class="sub" style="margin-bottom:12px">¿Dónde pasamos a <b>retirar</b> el paquete? El repartidor irá a esta dirección.</p>
      <div class="grid g2">
        <label class="campo">Calle *<input name="calle" value="${r.calle || ''}" autocomplete="address-line1" data-mapa="mapa-retiro"></label>
        <div class="grid g2"><label class="campo">Número *<input name="numero" value="${r.numero || ''}" inputmode="numeric" data-mapa="mapa-retiro"></label>
          <label class="campo">Depto / oficina<input name="depto" value="${r.depto || ''}"></label></div>
        <label class="campo">Comuna *<select name="comuna_id" data-mapa="mapa-retiro">${opcionesComunas(comunas, r.comuna_id)}</select></label>
        <label class="campo">Referencia<input name="referencia" value="${r.referencia || ''}" placeholder="Local 3, tocar timbre, horario de retiro…"></label>
      </div>
      <label class="interruptor" style="margin-top:10px"><input type="checkbox" name="guardar_retiro" ${w.guardarRetiro ? html`checked` : ''}> Recordar esta dirección para mis próximos envíos</label>
      ${mapaGoogle('mapa-retiro', urlMapaGoogle(r.calle, r.numero, nombreComuna(r.comuna_id)))}`;
  }

  function pasoDestinatario() {
    return html`
      <div class="segmentos" style="margin-bottom:16px">
        <button type="button" data-modo="libreta" class="${w.modoDest === 'libreta' ? 'activo' : ''}" ${libreta.length ? '' : html`disabled`}>De mi libreta (${libreta.length})</button>
        <button type="button" data-modo="nuevo" class="${w.modoDest === 'nuevo' ? 'activo' : ''}">Nuevo destinatario</button>
      </div>
      ${w.modoDest === 'libreta' ? html`
        <input type="search" id="buscar-dest" placeholder="Buscar por nombre o teléfono…" style="margin-bottom:12px">
        <div class="lista-envios" id="lista-dest">${libreta.map((d) => html`
          <label class="item-envio" data-nombre="${(d.nombre + ' ' + d.telefono).toLowerCase()}" style="cursor:pointer">
            <div><div class="titulo-item">${d.nombre}</div><div class="dir"><span class="nowrap">${d.telefono}</span> · ${d.direcciones.length === 1 ? '1 dirección' : `${d.direcciones.length} direcciones`}</div></div>
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
    // Envío a puntos de otras compañías: en pausa mientras administración no lo active.
    if (!app.conf.operacion.punto_courier) w.tipo_destino = 'domicilio';
    return html`
      ${app.conf.operacion.punto_courier ? html`<div class="segmentos" style="margin-bottom:16px">
        <button type="button" data-tipo="domicilio" class="${w.tipo_destino === 'domicilio' ? 'activo' : ''}">A domicilio</button>
        <button type="button" data-tipo="punto_courier" class="${w.tipo_destino === 'punto_courier' ? 'activo' : ''}">Punto Blue / Starken / otro</button>
      </div>` : ''}
      ${w.tipo_destino === 'punto_courier' ? html`
        <div class="aviso" style="margin-bottom:14px">Llevamos tus paquetes al punto de la empresa que elijas, <b>sin importar la cantidad de bultos</b>, desde ${clp(app.conf.tarifas.base)}.</div>
        <div class="grid g3" style="margin-bottom:16px">
          <label class="campo">Empresa *<select name="courier_empresa">${app.conf.couriers.map((c) => html`<option ${w.courier.courier_empresa === c ? html`selected` : ''}>${c}</option>`)}</select></label>
          <label class="campo">Punto / sucursal *<input name="courier_punto" value="${w.courier.courier_punto || ''}" placeholder="Ej. Sucursal Providencia"></label>
          <label class="campo">Código de envío <small>(opcional)</small><input name="courier_codigo" value="${w.courier.courier_codigo || ''}"></label>
        </div>
        <h3>Dirección del punto</h3>` : ''}
      ${dirs.length ? html`<div class="lista-envios" style="margin-bottom:14px">
        ${dirs.map((d) => html`<label class="item-envio" style="cursor:pointer"><div><div class="titulo-item">${d.alias || 'Dirección'} ${d.es_principal ? html`<span class="badge e-creado">Principal</span>` : ''}</div>
          <div class="dir">${d.calle} ${d.numero}${d.depto ? ', ' + d.depto : ''} · ${d.comuna_nombre}</div></div>
          <input type="radio" name="dir" value="${d.id}" ${String(w.direccionId) === String(d.id) ? html`checked` : ''} style="width:22px;min-height:22px"></label>`)}
        <label class="item-envio" style="cursor:pointer"><div><div class="titulo-item">+ Nueva dirección</div><div class="dir">¿Se cambió de casa? Agrega la nueva dirección</div></div>
          <input type="radio" name="dir" value="nueva" ${w.direccionId === 'nueva' ? html`checked` : ''} style="width:22px;min-height:22px"></label></div>` : ''}
      ${nueva ? html`<div class="grid g2">
        <label class="campo">Calle *<input name="calle" value="${w.nuevaDir.calle || ''}" autocomplete="address-line1" data-mapa="mapa-destino"></label>
        <div class="grid g2"><label class="campo">Número *<input name="numero" value="${w.nuevaDir.numero || ''}" inputmode="numeric" data-mapa="mapa-destino"></label>
          <label class="campo">Depto / casa<input name="depto" value="${w.nuevaDir.depto || ''}"></label></div>
        <label class="campo">Comuna *<select name="comuna_id" data-mapa="mapa-destino">${opcionesComunas(comunas, w.nuevaDir.comuna_id)}</select><small>Solo comunas dentro de la cobertura</small></label>
        <label class="campo">Nombre de la dirección <small>(opcional)</small><input name="alias" value="${w.nuevaDir.alias || ''}" placeholder="Casa, oficina…"></label>
        <label class="campo" style="grid-column:1/-1">Referencia<input name="referencia" value="${w.nuevaDir.referencia || ''}" placeholder="Portón verde, conserje recibe hasta las 20:00"></label>
      </div>${mapaGoogle('mapa-destino', urlMapaGoogle(w.nuevaDir.calle, w.nuevaDir.numero, nombreComuna(w.nuevaDir.comuna_id)))}`
      : (() => { const d = dirs.find((x) => String(x.id) === String(w.direccionId)); return d ? mapaGoogle('mapa-destino', urlMapaGoogle(d.calle, d.numero, d.comuna_nombre)) : ''; })()}`;
  }

  function pasoPaquete() {
    const p = w.paquete;
    const t = app.conf.tarifas;
    return html`
      <h3 style="margin-top:0">¿De qué tamaño es cada bulto? *</h3>
      <div class="grid g2" id="grupo-tamano" style="margin-bottom:8px">
        <label class="item-envio" style="cursor:pointer;align-items:flex-start"><div>
          <div class="titulo-item">Estándar · <span class="nowrap">${clp(t.base)}</span></div>
          <div class="dir">Más pequeño que ${t.dim_estandar_cm}×${t.dim_estandar_cm}×${t.dim_estandar_cm} cm y hasta ${t.peso_estandar_kg} kg</div></div>
          <input type="radio" name="tamano" value="estandar" ${p.tamano === 'estandar' ? html`checked` : ''} style="width:22px;min-height:22px"></label>
        <label class="item-envio" style="cursor:pointer;align-items:flex-start"><div>
          <div class="titulo-item">Sobredimensionado · <span class="nowrap">${clp(t.base + t.recargo_sobredimension)}</span></div>
          <div class="dir">Más grande que el estándar, hasta ${t.dim_max_cm}×${t.dim_max_cm}×${t.dim_max_cm} cm y ${t.peso_max_kg} kg</div></div>
          <input type="radio" name="tamano" value="sobredimensionado" ${p.tamano === 'sobredimensionado' ? html`checked` : ''} style="width:22px;min-height:22px"></label>
      </div>
      <p class="muted" style="margin-bottom:16px">Paquetes de más de ${t.dim_max_cm}×${t.dim_max_cm}×${t.dim_max_cm} cm o ${t.peso_max_kg} kg no se reciben.</p>
      <div class="grid g2">
        <label class="campo">Bultos *<input name="bultos" type="number" step="1" inputmode="numeric" min="1" max="100" value="${p.bultos || 1}">
          <small>La cantidad de bultos no cambia el precio</small></label>
        <label class="campo">¿Qué envías? <small>(opcional)</small><input name="descripcion_producto" value="${p.descripcion_producto || ''}" placeholder="Ej. Zapatillas, documentos"></label>
      </div>
      <div class="card" style="box-shadow:none;background:rgba(224,33,138,.08);border-color:rgba(224,33,138,.35);margin-top:16px">
        <h3>Seguro del envío</h3>
        <div class="grid g2">
          <label class="campo">Valor declarado (CLP)<input name="valor_declarado" type="number" min="0" step="1" value="${p.valor_declarado || ''}" placeholder="0"><small>Tope de la indemnización en caso de pérdida o daño</small></label>
          <label class="campo">Boleta de compra <small>(obligatoria para cobrar el seguro)</small><input type="file" name="boleta" accept="application/pdf,image/*">
            <small>${w.boleta ? `Adjunta: ${w.boleta.name}` : 'PDF o foto. Puedes adjuntarla ahora o al reclamar.'}</small></label>
        </div>
      </div>
      <div class="card" style="box-shadow:none">
        <label class="interruptor"><input type="checkbox" name="horario_especial" ${p.horario_especial ? html`checked` : ''}><span>Envío especial por horario <span class="badge e-en_ruta">+${clp(t.recargo_horario_especial)}</span></span></label>
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
        <div><div class="muted">Destinatario</div><b>${d?.nombre}</b> · <span class="nowrap">${d?.telefono}</span>${d?.rut ? html` · RUT <span class="nowrap">${d.rut}</span>` : ''}</div>
        <div><div class="muted">${w.tipo_destino === 'punto_courier' ? `Punto ${w.courier.courier_empresa}` : 'Dirección'}</div>
          ${w.tipo_destino === 'punto_courier' ? html`<b>${w.courier.courier_punto}</b><br>` : ''}${dir.calle} ${dir.numero}${dir.depto ? ', ' + dir.depto : ''} · <b>${dir.comuna_nombre}</b></div>
        <div><div class="muted">Retiro</div>${w.retiro.calle} ${w.retiro.numero}${w.retiro.depto ? ', ' + w.retiro.depto : ''} · <b>${nombreComuna(w.retiro.comuna_id)}</b></div>
        <div><div class="muted">Paquete</div>${p.descripcion_producto ? `${p.descripcion_producto} · ` : ''}${textoPaquete({ ...p, bultos: p.bultos || 1 })}</div>
        <div><div class="muted">Seguro</div>${Number(p.valor_declarado) > 0 ? html`Valor declarado ${clp(p.valor_declarado)} · ${w.boleta ? html`boleta adjunta ✔` : html`<span style="color:var(--alerta)">sin boleta (la necesitarás para cobrar el seguro)</span>`}` : 'Sin valor declarado'}</div>
        ${p.horario_especial ? html`<div><div class="muted">Horario especial</div>${p.franja_horaria}</div>` : ''}
      </div>
      <div class="card" style="box-shadow:none">
        <h3>Tarifa</h3>
        <div class="desglose">
          <div><span>Tarifa base</span><span>${clp(c.tarifa_base)}</span></div>
          ${c.recargo_bultos ? html`<div><span>Bultos adicionales</span><span>${clp(c.recargo_bultos)}</span></div>` : ''}
          ${c.recargo_sobredimension ? html`<div><span>Sobredimensionado</span><span>${clp(c.recargo_sobredimension)}</span></div>` : ''}
          ${c.recargo_horario ? html`<div><span>Horario especial</span><span>${clp(c.recargo_horario)}</span></div>` : ''}
          <div class="total"><span>Total</span><span>${clp(c.tarifa_total)}</span></div>
        </div>
        <p class="muted" style="margin-top:10px">${app.conf.pagos.en_linea ? 'El pago (en línea o por transferencia) se realiza antes del retiro.' : 'Se paga por transferencia antes del retiro: subes el comprobante y administración lo aprueba.'}</p>
      </div></div>`;
  }

  let pasoPintado = null;
  const pintar = () => {
    montar(vista, html`
      <div class="encabezado"><div><h1>Nuevo envío</h1><p>Paso ${w.paso + 1} de ${PASOS.length} · ${PASOS[w.paso]}</p></div></div>
      <div class="pasos">${PASOS.map((p, i) => html`<div class="paso ${i < w.paso ? 'hecho' : i === w.paso ? 'actual' : ''}">${p}</div>`)}</div>
      <form class="card" id="form-envio" novalidate>
        ${cuerpo()}
        <div class="fila entre acciones-fijas" style="margin-top:22px">
          <button type="button" class="btn sec" id="atras" ${w.paso === 0 ? html`disabled` : ''}>Atrás</button>
          <div class="fila">${w.cotizacion && w.paso === P.paquete ? html`<span class="sub">Tarifa: <b>${clp(w.cotizacion.tarifa_total)}</b></span>` : ''}
          <button type="submit" class="btn grande" id="siguiente">${w.paso === P.resumen ? 'Confirmar envío' : 'Continuar'}</button></div>
        </div>
      </form>`);
    // Al avanzar o retroceder de paso la pantalla vuelve arriba (antes quedaba a media altura del paso anterior).
    if (pasoPintado !== w.paso) window.scrollTo(0, 0);
    pasoPintado = w.paso;
    enlazar();
  };

  const form = () => $('#form-envio');

  function guardarPaso() {
    const d = datosForm(form());
    if (w.paso === P.retiro) {
      if (esAdmin && d.cliente_id) w.clienteId = Number(d.cliente_id);
      w.retiro = { calle: d.calle, numero: d.numero, depto: d.depto, referencia: d.referencia, comuna_id: d.comuna_id };
      w.guardarRetiro = Boolean(d.guardar_retiro);
    } else if (w.paso === P.destinatario) {
      if (w.modoDest === 'nuevo') w.nuevoDest = { nombre: d.nombre, telefono: d.telefono, correo: d.correo, rut: d.rut };
      else {
        const elegido = libreta.find((x) => String(x.id) === d.dest) || null;
        // Al cambiar de destinatario, la dirección elegida antes ya no le pertenece: se preselecciona la principal.
        if (elegido?.id !== w.destinatario?.id) w.direccionId = elegido?.direcciones[0]?.id ?? null;
        w.destinatario = elegido;
      }
    } else if (w.paso === P.destino) {
      if (d.dir) w.direccionId = d.dir === 'nueva' ? 'nueva' : Number(d.dir);
      if ('calle' in d) w.nuevaDir = { calle: d.calle, numero: d.numero, depto: d.depto, comuna_id: d.comuna_id, alias: d.alias, referencia: d.referencia };
      if (w.tipo_destino === 'punto_courier') w.courier = { courier_empresa: d.courier_empresa, courier_punto: d.courier_punto, courier_codigo: d.courier_codigo };
    } else if (w.paso === P.paquete) {
      w.paquete = { ...w.paquete, ...d };
    }
  }

  function payload() {
    const b = { tipo_destino: w.tipo_destino, ...(w.tipo_destino === 'punto_courier' ? w.courier : {}), ...w.paquete, cliente_id: w.clienteId };
    b.horario_especial = Boolean(w.paquete.horario_especial);
    b.retiro = w.retiro;
    b.guardar_retiro = w.guardarRetiro;
    if (w.modoDest === 'libreta' && w.destinatario) b.destinatario_id = w.destinatario.id;
    else b.destinatario = w.nuevoDest;
    const usaNueva = !(w.modoDest === 'libreta' && w.destinatario?.direcciones.length) || w.direccionId === 'nueva';
    if (usaNueva) b.direccion = w.nuevaDir;
    else b.direccion_id = w.direccionId;
    return b;
  }

  function validarLocal() {
    const e = {};
    if (w.paso === P.retiro) {
      if (!w.retiro.calle?.trim()) e.calle = 'Obligatorio';
      if (!String(w.retiro.numero || '').trim()) e.numero = 'Obligatorio';
      if (!w.retiro.comuna_id) e.comuna_id = 'Selecciona la comuna';
    }
    if (w.paso === P.destinatario) {
      if (w.modoDest === 'libreta' && !w.destinatario) { toast('Selecciona un destinatario de tu libreta', 'error'); return false; }
      if (w.modoDest === 'nuevo') {
        if (!w.nuevoDest.nombre?.trim()) e.nombre = 'Nombre obligatorio';
        if (!/^(\+?56)?\s*9?\s*\d{4}\s*\d{4}$/.test((w.nuevoDest.telefono || '').replace(/\s+/g, ' ').trim())) e.telefono = 'Formato +56 9 XXXX XXXX';
      }
    }
    if (w.paso === P.destino) {
      const usaNueva = !(w.modoDest === 'libreta' && w.destinatario?.direcciones.length) || w.direccionId === 'nueva';
      if (!usaNueva && !w.direccionId) { toast('Elige una dirección', 'error'); return false; }
      if (usaNueva) {
        if (!w.nuevaDir.calle?.trim()) e.calle = 'Obligatorio';
        if (!w.nuevaDir.numero?.trim()) e.numero = 'Obligatorio';
        if (!w.nuevaDir.comuna_id) e.comuna_id = 'Selecciona la comuna';
      }
      if (w.tipo_destino === 'punto_courier' && !w.courier.courier_punto?.trim()) e.courier_punto = 'Indica el punto';
    }
    if (w.paso === P.paquete && !w.paquete.tamano) {
      const grupo = $('#grupo-tamano', form());
      grupo.classList.add('grupo-error');
      grupo.scrollIntoView({ block: 'center', behavior: 'smooth' });
      grupo.addEventListener('change', () => grupo.classList.remove('grupo-error'), { once: true });
      toast('Marca si tu paquete es estándar o sobredimensionado', 'error');
      return false;
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
    $('#sel-cliente', f)?.addEventListener('change', async (ev) => { w.clienteId = Number(ev.target.value); w.destinatario = null; w.modoDest = 'libreta'; await Promise.all([cargarLibreta(), cargarRetiro()]); pintar(); });
    // El mapa de Google se actualiza solo mientras se escribe la dirección (para corroborarla).
    $$('[data-mapa]', f).forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        clearTimeout(w.tm);
        w.tm = setTimeout(() => {
          const mapa = $(`#${el.dataset.mapa}`);
          if (!mapa) return;
          const url = urlMapaGoogle(f.calle?.value, f.numero?.value, nombreComuna(f.comuna_id?.value));
          if (url && mapa.src !== url) { mapa.src = url; mapa.closest('.mapa-dir').hidden = false; }
        }, 800);
      });
    });
    $('#buscar-dest', f)?.addEventListener('input', (ev) => {
      const q = ev.target.value.toLowerCase();
      $$('#lista-dest [data-nombre]', f).forEach((el) => { el.style.display = el.dataset.nombre.includes(q) ? '' : 'none'; });
    });
    $$('input[name="dir"]', f).forEach((r) => { r.onchange = () => { guardarPaso(); pintar(); }; });
    $('input[name="horario_especial"]', f)?.addEventListener('change', () => { guardarPaso(); pintar(); cotizarAhora().then(pintarTarifa).catch(() => {}); });
    $('input[name="boleta"]', f)?.addEventListener('change', (ev) => { w.boleta = ev.target.files[0] || null; });
    $('input[name="foto"]', f)?.addEventListener('change', (ev) => { w.foto = ev.target.files[0] || null; });
    if (w.paso === P.paquete) {
      // Si el formulario ya no está en pantalla (se confirmó o se cambió de paso antes de los 400 ms), no se hace nada.
      f.addEventListener('input', () => { clearTimeout(w.t); w.t = setTimeout(() => { if (form() !== f) return; guardarPaso(); cotizarAhora().then(pintarTarifa).catch(() => {}); }, 400); });
    }
    $('#atras', f).onclick = () => { clearTimeout(w.t); guardarPaso(); w.paso -= 1; pintar(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      clearTimeout(w.t);
      guardarPaso();
      if (!validarLocal()) return;
      const btn = $('#siguiente', f);
      btn.disabled = true;
      try {
        if (w.paso === P.paquete) {
          const c = await cotizarAhora();
          if (Object.keys(c.errores).length) { marcarErrores(f, c.errores); toast(Object.values(c.errores)[0], 'error'); return; }
        }
        if (w.paso < P.resumen) { w.paso += 1; pintar(); return; }
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
    w.paso = k.startsWith('retiro') ? P.retiro : k.startsWith('destinatario') ? P.destinatario : /^(direccion|tipo_destino|courier|comuna)/.test(k) ? P.destino : P.paquete;
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
      <section class="hero"><p>Envío confirmado</p><h1 class="mono folio-grande">${envio.folio}</h1>
        <p>${envio.destinatario_nombre} · ${direccionTexto(envio)}</p></section>
      <div class="grid g2">
        <div class="card pila">
          <div class="fila entre"><h2 style="margin:0">Total ${clp(envio.tarifa_total)}</h2>${badgePago(envio.estado_pago)}</div>
          <div class="aviso magenta">Imprime la etiqueta y pégala en el paquete. Paga ahora: con el pago aprobado el repartidor puede retirar tu envío. <b>Si no pagas en ${app.conf.operacion.horas_sin_pago || 24} horas, el envío se anula solo.</b></div>
          ${app.conf.pagos.en_linea ? html`<button class="btn grande ancho" id="pagar">Pagar ${clp(envio.tarifa_total)}</button>` : ''}
          <button class="btn ${app.conf.pagos.en_linea ? 'sec' : 'grande'} ancho" id="transferir">Pagar ${clp(envio.tarifa_total)} con transferencia (subir comprobante)</button>
          ${envio.ticket_url ? html`<div class="grid g2"><a class="btn sec" id="t80" href="${urlApi()}${envio.ticket_url}&formato=80mm" target="_blank" rel="noopener">Etiqueta 80 mm (PDF)</a>
            <a class="btn sec" id="ta4" href="${urlApi()}${envio.ticket_url}&formato=a4" target="_blank" rel="noopener">Etiqueta A4 (PDF)</a></div>` : ''}
          <a class="btn sec ancho" href="#/carrito">Pagar varios envíos juntos (carrito)</a>
          <a class="btn sec ancho" href="${wa}" target="_blank" rel="noopener">Compartir por WhatsApp</a>
          <div class="grid g2"><a class="btn azul" href="#/envio/${envio.id}">Ver detalle</a><a class="btn sec" href="#/nuevo" id="otro">Crear otro envío</a></div>
        </div>
        <div class="card" style="text-align:center"><div class="qr-caja"><img id="qr" alt="Código QR del envío ${envio.folio}"></div>
          <p class="sub" style="margin-top:10px">Al escanearlo se abre la ruta en Google Maps o Waze.</p></div>
      </div>`);
    api(`/api/envios/${envio.id}/qr.png`, { blob: true }).then((b) => mostrarBlob($('#qr'), b)).catch(() => {});
    $('#pagar')?.addEventListener('click', () => pagar(envio, () => ir(`#/envio/${envio.id}`)));
    $('#transferir').onclick = () => subirComprobante(envio, () => ir(`#/envio/${envio.id}`));
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
  // El aviso de éxito solo se muestra si el cambio se guardó (antes decía "Dirección quitada" aunque fallara).
  const cambiarDireccion = async (clave, cambio, ok) => {
    const [d, di] = clave.split(':');
    try { await patch(`/api/destinatarios/${d}/direcciones/${di}`, cambio); if (ok) toast(ok, 'ok'); } catch (err) { errorToast(err); }
    libreta();
  };
  $$('[data-principal]').forEach((b) => { b.onclick = () => cambiarDireccion(b.dataset.principal, { es_principal: true }); });
  $$('[data-quitar]').forEach((b) => { b.onclick = () => cambiarDireccion(b.dataset.quitar, { activa: false }, 'Dirección quitada (se conserva en envíos anteriores)'); });
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
