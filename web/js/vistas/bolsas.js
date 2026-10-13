import { actualizarContadores, app } from '../app.js';
import { api, enviarForm, get, patch, post } from '../api.js';
import {
  $, $$, abrirBlob, badge, botonCopiar, clp, comprimirFoto, confirmar, datosForm, errorToast, esqueleto, fechaHora, html, icono, marcarErrores, modal, montar, toast, vacio,
} from '../ui.js';
import { comunasCobertura, opcionesComunas } from './comun.js';

// Bolsas de envío (pedido del cliente 11-10): el cliente las pide por color y medida (paquetes de 100), paga por
// transferencia con comprobante y administración aprueba el pago y las entrega. Los precios se editan en "Precios".
const ESTADO_TXT = { pendiente: 'Pendiente de pago', en_revision: 'Comprobante en revisión', pagado: 'Pagado: por entregar', entregado: 'Entregado', anulado: 'Anulado' };
const CLASE = { pendiente: 'solicitado', en_revision: 'en_revision', pagado: 'pagado', entregado: 'entregado', anulado: 'anulado' };
const badgePedido = (estado) => badge(CLASE[estado], ESTADO_TXT[estado]);
const porBolsa = (p) => Math.round(p.precio / Math.max(p.unidades, 1));
const digitos = (v) => String(v || '').replace(/\D/g, '');

// Agrupa el catálogo por color (cada color tiene sus propios precios).
const porColor = (catalogo) => [...new Set(catalogo.map((p) => p.color))].map((color) => [color, catalogo.filter((p) => p.color === color)]);

const lineasPedido = (p) => html`<div class="desglose">${p.items.map((i) => html`
  <div><span>${i.cantidad} × ${i.color} ${i.medida} cm <span class="muted">(${i.unidades} u.)</span></span><span>${clp(i.subtotal)}</span></div>`)}
  <div class="total"><span>Total</span><span>${clp(p.total)}</span></div></div>`;

// ================= Cliente: catálogo, pedido y mis pedidos =================
export async function cliente() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const [catalogo, pedidos, comunas, retiro] = await Promise.all([
    get('/api/bolsas/catalogo'), get('/api/bolsas/pedidos'), comunasCobertura(), get('/api/envios/retiro-guardado').catch(() => null),
  ]);
  const t = app.conf.transferencia || {};
  // La dirección de retiro guardada sirve de dirección de entrega (ahí mismo se las llevamos).
  const direccion = retiro?.calle ? `${retiro.calle} ${retiro.numero}${retiro.depto ? `, ${retiro.depto}` : ''}` : '';
  montar(vista, html`
    <div class="encabezado"><div><h1>Bolsas de envío</h1><p>Pide bolsas para despachar tus productos. Se venden por paquete: pagas por transferencia y te las llevamos.</p></div></div>
    ${catalogo.length ? html`<form class="card" id="f-bolsas" novalidate>
      ${porColor(catalogo).map(([color, productos]) => html`
        <h2 style="margin-top:0">Bolsas ${color.toLowerCase()}</h2>
        <div class="tabla-wrap" tabindex="0" role="region" aria-label="Bolsas ${color}"><table class="tabla-bolsas">
          <thead><tr><th>Medida</th><th class="num">Precio</th><th class="num">Paquetes</th></tr></thead>
          <tbody>${productos.map((p) => html`<tr>
            <td><b class="nowrap">${p.medida} cm</b><div class="muted">${p.unidades} bolsas · ${clp(porBolsa(p))} c/u</div></td>
            <td class="num"><b>${clp(p.precio)}</b></td>
            <td class="num"><input type="number" name="b-${p.id}" data-bolsa="${p.id}" data-precio="${p.precio}" min="0" max="100" step="1" inputmode="numeric" value="" placeholder="0" aria-label="Paquetes de ${p.medida}" class="cantidad-bolsa"></td>
          </tr>`)}</tbody></table></div>`)}
      <div class="fila entre" style="margin:16px 0"><span class="sub" id="resumen-bolsas">Elige cuántos paquetes quieres de cada medida</span><div class="monto-grande" id="total-bolsas">${clp(0)}</div></div>
      <h3>¿Dónde te las llevamos?</h3>
      <div class="grid g2">
        <label class="campo">Dirección *<input name="entrega_direccion" maxlength="200" value="${direccion}" placeholder="Calle, número y depto" autocomplete="street-address"></label>
        <label class="campo">Comuna *<select name="entrega_comuna_id">${opcionesComunas(comunas, retiro?.comuna_id)}</select></label>
        <label class="campo" style="grid-column:1/-1">Observaciones <small>(opcional)</small><input name="observaciones" maxlength="300" placeholder="Horario, a quién entregar…"></label>
      </div>
      <button class="btn grande ancho" id="pedir-bolsas" style="margin-top:14px" disabled>Solicitar bolsas</button>
      <p class="muted" style="margin-top:8px">Después de solicitar, transfiere el total y sube el comprobante aquí mismo. Con el pago aprobado coordinamos la entrega.</p>
    </form>` : html`<div class="card">${vacio('Por ahora no hay bolsas disponibles.')}</div>`}
    <div class="card">
      <h2>Mis pedidos de bolsas</h2>
      <div class="pila">${pedidos.length ? pedidos.map((p) => tarjetaPedidoCliente(p, t)) : vacio('Aún no has pedido bolsas.')}</div>
    </div>`);

  const f = $('#f-bolsas');
  if (f) {
    const cantidades = () => $$('[data-bolsa]', f).map((i) => ({ bolsa_id: Number(i.dataset.bolsa), cantidad: Math.trunc(Number(i.value) || 0), precio: Number(i.dataset.precio) }))
      .filter((x) => x.cantidad > 0);
    const actualizar = () => {
      const sel = cantidades();
      const paquetes = sel.reduce((s, x) => s + x.cantidad, 0);
      $('#total-bolsas').textContent = clp(sel.reduce((s, x) => s + x.cantidad * x.precio, 0));
      $('#resumen-bolsas').textContent = paquetes ? `${paquetes} paquete(s) de ${sel.length} medida(s)` : 'Elige cuántos paquetes quieres de cada medida';
      $('#pedir-bolsas').disabled = !paquetes;
    };
    f.addEventListener('input', actualizar);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = datosForm(f);
      const items = cantidades().map(({ bolsa_id, cantidad }) => ({ bolsa_id, cantidad }));
      const errores = {};
      if (d.entrega_direccion.trim().length < 5) errores.entrega_direccion = 'Escribe la dirección de entrega';
      if (!d.entrega_comuna_id) errores.entrega_comuna_id = 'Elige la comuna';
      if (marcarErrores(f, errores)) return;
      if (!items.length) return toast('Elige al menos un paquete', 'error');
      const btn = $('#pedir-bolsas');
      btn.disabled = true;
      try {
        const p = await post('/api/bolsas/pedidos', { items, entrega_direccion: d.entrega_direccion, entrega_comuna_id: Number(d.entrega_comuna_id), observaciones: d.observaciones });
        toast(`Pedido ${p.folio} creado: transfiere ${clp(p.total)} y sube el comprobante`, 'ok');
        await cliente();
        $(`[data-pedido="${p.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (err) { marcarErrores(f, err.detalles); errorToast(err); btn.disabled = false; }
    };
  }
  $$('[data-comprobante-bolsas]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const archivo = form.archivo.files[0];
      if (!archivo) return marcarErrores(form, { archivo: 'Adjunta la imagen del comprobante' });
      const btn = $('button', form);
      btn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('archivo', archivo.type.startsWith('image/') ? await comprimirFoto(archivo, 2000, 0.85) : archivo);
        if (form.referencia.value.trim()) fd.append('referencia', form.referencia.value.trim());
        await enviarForm(`/api/bolsas/pedidos/${form.dataset.comprobanteBolsas}/comprobante`, fd);
        toast('Comprobante enviado: queda pendiente de aprobación', 'ok');
        cliente();
      } catch (err) { marcarErrores(form, err.detalles); errorToast(err); btn.disabled = false; }
    };
  });
  $$('[data-anular-bolsas]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmar('Anular pedido', '¿Seguro que quieres anular este pedido de bolsas?', 'Anular'))) return;
      try { await post(`/api/bolsas/pedidos/${b.dataset.anularBolsas}/anular`); toast('Pedido anulado', 'ok'); cliente(); } catch (err) { errorToast(err); }
    };
  });
  $$('[data-ver-comprobante]').forEach((b) => { b.onclick = () => verComprobante(b.dataset.verComprobante); });
  // La actualización automática no borra cantidades ni un comprobante a medio subir.
  app.refrescar = async () => {
    const editando = $$('#f-bolsas [data-bolsa]').some((i) => i.value) || $$('[data-comprobante-bolsas] input[type=file]').some((i) => i.files.length);
    if (!editando) await cliente();
  };
}

function tarjetaPedidoCliente(p, t) {
  return html`<div class="card" style="margin:0;box-shadow:none" data-pedido="${p.id}">
    <div class="card-titulo"><div><b class="mono">${p.folio}</b><div class="sub">${fechaHora(p.creado_en)} · entrega en ${p.entrega_direccion}, ${p.entrega_comuna}</div></div>${badgePedido(p.estado)}</div>
    ${lineasPedido(p)}
    ${p.estado === 'pendiente' ? html`
      ${p.motivo_rechazo ? html`<div class="aviso alerta" style="margin-top:12px"><b>No se aprobó tu comprobante:</b> ${p.motivo_rechazo}. Sube uno nuevo.</div>` : ''}
      <div class="fila" style="margin:12px 0 8px"><span class="sub">Transfiere</span><div class="monto-grande">${clp(p.total)}</div>${botonCopiar(p.total, 'monto')}</div>
      ${t.banco && t.numero_cuenta ? html`<div class="desglose" style="margin-bottom:8px">
          <div><span>Banco</span><b>${t.banco}</b></div>
          ${t.tipo_cuenta ? html`<div><span>Tipo de cuenta</span><b>${t.tipo_cuenta}</b></div>` : ''}
          <div><span>N° de cuenta</span><b class="mono">${t.numero_cuenta} ${botonCopiar(t.numero_cuenta, 'número de cuenta')}</b></div>
          ${t.titular ? html`<div><span>Titular</span><b>${t.titular}</b></div>` : ''}
          ${t.rut ? html`<div><span>RUT</span><b>${t.rut} ${botonCopiar(t.rut, 'RUT')}</b></div>` : ''}
          ${t.correo ? html`<div><span>Correo</span><b>${t.correo} ${botonCopiar(t.correo, 'correo')}</b></div>` : ''}
        </div><p class="muted">Escribe el folio <b class="mono">${p.folio}</b> en el comentario de la transferencia.</p>`
        : html`<div class="aviso">Pide a la empresa los datos de la cuenta para transferir.</div>`}
      <form class="pila" data-comprobante-bolsas="${p.id}" novalidate style="margin-top:10px">
        <label class="campo">Comprobante de la transferencia * <small>(imagen o PDF)</small><input type="file" name="archivo" accept="image/*,application/pdf"></label>
        <label class="campo">N° de operación <small>(opcional)</small><input name="referencia" maxlength="60" placeholder="Aparece en el comprobante"></label>
        <div class="fila"><button class="btn">Enviar comprobante</button><button type="button" class="btn sec" data-anular-bolsas="${p.id}">Anular pedido</button></div>
      </form>` : ''}
    ${p.estado === 'en_revision' ? html`<p class="sub" style="margin-top:10px">Recibimos tu comprobante${p.comprobante_referencia ? ` (operación ${p.comprobante_referencia})` : ''}: administración lo está revisando.</p>` : ''}
    ${p.estado === 'pagado' ? html`<p class="sub" style="margin-top:10px">Pago aprobado ✔ Te las llevamos a la dirección indicada.</p>` : ''}
    ${p.estado === 'entregado' ? html`<p class="sub" style="margin-top:10px">Entregado el ${fechaHora(p.entregado_en)}.</p>` : ''}
    ${p.estado === 'anulado' && p.motivo_anulacion ? html`<p class="sub" style="margin-top:10px">${p.motivo_anulacion}.</p>` : ''}
    ${p.tiene_comprobante && p.estado !== 'pendiente' ? html`<button type="button" class="btn sec chico" style="margin-top:8px" data-ver-comprobante="${p.id}">Ver comprobante</button>` : ''}
  </div>`;
}

const verComprobante = (id) => abrirBlob(api(`/api/bolsas/pedidos/${id}/comprobante`, { blob: true })).catch(errorToast);

// ================= Administración: pedidos y precios =================
const FILTROS = [['abiertos', 'Por atender'], ['en_revision', 'Comprobantes'], ['pagado', 'Por entregar'], ['pendiente', 'Sin pagar'], ['entregado', 'Entregados'], ['anulado', 'Anulados'], ['', 'Todos']];

export async function admin(seccion = 'pedidos', filtro = 'abiertos') {
  const vista = $('#vista');
  if (!$('#bolsas-admin')) montar(vista, esqueleto(3));
  const encabezado = html`<div class="encabezado" id="bolsas-admin"><div><h1>Bolsas</h1><p>Pedidos de bolsas de los clientes y los precios que ven al pedir.</p></div></div>
    ${app.conf.operacion?.bolsas ? '' : html`<div class="aviso magenta" style="margin-bottom:16px"><b>Sección en pausa:</b> los clientes aún no la ven. Deja listos los precios y actívala en <a href="#/tarifas">Tarifas y reglas</a> cuando quieras ofrecer bolsas.</div>`}
    <div class="segmentos" style="margin-bottom:16px"><button type="button" data-seccion="pedidos" class="${seccion === 'pedidos' ? 'activo' : ''}">Pedidos</button>
      <button type="button" data-seccion="precios" class="${seccion === 'precios' ? 'activo' : ''}">Precios y medidas</button></div>`;
  if (seccion === 'precios') await precios(vista, encabezado);
  else await pedidosAdmin(vista, encabezado, filtro);
  $$('[data-seccion]').forEach((b) => { b.onclick = () => admin(b.dataset.seccion); });
  actualizarContadores();
}

async function pedidosAdmin(vista, encabezado, filtro) {
  const lista = await get(`/api/bolsas/pedidos${filtro ? `?estado=${filtro}` : ''}`);
  montar(vista, html`${encabezado}
    <div class="segmentos desplazable" style="margin-bottom:16px">${FILTROS.map(([v, txt]) => html`<button type="button" data-filtro="${v}" class="${v === filtro ? 'activo' : ''}">${txt}</button>`)}</div>
    <div class="grid g2" style="align-items:start">${lista.length ? lista.map(tarjetaPedidoAdmin) : html`<div class="card">${vacio(filtro === 'abiertos' ? 'No hay pedidos por atender.' : 'No hay pedidos.')}</div>`}</div>`);
  const recargar = () => admin('pedidos', filtro);
  $$('[data-filtro]').forEach((b) => { b.onclick = () => admin('pedidos', b.dataset.filtro); });
  $$('[data-ver-comprobante]').forEach((b) => { b.onclick = () => verComprobante(b.dataset.verComprobante); });
  const accion = (sel, ruta, ok, pregunta) => $$(`[${sel}]`).forEach((b) => {
    b.onclick = async () => {
      const id = b.getAttribute(sel);
      if (pregunta && !(await confirmar(...pregunta))) return;
      b.disabled = true;
      try { await post(`/api/bolsas/pedidos/${id}/${ruta}`); toast(ok, 'ok'); recargar(); } catch (err) { errorToast(err); b.disabled = false; }
    };
  });
  accion('data-aprobar', 'aprobar', 'Pago aprobado: el pedido queda por entregar');
  accion('data-entregar', 'entregar', 'Pedido marcado como entregado');
  accion('data-anular', 'anular', 'Pedido anulado', ['Anular pedido', 'El cliente verá el pedido como anulado. Si ya pagó, coordina la devolución del dinero.', 'Anular']);
  $$('[data-rechazar]').forEach((b) => {
    b.onclick = () => {
      const m = modal(html`<h2>Rechazar comprobante</h2><p class="sub">El cliente verá el motivo y podrá subir otro comprobante.</p>
        <form class="pila" id="f-rechazo-bolsas" novalidate><label class="campo">Motivo *<input name="motivo" maxlength="300" placeholder="Ej. El monto no coincide con el total"></label>
        <button class="btn">Rechazar</button></form>`);
      $('#f-rechazo-bolsas', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const motivo = e.target.motivo.value.trim();
        if (marcarErrores(e.target, motivo ? {} : { motivo: 'Obligatorio: el cliente lo verá' })) return;
        try { await post(`/api/bolsas/pedidos/${b.dataset.rechazar}/rechazar`, { motivo }); m.cerrar(); toast('Comprobante rechazado', 'ok'); recargar(); }
        catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
      };
    };
  });
  app.refrescar = () => admin('pedidos', filtro);
}

function tarjetaPedidoAdmin(p) {
  const fono = digitos(p.cliente_telefono);
  const saludo = `Hola ${p.cliente_nombre}, te escribimos de ${app.conf.negocio.nombre} por tu pedido de bolsas ${p.folio}.`;
  return html`<div class="card" style="margin:0">
    <div class="card-titulo"><div><b class="mono">${p.folio}</b><div class="sub">${fechaHora(p.creado_en)}</div></div>${badgePedido(p.estado)}</div>
    <p><b>${p.cliente_nombre}</b>${p.cliente_telefono ? html` · <span class="nowrap">${p.cliente_telefono}</span>` : ''}<br>
      <span class="sub">Entregar en ${p.entrega_direccion}, <b>${p.entrega_comuna}</b></span>${p.observaciones ? html`<br><span class="sub">Obs.: ${p.observaciones}</span>` : ''}</p>
    ${lineasPedido(p)}
    ${p.motivo_rechazo && p.estado === 'pendiente' ? html`<p class="sub" style="margin-top:8px">Comprobante rechazado: ${p.motivo_rechazo}</p>` : ''}
    ${p.estado === 'en_revision' ? html`<p class="sub" style="margin-top:8px">Comprobante subido ${fechaHora(p.comprobante_subido_en)}${p.comprobante_referencia ? ` · operación ${p.comprobante_referencia}` : ''}</p>` : ''}
    ${p.motivo_anulacion && p.estado === 'anulado' ? html`<p class="sub" style="margin-top:8px">${p.motivo_anulacion}</p>` : ''}
    <div class="fila" style="margin-top:12px">
      ${p.tiene_comprobante ? html`<button type="button" class="btn sec chico" data-ver-comprobante="${p.id}">Ver comprobante</button>` : ''}
      ${p.estado === 'en_revision' ? html`<button type="button" class="btn chico" data-aprobar="${p.id}">Aprobar pago</button><button type="button" class="btn sec chico" data-rechazar="${p.id}">Rechazar</button>` : ''}
      ${p.estado === 'pendiente' ? html`<button type="button" class="btn sec chico" data-aprobar="${p.id}">Marcar pagado</button>` : ''}
      ${p.estado === 'pagado' ? html`<button type="button" class="btn chico" data-entregar="${p.id}">Marcar entregado</button>` : ''}
      ${['pendiente', 'en_revision', 'pagado'].includes(p.estado) ? html`<button type="button" class="btn peligro chico" data-anular="${p.id}">Anular</button>` : ''}
      ${fono.length >= 8 ? html`<a class="btn sec chico" target="_blank" rel="noopener" href="https://wa.me/${fono}?text=${encodeURIComponent(saludo)}">${icono('whatsapp')} WhatsApp</a>` : ''}
    </div>
  </div>`;
}

async function precios(vista, encabezado) {
  const catalogo = await get('/api/bolsas/catalogo?todos=1');
  montar(vista, html`${encabezado}
    <div class="card">
      <div class="card-titulo"><h2>Precios y medidas</h2><span class="sub">${catalogo.filter((p) => p.activo).length} disponibles</span></div>
      <p class="sub">El cliente ve el precio de venta de cada paquete (y cuánto sale cada bolsa). El costo solo lo ves tú. Los cambios se guardan al salir de cada casilla y aplican a los pedidos nuevos.</p>
      <div class="tabla-wrap" tabindex="0" role="region" aria-label="Precios de bolsas"><table class="tabla-cards">
        <thead><tr><th>Bolsa</th><th class="num">Bolsas por paquete</th><th class="num">Costo</th><th class="num">Precio de venta</th><th class="num">Margen</th><th>Disponible</th></tr></thead>
        <tbody>${catalogo.map((p) => html`<tr>
          <td data-label="Bolsa"><b>${p.color} ${p.medida} cm</b></td>
          <td class="num" data-label="Bolsas por paquete"><input type="number" min="1" step="1" data-campo="unidades" data-id="${p.id}" value="${p.unidades}" class="celda-num"></td>
          <td class="num" data-label="Costo"><input type="number" min="0" step="1" data-campo="costo" data-id="${p.id}" value="${p.costo ?? ''}" class="celda-num"></td>
          <td class="num" data-label="Precio de venta"><input type="number" min="1" step="1" data-campo="precio" data-id="${p.id}" value="${p.precio}" class="celda-num"></td>
          <td class="num" data-label="Margen" data-margen="${p.id}">${p.costo == null ? '—' : clp(p.precio - p.costo)}</td>
          <td data-label="Disponible"><label class="interruptor"><input type="checkbox" data-activo="${p.id}" ${p.activo ? html`checked` : ''}><span class="sub">${p.activo ? 'Sí' : 'No'}</span></label></td>
        </tr>`)}</tbody></table></div>
    </div>
    <form class="card" id="f-nueva-bolsa" novalidate>
      <h2>Agregar color o medida</h2>
      <p class="sub">Cada color tiene su precio: agrega una fila por cada medida del color nuevo (por ejemplo Negro 17x30).</p>
      <div class="grid g3">
        <label class="campo">Color *<input name="color" maxlength="30" placeholder="Negro" list="colores-bolsas"></label>
        <datalist id="colores-bolsas">${[...new Set(catalogo.map((p) => p.color))].map((c) => html`<option value="${c}">`)}</datalist>
        <label class="campo">Medida (cm) *<input name="medida" maxlength="12" placeholder="17x30"></label>
        <label class="campo">Bolsas por paquete *<input name="unidades" type="number" min="1" step="1" value="100"></label>
        <label class="campo">Costo <small>(opcional)</small><input name="costo" type="number" min="0" step="1"></label>
        <label class="campo">Precio de venta *<input name="precio" type="number" min="1" step="1"></label>
      </div>
      <button class="btn" style="margin-top:12px">Agregar</button>
    </form>`);
  $$('[data-campo]').forEach((i) => {
    i.onchange = async () => {
      try {
        const p = await patch(`/api/bolsas/catalogo/${i.dataset.id}`, { [i.dataset.campo]: i.value === '' ? null : Number(i.value) });
        $(`[data-margen="${p.id}"]`).textContent = p.costo == null ? '—' : clp(p.precio - p.costo);
        toast(`${p.color} ${p.medida}: guardado`, 'ok');
      } catch (err) { errorToast(err); }
    };
  });
  $$('[data-activo]').forEach((i) => {
    i.onchange = async () => {
      try { await patch(`/api/bolsas/catalogo/${i.dataset.activo}`, { activo: i.checked }); i.nextElementSibling.textContent = i.checked ? 'Sí' : 'No'; toast(i.checked ? 'Disponible para los clientes' : 'Oculta para los clientes', 'ok'); }
      catch (err) { errorToast(err); i.checked = !i.checked; }
    };
  });
  $('#f-nueva-bolsa').onsubmit = async (e) => {
    e.preventDefault();
    const d = datosForm(e.target);
    try { const p = await post('/api/bolsas/catalogo', d); toast(`Agregada: ${p.color} ${p.medida}`, 'ok'); admin('precios'); }
    catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
  };
  // No se redibuja solo: borraría un precio a medio escribir.
  app.refrescar = null;
}

// Pedidos de bolsas por atender junto a "Bolsas" en el menú de administración.
export async function actualizarContadorBolsas() {
  if (app.usuario?.rol !== 'admin' || !app.conf?.operacion?.bolsas) return 0;
  let n = 0;
  try { n = (await get('/api/bolsas/pedidos/abiertos')).abiertos; } catch { return 0; }
  $$('[data-contador-bolsas]').forEach((el) => { el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
  return n;
}
