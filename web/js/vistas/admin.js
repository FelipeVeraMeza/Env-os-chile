import { app } from '../app.js';
import { get, patch, post, put } from '../api.js';
import { $, $$, badgePago, clp, confirmar, datosForm, errorToast, esqueleto, fecha, fechaHora, hoyISO, html, icono, marcarErrores, modal, montar, toast, vacio } from '../ui.js';
import { limpiarCacheComunas } from './comun.js';
import { revisarComprobante } from './envios.js';

// ================= Panel de ganancias =================
export async function panel(rango = {}) {
  const vista = $('#vista');
  const hoy = hoyISO();
  const desde = rango.desde || `${hoy.slice(0, 8)}01`;
  const hasta = rango.hasta || hoy;
  montar(vista, esqueleto(4));
  const [g, pendientes, reclamosAbiertos, comprobantes] = await Promise.all([
    get(`/api/reportes/ganancias?desde=${desde}&hasta=${hasta}`),
    get('/api/envios?estado=creado&repartidor_id=sin&limite=5'),
    get('/api/reclamos?estado=solicitado'),
    get('/api/cobranza/comprobantes').catch(() => []),
  ]);
  const estados = Object.fromEntries(g.por_estado.map((r) => [r.estado, r.n]));

  montar(vista, html`
    <div class="encabezado"><div><h1>Panel de administración</h1><p>Ganancia neta = tarifas de envíos entregados − costos (incluye seguros pagados).</p></div>
      <form class="fila" id="rango">
        <label class="campo">Desde<input type="date" name="desde" value="${desde}" max="${hoy}"></label>
        <label class="campo">Hasta<input type="date" name="hasta" value="${hasta}" max="${hoy}"></label>
        <div class="fila" style="align-self:flex-end"><button type="button" class="btn sec chico" data-r="hoy">Hoy</button><button type="button" class="btn sec chico" data-r="mes">Mes</button></div>
      </form></div>
    ${comprobantes.length ? html`<a class="aviso magenta" href="#/cobranza" style="display:block;margin-bottom:16px;color:inherit;text-decoration:none"><b>${comprobantes.length} comprobante(s) de transferencia por revisar.</b> Esos envíos no se pueden asignar ni retirar hasta que apruebes el pago → Ir a Cobranza</a>` : ''}
    <div class="grid g4">
      <div class="kpi destacado"><div class="etiqueta">Ganancia neta</div><div class="valor">${clp(g.neto)}</div><div class="nota">${fecha(g.desde)} – ${fecha(g.hasta)}</div></div>
      <div class="kpi"><div class="etiqueta">Ingresos (entregados)</div><div class="valor">${clp(g.ingreso)}</div><div class="nota">${g.entregados} envíos · prom. ${clp(g.promedio_por_envio)}</div></div>
      <div class="kpi"><div class="etiqueta">Costos</div><div class="valor">${clp(g.costos)}</div><div class="nota">${g.costos_por_tipo.map((c) => `${c.tipo} ${clp(c.total)}`).join(' · ') || 'sin costos registrados'}</div></div>
      <div class="kpi"><div class="etiqueta">Cobrado en el período</div><div class="valor">${clp(g.cobrado)}</div><div class="nota">${g.pagados} pagos · proyectado ${clp(g.proyectado.monto)}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card" style="margin:0"><div class="card-titulo"><h2>Ingresos por día</h2><span class="sub">Envíos entregados</span></div><div id="grafico"></div></div>
      <div class="card" style="margin:0"><h2>Comunas con más ingresos</h2>
        ${g.por_comuna.length ? html`<div class="ranking">${g.por_comuna.map((c) => html`<div class="r"><span>${c.comuna}</span><div><div class="b" style="width:${Math.max(4, (c.ingreso / g.por_comuna[0].ingreso) * 100)}%"></div></div><span class="v">${clp(c.ingreso)} · ${c.envios}</span></div>`)}</div>` : vacio('Sin entregas en el período.')}
      </div>
    </div>
    <div class="grid g3" style="margin-top:16px;align-items:start">
      <div class="card" style="margin:0"><div class="card-titulo"><h2>Sin asignar</h2><a class="btn sec chico" href="#/envios">Ver todos</a></div>
        ${pendientes.items.length ? html`<div class="pila">${pendientes.items.map((e) => html`<a href="#/envio/${e.id}" class="fila entre" style="color:inherit;text-decoration:none"><span class="mono"><b>${e.folio}</b></span><span class="sub">${e.comuna_nombre}</span>${badgePago(e.estado_pago)}</a>`)}</div>` : html`<p class="sub">Todo asignado ✔</p>`}</div>
      <div class="card" style="margin:0"><h2>Repartidores</h2>
        ${g.por_repartidor.length ? html`<div class="tabla-wrap" tabindex="0" role="region" aria-label="Tabla (desliza para ver más)"><table><thead><tr><th>Repartidor</th><th class="num">Entregas</th><th class="num">Fallidos</th></tr></thead>
          <tbody>${g.por_repartidor.map((r) => html`<tr><td>${r.repartidor}</td><td class="num">${r.entregados}</td><td class="num">${r.intentos_fallidos}</td></tr>`)}</tbody></table></div>` : html`<p class="sub">Sin actividad en el período.</p>`}</div>
      <div class="card" style="margin:0"><h2>Estado de la operación</h2>
        <div class="desglose">${[['creado', 'Creados'], ['asignado', 'Asignados'], ['en_ruta', 'En ruta'], ['entregado', 'Entregados'], ['fallido', 'Fallidos'], ['devuelto', 'Devueltos'], ['anulado', 'Anulados']].map(([k, t]) => html`<div><span>${t}</span><b>${estados[k] || 0}</b></div>`)}</div>
        <p class="sub" style="margin-top:10px">Intentos fallidos por envío: ${(g.tasa_intentos_fallidos * 100).toFixed(1)}%</p>
        ${reclamosAbiertos.length ? html`<a class="btn sec chico" href="#/reclamos" style="margin-top:8px">${reclamosAbiertos.length} reclamo(s) de seguro por revisar</a>` : ''}</div>
    </div>`);

  graficoBarras($('#grafico'), g.por_dia, desde, hasta);
  $('#rango').addEventListener('change', (e) => panel(datosForm(e.currentTarget)));
  $$('[data-r]').forEach((b) => { b.onclick = () => panel(b.dataset.r === 'hoy' ? { desde: hoy, hasta: hoy } : {}); });
}

// Barras de una sola serie (sin leyenda: el título la nombra), tooltip al pasar el cursor y tabla accesible.
function graficoBarras(el, datos, desde, hasta) {
  const dias = [];
  for (let d = new Date(`${desde}T12:00:00`); d <= new Date(`${hasta}T12:00:00`) && dias.length < 62; d.setDate(d.getDate() + 1)) dias.push(d.toISOString().slice(0, 10));
  const mapa = Object.fromEntries(datos.map((d) => [d.dia, d]));
  const serie = dias.map((dia) => ({ dia, ingreso: mapa[dia]?.ingreso || 0, envios: mapa[dia]?.envios || 0 }));
  if (!serie.some((s) => s.ingreso)) return montar(el, vacio('Aún no hay entregas en este período.'));
  const W = 600; const H = 220; const pl = 52; const pb = 26; const pt = 10;
  const max = Math.max(...serie.map((s) => s.ingreso));
  const paso = max <= 10000 ? 2500 : max <= 50000 ? 10000 : 10 ** Math.floor(Math.log10(max)) * (max / 10 ** Math.floor(Math.log10(max)) > 5 ? 2 : 1);
  const tope = Math.ceil(max / paso) * paso;
  const ancho = (W - pl) / serie.length;
  const barra = Math.max(3, Math.min(28, ancho - 2));
  const y = (v) => pt + (H - pt - pb) * (1 - v / tope);
  const lineas = [];
  for (let v = 0; v <= tope; v += paso) lineas.push(`<line class="grilla" x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? `$${v / 1000}k` : `$${v}`}</text>`);
  const cadaEtiqueta = Math.ceil(serie.length / 8);
  const barras = serie.map((s, i) => {
    const x = pl + i * ancho + (ancho - barra) / 2;
    const h = Math.max(0, y(0) - y(s.ingreso));
    const r = Math.min(4, barra / 2, h);
    const path = h ? `M${x},${y(0)} V${y(s.ingreso) + r} Q${x},${y(s.ingreso)} ${x + r},${y(s.ingreso)} H${x + barra - r} Q${x + barra},${y(s.ingreso)} ${x + barra},${y(s.ingreso) + r} V${y(0)} Z` : '';
    const etiqueta = i % cadaEtiqueta === 0 ? `<text class="eje" x="${x + barra / 2}" y="${H - 6}" text-anchor="middle">${s.dia.slice(8)}/${s.dia.slice(5, 7)}</text>` : '';
    return `<rect class="barra-hit" data-i="${i}" x="${pl + i * ancho}" y="${pt}" width="${ancho}" height="${H - pt - pb}"/><path class="barra" data-b="${i}" d="${path}"/>${etiqueta}`;
  }).join('');
  el.innerHTML = `<div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos por día del período">${lineas.join('')}${barras}</svg></div>
    <details style="margin-top:8px"><summary class="sub">Ver como tabla</summary><div class="tabla-wrap" tabindex="0" role="region" aria-label="Tabla (desliza para ver más)" style="margin-top:8px"><table><thead><tr><th>Día</th><th class="num">Envíos</th><th class="num">Ingreso</th></tr></thead>
    <tbody>${serie.filter((s) => s.envios).map((s) => `<tr><td>${fecha(`${s.dia}T12:00:00`)}</td><td class="num">${s.envios}</td><td class="num">${clp(s.ingreso)}</td></tr>`).join('')}</tbody></table></div></details>`;
  const cont = $('.grafico', el);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  cont.append(tip);
  $$('.barra-hit', cont).forEach((r) => {
    r.addEventListener('mousemove', (ev) => {
      const s = serie[r.dataset.i];
      $$('.barra.hover', cont).forEach((b) => b.classList.remove('hover'));
      $(`[data-b="${r.dataset.i}"]`, cont).classList.add('hover');
      tip.hidden = false;
      tip.textContent = `${fecha(`${s.dia}T12:00:00`)} · ${clp(s.ingreso)} · ${s.envios} envío(s)`;
      const caja = cont.getBoundingClientRect();
      tip.style.left = `${ev.clientX - caja.left}px`;
      tip.style.top = `${ev.clientY - caja.top}px`;
    });
    r.addEventListener('mouseleave', () => { tip.hidden = true; $$('.barra.hover', cont).forEach((b) => b.classList.remove('hover')); });
  });
}

// ================= Tarifas, reglas de operación y cobertura =================
export async function tarifas() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const comunas = await get('/api/comunas');
  const t = app.conf.tarifas;
  const op = app.conf.operacion;
  const regiones = [...new Set(comunas.map((c) => c.region))];
  montar(vista, html`
    <div class="encabezado"><div><h1>Tarifas y reglas</h1><p>Valores acordados con el cliente. Los cambios aplican a los envíos nuevos.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <form class="card" id="f-tarifas" style="margin:0">
        <h2>Tarifas</h2>
        <div class="grid g2">
          <label class="campo">Tarifa paquete estándar<input type="number" name="base" value="${t.base}"><small>Santiago, sin importar la cantidad de bultos</small></label>
          <label class="campo">Recargo sobredimensionado<input type="number" name="recargo_sobredimension" value="${t.recargo_sobredimension}"><small>Se suma a la tarifa estándar</small></label>
          <label class="campo">Estándar: peso hasta (kg)<input type="number" step="0.1" name="peso_estandar_kg" value="${t.peso_estandar_kg}"></label>
          <label class="campo">Estándar: lado hasta (cm)<input type="number" name="dim_estandar_cm" value="${t.dim_estandar_cm}"></label>
          <label class="campo">Máximo que se recibe (kg)<input type="number" step="0.1" name="peso_max_kg" value="${t.peso_max_kg}"><small>Sobre esto no se toma el despacho</small></label>
          <label class="campo">Lado máximo que se recibe (cm)<input type="number" name="dim_max_cm" value="${t.dim_max_cm}"></label>
          <label class="campo">Recargo horario especial<input type="number" name="recargo_horario_especial" value="${t.recargo_horario_especial}"></label>
        </div>
        <p class="muted" style="margin-top:10px">Hoy: estándar ${clp(t.base)} · sobredimensionado ${clp(t.base + t.recargo_sobredimension)} · sobre ${t.peso_max_kg} kg o ${t.dim_max_cm} cm no se recibe.</p>
        <button class="btn" style="margin-top:14px">Guardar tarifas</button>
      </form>
      <form class="card" id="f-operacion" style="margin:0">
        <h2>Operación</h2>
        <div class="grid g2">
          <label class="campo">Intentos máximos de entrega<input type="number" name="intentos_max" min="1" value="${op.intentos_max}"></label>
          <label class="campo">Espera máxima en destino (min)<input type="number" name="espera_max_min" min="1" value="${op.espera_max_min}"></label>
          <label class="campo">Al escanear el QR<select name="qr_destino">${[['google', 'Google Maps con la dirección (recomendado)'], ['pagina', 'Página con botones Google Maps y Waze'], ['waze', 'Abrir Waze directo']].map(([v, txt]) => html`<option value="${v}" ${op.qr_destino === v ? html`selected` : ''}>${txt}</option>`)}</select></label>
        </div>
        <label class="interruptor" style="margin-top:14px"><input type="checkbox" name="gps_obligatorio" ${op.gps_obligatorio ? html`checked` : ''}> GPS obligatorio para cerrar la entrega</label>
        <label class="interruptor" style="margin-top:10px"><input type="checkbox" name="autoasignacion" ${op.autoasignacion ? html`checked` : ''}> Los repartidores pueden tomar envíos pagados sin asignar</label>
        <p class="muted">Si lo desactivas, el repartidor solo ve lo que administración le asigna.</p>
        <label class="interruptor" style="margin-top:10px"><input type="checkbox" name="registro_clientes" ${op.registro_clientes ? html`checked` : ''}> Los clientes pueden crear su cuenta solos</label>
        <label class="interruptor" style="margin-top:10px"><input type="checkbox" name="punto_courier" ${op.punto_courier ? html`checked` : ''}> Envío a puntos de otras compañías (Blue Express, Starken…)</label>
        <p class="muted">Desactivado = en pausa: los clientes solo pueden elegir entrega a domicilio.</p>
        <p class="muted">La foto de entrega es siempre obligatoria.</p>
        <button class="btn" style="margin-top:6px">Guardar reglas</button>
      </form>
    </div>
    <div class="card">
      <div class="card-titulo"><h2>Cobertura por comuna</h2><span class="sub">${comunas.filter((c) => c.en_cobertura).length} comunas en cobertura</span></div>
      <div class="grid g2" style="margin-bottom:12px"><input type="search" id="buscar-comuna" placeholder="Buscar comuna…" aria-label="Buscar comuna">
        <select id="region" aria-label="Región">${regiones.map((r) => html`<option ${r === 'Metropolitana' ? html`selected` : ''}>${r}</option>`)}</select></div>
      <div class="tabla-wrap" tabindex="0" role="region" aria-label="Tabla (desliza para ver más)"><table><thead><tr><th>Comuna</th><th>Provincia</th><th>Cobertura</th><th class="num">Tarifa propia</th></tr></thead><tbody id="tabla-comunas"></tbody></table></div>
    </div>`);

  const pintarComunas = () => {
    const q = $('#buscar-comuna').value.toLowerCase();
    const region = $('#region').value;
    const filas = comunas.filter((c) => (q ? c.nombre.toLowerCase().includes(q) : c.region === region));
    montar($('#tabla-comunas'), html`${filas.map((c) => html`<tr>
      <td><b>${c.nombre}</b><div class="muted">${c.region}</div></td><td>${c.provincia}</td>
      <td><label class="interruptor"><input type="checkbox" data-cob="${c.id}" ${c.en_cobertura ? html`checked` : ''}><span class="sub">${c.en_cobertura ? 'Sí' : 'No'}</span></label></td>
      <td class="num"><input type="number" data-tarifa="${c.id}" value="${c.tarifa_base ?? ''}" placeholder="${c.tarifa ?? t.base}" style="max-width:120px;min-height:38px;text-align:right"></td></tr>`)}`);
    $$('[data-cob]').forEach((i) => {
      i.onchange = async () => {
        try {
          const zonas = await get('/api/zonas');
          await patch(`/api/comunas/${i.dataset.cob}`, { en_cobertura: i.checked, ...(i.checked && zonas[0] ? { zona_id: zonas[0].id } : {}) });
          const c = comunas.find((x) => String(x.id) === i.dataset.cob);
          c.en_cobertura = i.checked;
          limpiarCacheComunas();
          toast(`${c.nombre}: ${i.checked ? 'en cobertura' : 'fuera de cobertura'}`, 'ok');
          i.nextElementSibling.textContent = i.checked ? 'Sí' : 'No';
        } catch (err) { errorToast(err); i.checked = !i.checked; }
      };
    });
    $$('[data-tarifa]').forEach((i) => {
      i.onchange = async () => {
        try { await patch(`/api/comunas/${i.dataset.tarifa}`, { tarifa_base: i.value === '' ? null : Number(i.value) }); limpiarCacheComunas(); toast('Tarifa de comuna actualizada', 'ok'); }
        catch (err) { errorToast(err); }
      };
    });
  };
  $('#buscar-comuna').oninput = pintarComunas;
  $('#region').onchange = pintarComunas;
  pintarComunas();

  const guardar = (clave) => async (e) => {
    e.preventDefault();
    marcarErrores(e.target, {});
    try { app.conf[clave] = await put(`/api/config/${clave}`, datosForm(e.target)); toast('Cambios guardados', 'ok'); }
    catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
  };
  $('#f-tarifas').onsubmit = guardar('tarifas');
  $('#f-operacion').onsubmit = guardar('operacion');
}

// ================= Usuarios =================
const ROL = { admin: 'Administrador', cliente: 'Cliente', repartidor: 'Repartidor' };

export async function usuarios() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const conSesion = app.conf.auth_mode === 'jwt';
  const lista = (await get('/api/usuarios')).filter((u) => !u.correo.startsWith('qa-'));
  montar(vista, html`
    <div class="encabezado"><div><h1>Usuarios</h1><p>Tres perfiles: administrador (también puede repartir), cliente y repartidor. Los clientes se registran solos; aquí puedes cambiar el perfil de cada uno.${conSesion ? ' Cada persona entra con su correo y contraseña.' : ''}</p></div>
      <button class="btn" id="nuevo-u">${icono('nuevo')} Nuevo usuario</button></div>
    <div class="tabla-wrap"><table class="tabla-cards"><thead><tr><th>Nombre y correo</th><th>Perfil</th><th>Teléfono</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
      <tbody>${lista.map((u) => html`<tr><td data-label="Nombre"><b>${u.nombre}</b>${u.id === app.usuario.id ? html` <span class="muted">(tú)</span>` : ''}<div class="sub">${u.correo}</div></td>
        <td data-label="Perfil">${u.id === app.usuario.id ? html`<span class="badge e-en_ruta">${ROL[u.rol]}</span>`
          : html`<select data-rol="${u.id}" aria-label="Perfil de ${u.nombre}" style="min-height:36px;padding:4px 8px">${Object.entries(ROL).map(([k, v]) => html`<option value="${k}" ${u.rol === k ? html`selected` : ''}>${v}</option>`)}</select>`}</td>
        <td data-label="Teléfono">${u.telefono || '—'}</td>
        <td data-label="Último acceso" class="sub">${u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'Nunca'}${!u.tiene_clave ? html`<div><span class="badge e-pendiente">Sin contraseña</span></div>` : u.debe_cambiar_clave ? html`<div class="muted">Debe cambiar su clave</div>` : ''}</td>
        <td data-label="Estado">${u.activo ? html`<span class="badge e-entregado">Activo</span>` : html`<span class="badge e-anulado">Inactivo</span>`}</td>
        <td data-label=""><div class="fila"><button class="btn sec chico" data-clave="${u.id}">Contraseña</button>
          ${conSesion && u.activo ? html`<button class="btn sec chico" data-enlace="${u.id}" title="Enlace de un solo uso para que la persona cree su contraseña">Enlace</button>` : ''}
          ${conSesion && u.id !== app.usuario.id ? html`<button class="btn sec chico" data-sesiones="${u.id}" title="Cierra su sesión en todos sus dispositivos">Cerrar sesiones</button>` : ''}
          ${u.id === app.usuario.id ? '' : html`<button class="btn sec chico" data-activo="${u.id}" data-v="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</div></td></tr>`)}</tbody></table></div>`);
  // Enlace de un solo uso (1 hora) para que la persona cree su contraseña: se comparte por WhatsApp o se copia.
  $$('[data-enlace]').forEach((b) => {
    b.onclick = async () => {
      try {
        const u = lista.find((x) => String(x.id) === b.dataset.enlace);
        const { enlace, vence_en_min: min } = await post(`/api/usuarios/${u.id}/restablecer`);
        const texto = `Hola ${u.nombre}, crea tu contraseña de ${app.conf.negocio.nombre} aquí (vale ${min} minutos): ${enlace}`;
        const fono = (u.telefono || '').replace(/\D/g, '');
        const m = modal(html`<h2>Enlace de contraseña</h2>
          <p class="sub">Compártelo con <b>${u.nombre}</b>. Sirve una sola vez y vence en ${min} minutos.${app.conf.recuperacion_por_correo ? '' : ' (El envío automático por correo no está configurado: SMTP_URL).'}</p>
          <label class="campo">Enlace<input id="enlace-clave" readonly value="${enlace}"></label>
          <div class="fila" style="margin-top:12px"><button class="btn" id="copiar-clave">Copiar</button>
            <a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/${fono}?text=${encodeURIComponent(texto)}">Enviar por WhatsApp</a></div>`);
        $('#copiar-clave', m.el).onclick = async () => {
          try { await navigator.clipboard.writeText(enlace); toast('Enlace copiado', 'ok'); } catch { $('#enlace-clave', m.el).select(); }
        };
      } catch (err) { errorToast(err); }
    };
  });
  $$('[data-activo]').forEach((b) => {
    b.onclick = async () => {
      try { await patch(`/api/usuarios/${b.dataset.activo}`, { activo: b.dataset.v === '1' }); toast('Usuario actualizado', 'ok'); usuarios(); } catch (err) { errorToast(err); }
    };
  });
  // Cambiar el perfil (p. ej. alguien que se registró como cliente y va a repartir).
  $$('[data-rol]').forEach((s) => {
    const u = lista.find((x) => String(x.id) === s.dataset.rol);
    s.onchange = async () => {
      const nuevo = s.value;
      const aviso = nuevo === 'admin' ? ' Tendrá acceso completo: pagos, usuarios y configuración.' : '';
      if (!(await confirmar(`¿Cambiar a ${u.nombre} a ${ROL[nuevo]}?`, `Pasará de ${ROL[u.rol]} a ${ROL[nuevo]}.${aviso}`, 'Cambiar perfil'))) { s.value = u.rol; return; }
      try { await patch(`/api/usuarios/${u.id}`, { rol: nuevo }); toast(`${u.nombre} ahora es ${ROL[nuevo]}`, 'ok'); usuarios(); }
      catch (err) { s.value = u.rol; errorToast(err); }
    };
  });
  $$('[data-sesiones]').forEach((b) => {
    const u = lista.find((x) => String(x.id) === b.dataset.sesiones);
    b.onclick = async () => {
      if (!(await confirmar(`¿Cerrar las sesiones de ${u.nombre}?`, 'Tendrá que volver a iniciar sesión en todos sus dispositivos (útil si perdió el teléfono).', 'Cerrar sesiones'))) return;
      try { await post(`/api/usuarios/${u.id}/cerrar-sesiones`); toast('Sesiones cerradas', 'ok'); } catch (err) { errorToast(err); }
    };
  });
  $$('[data-clave]').forEach((b) => {
    const u = lista.find((x) => String(x.id) === b.dataset.clave);
    b.onclick = () => {
      const propia = u.id === app.usuario.id;
      const m = modal(html`<h2>Contraseña de ${u.nombre}</h2>
        <p class="sub">${propia ? 'Tu nueva contraseña. Se cerrarán tus otras sesiones.' : 'Asigna una contraseña temporal y entrégasela por un medio seguro. Al entrar se le pedirá cambiarla y se cerrarán sus sesiones abiertas.'}</p>
        <form class="pila" id="f-clave" novalidate><label class="campo">Nueva contraseña <small>(mínimo 8 caracteres)</small><input name="password" type="text" autocomplete="off" minlength="8" value="${propia ? '' : claveTemporal()}"></label>
          <button class="btn">Guardar contraseña</button></form>`);
      $('#f-clave', m.el).onsubmit = async (e) => {
        e.preventDefault();
        const password = e.target.password.value;
        if (password.length < 8) return marcarErrores(e.target, { password: 'Mínimo 8 caracteres' });
        try { await patch(`/api/usuarios/${u.id}`, { password }); m.cerrar(); toast(propia ? 'Contraseña actualizada: vuelve a iniciar sesión' : 'Contraseña asignada', 'ok'); usuarios(); }
        catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
      };
    };
  });
  $('#nuevo-u').onclick = () => {
    const m = modal(html`<h2>Nuevo usuario</h2><form class="pila" id="f-u" novalidate>
      <label class="campo">Nombre *<input name="nombre"></label>
      <label class="campo">Correo *<input name="correo" type="email" autocapitalize="none"></label>
      <label class="campo">Perfil *<select name="rol"><option value="cliente">Cliente</option><option value="repartidor">Repartidor</option><option value="admin">Administrador</option></select></label>
      <label class="campo">Teléfono<input name="telefono" placeholder="+56 9 1234 5678"></label>
      <label class="campo">Contraseña inicial ${conSesion ? '*' : html`<small>(para cuando se active el inicio de sesión)</small>`}<input name="password" type="text" autocomplete="off" minlength="8" value="${claveTemporal()}">
        <small>Entrégasela a la persona; al entrar por primera vez se le pedirá cambiarla.</small></label>
      <button class="btn">Crear usuario</button></form>`);
    $('#f-u', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const d = datosForm(e.target);
      if (!d.password) delete d.password;
      try { await post('/api/usuarios', d); m.cerrar(); toast('Usuario creado', 'ok'); usuarios(); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  };
}

// Contraseña temporal legible (sin letras confundibles) para entregar a un usuario nuevo.
function claveTemporal() {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const v = crypto.getRandomValues(new Uint32Array(12));
  // 8 letras + 4 números (la política exige ambos), sin caracteres que se confundan (0/O, 1/l/I).
  return Array.from(v, (n, i) => (i % 3 === 2 ? numeros[n % numeros.length] : letras[n % letras.length])).join('');
}

// ================= Ajustes: negocio, ticket y costos =================
const ACCIONES = {
  crear: 'Creó', editar: 'Editó', confirmar: 'Confirmó', asignar: 'Asignó repartidor', cambiar_estado: 'Cambió estado', entregar: 'Entregó',
  llegada: 'Marcó llegada', adjuntar: 'Adjuntó archivo', iniciar_pago: 'Inició pago', pago_manual: 'Registró pago manual',
  revisar: 'Revisó reclamo', pagar: 'Pagó reclamo', pago_aprobado: 'Pago aprobado', pago_rechazado: 'Pago rechazado', login: 'Inició sesión', qr_escaneado: 'QR escaneado',
  comprobante_pago: 'Subió comprobante de transferencia', aprobar_comprobante: 'Aprobó comprobante', rechazar_comprobante: 'Rechazó comprobante',
};
export async function ajustes() {
  const vista = $('#vista');
  montar(vista, esqueleto(3));
  const [costos, actividad] = await Promise.all([get('/api/costos'), get('/api/auditoria?limite=30').catch(() => [])]);
  const n = app.conf.negocio;
  montar(vista, html`
    <div class="encabezado"><div><h1>Ajustes</h1><p>Nombre y logo de la empresa están por definir: cámbialos aquí cuando estén listos.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <form class="card" id="f-negocio" style="margin:0"><h2>Empresa</h2>
        <div class="pila">
          <label class="campo">Nombre de la empresa<input name="nombre" value="${n.nombre}"></label>
          <div class="grid g2"><label class="campo">RUT<input name="rut" value="${n.rut}"></label><label class="campo">Teléfono<input name="telefono" value="${n.telefono}"></label></div>
          <label class="campo">Correo de contacto<input name="correo" value="${n.correo}"></label>
          <div class="campo">Logo <small>(PNG, JPG, WebP o SVG; ideal cuadrado y con fondo transparente)</small>
            <div class="fila" style="margin-top:6px;align-items:center">
              <img id="logo-vista" src="${n.logo_url || 'icons/icono.svg'}" alt="Logo actual" style="width:64px;height:64px;object-fit:contain;border-radius:14px;background:rgba(255,255,255,.08)">
              <label class="btn sec chico" style="cursor:pointer">Subir logo<input type="file" id="logo-archivo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label>
              <button type="button" class="btn sec chico" id="logo-quitar" ${n.logo_url ? '' : html`hidden`}>Quitar</button>
            </div>
            <input type="hidden" name="logo_url" value="${n.logo_url}">
          </div>
          <button class="btn">Guardar empresa</button></div></form>
      <div>
        <form class="card" id="f-ticket" style="margin:0 0 16px"><h2>Ticket</h2>
          <label class="campo">Texto al pie<textarea name="pie">${app.conf.ticket.pie}</textarea></label>
          <button class="btn" style="margin-top:12px">Guardar</button></form>
        <form class="card" id="f-listas" style="margin:0 0 16px"><h2>Opciones del envío</h2>
          <p class="sub">Una opción por línea. Los cambios aplican a los envíos nuevos.</p>
          <div class="grid g2">
            <label class="campo">Empresas de punto courier<textarea name="couriers" rows="6">${app.conf.couriers.join('\n')}</textarea></label>
            <label class="campo">Franjas del horario especial<textarea name="franjas" rows="6">${app.conf.franjas.join('\n')}</textarea></label>
          </div>
          <button class="btn" style="margin-top:12px">Guardar opciones</button></form>
        <form class="card" id="f-transferencia" style="margin:0 0 16px"><h2>Cuenta para transferencias</h2>
          <p class="sub">Se muestra al cliente cuando paga por transferencia y sube el comprobante.</p>
          <div class="grid g2">
            <label class="campo">Banco<input name="banco" maxlength="80" value="${app.conf.transferencia?.banco || ''}"></label>
            <label class="campo">Tipo de cuenta<input name="tipo_cuenta" maxlength="80" value="${app.conf.transferencia?.tipo_cuenta || ''}" placeholder="Cuenta corriente, vista…"></label>
            <label class="campo">N° de cuenta<input name="numero_cuenta" maxlength="80" value="${app.conf.transferencia?.numero_cuenta || ''}"></label>
            <label class="campo">Titular<input name="titular" maxlength="80" value="${app.conf.transferencia?.titular || ''}"></label>
            <label class="campo">RUT del titular<input name="rut" maxlength="80" value="${app.conf.transferencia?.rut || ''}"></label>
            <label class="campo">Correo<input name="correo" maxlength="80" value="${app.conf.transferencia?.correo || ''}"></label>
          </div>
          <button class="btn" style="margin-top:12px">Guardar cuenta</button></form>
        <div class="card" style="margin:0"><div class="card-titulo"><h2>Costos del mes</h2><button class="btn sec chico" id="nuevo-costo">+ Registrar costo</button></div>
          ${costos.length ? html`<div class="tabla-wrap" tabindex="0" role="region" aria-label="Tabla (desliza para ver más)"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th class="num">Monto</th></tr></thead>
            <tbody>${costos.map((c) => html`<tr><td>${fecha(c.fecha)}</td><td>${c.tipo}</td><td class="sub">${c.nota || ''}</td><td class="num">${clp(c.monto)}</td></tr>`)}</tbody></table></div>` : html`<p class="sub">Sin costos registrados este mes.</p>`}
        </div>
      </div>
    </div>
    <div class="card"><div class="card-titulo"><h2>Actividad reciente</h2><span class="sub">Registro de auditoría · últimas ${actividad.length}</span></div>
      ${actividad.length ? html`<details><summary class="sub">Ver registro</summary><div class="pila" style="margin-top:10px">${actividad.map((a) => html`<div class="fila entre">
          <div><b>${ACCIONES[a.accion] || a.accion}</b> <span class="sub">${a.entidad.replace('_', ' ')}${a.entidad_id ? ` #${a.entidad_id}` : ''}</span>
            <div class="muted">${a.usuario || 'Público'}</div></div><span class="sub">${fechaHora(a.fecha)}</span></div>`)}</div></details>`
        : html`<p class="sub">Sin actividad registrada.</p>`}
    </div>`);
  const guardar = (clave) => async (e) => {
    e.preventDefault();
    marcarErrores(e.target, {});
    try {
      app.conf[clave] = await put(`/api/config/${clave}`, datosForm(e.target));
      toast('Cambios guardados', 'ok');
      if (clave === 'negocio') {
        $('#marca-nombre').textContent = app.conf.negocio.nombre;
        const marca = document.querySelector('.marca img');
        if (marca) marca.src = app.conf.negocio.logo_url || 'icons/icono.svg';
      }
    } catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
  };
  $('#f-negocio').onsubmit = guardar('negocio');
  // El logo se achica a 256 px y se convierte a PNG en el teléfono/computador antes de guardarlo.
  const fNeg = $('#f-negocio');
  $('#logo-archivo').onchange = async (ev) => {
    const archivo = ev.target.files[0];
    if (!archivo) return;
    try {
      const png = await logoPng(archivo);
      fNeg.logo_url.value = png;
      $('#logo-vista').src = png;
      $('#logo-quitar').hidden = false;
      toast('Logo listo: toca "Guardar empresa" para aplicarlo');
    } catch { toast('No se pudo leer la imagen. Prueba con otro archivo PNG o JPG.', 'error'); }
  };
  $('#logo-quitar').onclick = () => { fNeg.logo_url.value = ''; $('#logo-vista').src = 'icons/icono.svg'; $('#logo-quitar').hidden = true; };
  $('#f-ticket').onsubmit = guardar('ticket');
  $('#f-transferencia').onsubmit = guardar('transferencia');
  $('#f-listas').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const listas = await put('/api/config/listas', datosForm(e.target));
      app.conf.couriers = listas.couriers;
      app.conf.franjas = listas.franjas;
      e.target.couriers.value = listas.couriers.join('\n');
      e.target.franjas.value = listas.franjas.join('\n');
      toast('Opciones guardadas', 'ok');
    } catch (err) { errorToast(err); }
  };
  $('#nuevo-costo').onclick = () => {
    const m = modal(html`<h2>Registrar costo</h2><form class="pila" id="f-c" novalidate>
      <label class="campo">Tipo<select name="tipo"><option value="bencina">Bencina</option><option value="comision">Comisión repartidor</option><option value="peaje">Peaje</option><option value="mantencion">Mantención</option><option value="otro">Otro</option></select></label>
      <div class="grid g2"><label class="campo">Monto<input name="monto" type="number" min="1"></label><label class="campo">Fecha<input name="fecha" type="date" value="${hoyISO()}" max="${hoyISO()}"></label></div>
      <label class="campo">Nota<input name="nota"></label><button class="btn">Guardar</button></form>`);
    $('#f-c', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { await post('/api/costos', datosForm(e.target)); m.cerrar(); toast('Costo registrado', 'ok'); ajustes(); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  };
}

function logoPng(archivo, lado = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, lado / Math.max(img.naturalWidth || lado, img.naturalHeight || lado));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || lado) * escala));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || lado) * escala));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
    img.src = url;
  });
}

// ================= Cobranza: pagos verificados, por cobrar, comisiones y abonos =================
const VERIFICACION = { simulado: 'Simulador', webhook: 'Aviso de la pasarela', consulta_api: 'Consulta a la pasarela', manual: 'Revisado por administración' };

export async function cobranza(rango = {}) {
  const vista = $('#vista');
  const hoy = hoyISO();
  const desde = rango.desde || `${hoy.slice(0, 8)}01`;
  const hasta = rango.hasta || hoy;
  montar(vista, esqueleto(4));
  const [r, pagos, est, comprobantes] = await Promise.all([
    get(`/api/cobranza/resumen?desde=${desde}&hasta=${hasta}`),
    get('/api/cobranza/pagos'),
    get(`/api/cobranza/estimar${rango.envios_mes ? `?envios_mes=${rango.envios_mes}` : ''}`),
    get('/api/cobranza/comprobantes'),
  ]);
  const pendienteAbono = (p) => p.estado === 'aprobado' && !p.abonado_en && !['manual', 'simulado'].includes(p.proveedor);
  montar(vista, html`
    <div class="encabezado"><div><h1>Cobranza</h1><p>Un envío queda "pagado" solo con un pago verificado. Aquí ves lo cobrado, lo que falta cobrar, lo que se lleva la pasarela y los abonos por llegar.</p></div>
      <form class="fila" id="rango-c">
        <label class="campo">Desde<input type="date" name="desde" value="${desde}" max="${hoy}"></label>
        <label class="campo">Hasta<input type="date" name="hasta" value="${hasta}" max="${hoy}"></label>
      </form></div>
    <div class="grid g4">
      <div class="kpi destacado"><div class="etiqueta">Cobrado (verificado)</div><div class="valor">${clp(r.cobrado.bruto)}</div><div class="nota">${r.cobrado.pagos} pagos · neto ${clp(r.cobrado.neto)}</div></div>
      <div class="kpi"><div class="etiqueta">Comisiones de pago</div><div class="valor">${clp(r.cobrado.comision)}</div><div class="nota">${r.cobrado.bruto ? ((r.cobrado.comision / r.cobrado.bruto) * 100).toFixed(2) : '0.00'}% de lo cobrado</div></div>
      <div class="kpi"><div class="etiqueta">Por cobrar</div><div class="valor">${clp(r.por_cobrar.monto)}</div><div class="nota">${r.por_cobrar.envios} envíos sin pagar${r.por_cobrar.envios ? ` · el más antiguo hace ${r.por_cobrar.dias_mas_antiguo} día(s)` : ''}</div></div>
      <div class="kpi"><div class="etiqueta">Abonos por llegar</div><div class="valor">${clp(r.por_conciliar.monto_esperado)}</div><div class="nota">${r.por_conciliar.pagos} pagos${r.por_conciliar.atrasados ? ` · ${r.por_conciliar.atrasados} atrasado(s)` : ''}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-titulo"><h2>Comprobantes de transferencia por revisar</h2><span class="sub">${comprobantes.length ? `${comprobantes.length} · ${clp(r.en_revision.monto)}` : ''}</span></div>
      ${comprobantes.length ? html`<p class="sub" style="margin-bottom:10px">El envío no se asigna ni se retira hasta que apruebes su pago. Compara cada comprobante con la cartola del banco.</p>
        <div class="tabla-wrap" tabindex="0" role="region" aria-label="Tabla (desliza para ver más)"><table class="tabla-cards"><thead><tr><th>Enviado</th><th>Folio</th><th>Cliente</th><th class="num">Monto</th><th>N° operación</th><th>Acción</th></tr></thead>
        <tbody>${comprobantes.map((c) => html`<tr>
          <td data-label="Enviado">${fechaHora(c.creado_en)}</td><td data-label="Folio" class="mono"><a href="#/envio/${c.envio_id}">${c.folio}</a></td>
          <td data-label="Cliente">${c.cliente_nombre}</td><td data-label="Monto" class="num">${clp(c.monto)}</td>
          <td data-label="N° operación">${c.referencia || html`<span class="muted">—</span>`}${c.usado_en.length ? html`<div><span class="badge e-fallido">Ya usado en ${c.usado_en.join(', ')}</span></div>` : ''}</td>
          <td data-label="Acción"><button class="btn chico" data-revisar-comprobante="${c.id}">Revisar</button></td>
        </tr>`)}</tbody></table></div>` : html`<p class="sub">No hay comprobantes pendientes ✔</p>`}
    </div>
    ${r.sin_respuesta ? html`<div class="aviso alerta" style="margin-top:16px">${r.sin_respuesta} pago(s) iniciados hace más de 30 minutos sin respuesta de la pasarela: el cliente abandonó el pago o el aviso no llegó.</div>` : ''}
    ${!app.conf.pagos.en_linea ? html`<div class="aviso" style="margin-top:16px">Los clientes pagan <b>por transferencia</b>: suben el comprobante y tú lo apruebas o rechazas arriba. El pago en línea está apagado; el comparador de abajo sirve para elegir una pasarela real más adelante.</div>`
      : r.proveedor_actual === 'simulado' ? html`<div class="aviso magenta" style="margin-top:16px">Los pagos en línea están en <b>modo simulado</b>: no se mueve dinero real. Elige un proveedor con el comparador de abajo para conectarlo en la etapa de desarrollo.</div>` : ''}
    <div class="card" style="margin-top:16px"><div class="card-titulo"><h2>Pagos</h2><span class="sub">Últimos 200</span></div>
      ${pagos.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Folio</th><th>Cliente</th><th>Medio</th><th>Estado</th><th>Verificación</th><th class="num">Monto</th><th class="num">Comisión</th><th>Abono</th></tr></thead>
        <tbody>${pagos.map((p) => html`<tr>
          <td>${fecha(p.creado_en)}</td><td class="mono"><a href="#/envio/${p.envio_id}">${p.folio || '—'}</a></td><td>${p.cliente_nombre}</td>
          <td>${p.proveedor === 'manual' ? p.medio : p.proveedor}</td>
          <td><span class="badge ${p.estado === 'aprobado' ? 'e-pagado' : p.estado === 'iniciado' ? 'e-pendiente' : p.estado === 'en_revision' ? 'e-en_revision' : 'e-anulado'}">${p.estado === 'en_revision' ? 'en revisión' : p.estado}</span></td>
          <td class="sub">${p.verificacion ? html`${VERIFICACION[p.verificacion]}${p.verificado_por_nombre ? ` · ${p.verificado_por_nombre}` : ''}<div class="muted">${p.transaccion_id || p.referencia || ''}</div>` : '—'}</td>
          <td class="num">${clp(p.monto)}</td><td class="num">${clp(p.comision_real ?? p.comision_estimada)}${p.comision_real === null && p.comision_estimada ? html`<div class="muted">estimada</div>` : ''}</td>
          <td>${p.abonado_en ? html`<span class="sub">${fecha(p.abonado_en)} · ${clp(p.monto_abonado)}</span>` : pendienteAbono(p) ? html`<button class="btn sec chico" data-conciliar="${p.id}">Conciliar</button><div class="muted">esperado ${fecha(p.abono_estimado_en)}</div>` : html`<span class="muted">—</span>`}</td>
        </tr>`)}</tbody></table></div>` : vacio('Aún no hay pagos registrados.')}
    </div>
    <div class="card"><div class="card-titulo"><h2>¿Qué proveedor de pago conviene?</h2>
      <form class="fila" id="f-est"><label class="campo">Envíos al mes<input type="number" name="envios_mes" min="0" value="${est.envios_mes}" style="max-width:120px"></label></form></div>
      <p class="sub">Costo de cobrar un envío de ${clp(est.monto)}. <b>Comisiones referenciales</b>: confírmalas con cada proveedor antes de firmar (varían por contrato y volumen).</p>
      <div class="tabla-wrap"><table><thead><tr><th>Proveedor</th><th class="num">Comisión</th><th class="num">Costo por envío</th><th class="num">Recibes</th><th class="num">Costo al mes</th><th>Abono</th><th>Cómo se verifica</th></tr></thead>
        <tbody>${est.proveedores.map((p) => html`<tr><td style="white-space:normal;min-width:220px;max-width:340px"><b>${p.nombre}</b><div class="muted">${p.nota}</div></td>
          <td class="num">${p.porcentaje}%${p.lleva_iva ? ' + IVA' : ''}</td><td class="num">${clp(p.costo)}</td><td class="num">${clp(p.neto)}</td><td class="num">${clp(p.costo_mes)}</td>
          <td>${p.dias_abono ? `${p.dias_abono} día(s) hábil(es)` : 'Inmediato'}</td><td class="sub" style="white-space:normal">${VERIFICACION[p.verificacion]}</td></tr>`)}</tbody></table></div>
    </div>`);
  $('#rango-c').addEventListener('change', (e) => cobranza(datosForm(e.currentTarget)));
  $('#f-est').addEventListener('change', (e) => cobranza({ desde, hasta, envios_mes: e.target.value }));
  $('#f-est').onsubmit = (e) => { e.preventDefault(); cobranza({ desde, hasta, envios_mes: e.target.envios_mes.value }); };
  $$('[data-revisar-comprobante]').forEach((b) => {
    b.onclick = () => revisarComprobante(comprobantes.find((c) => String(c.id) === b.dataset.revisarComprobante), () => cobranza({ desde, hasta }));
  });
  $$('[data-conciliar]').forEach((b) => {
    const p = pagos.find((x) => String(x.id) === b.dataset.conciliar);
    b.onclick = () => {
      const m = modal(html`<h2>Conciliar abono</h2>
        <p class="sub">Revisa la cartola del banco y registra lo que realmente llegó por el envío ${p.folio}. La diferencia con lo cobrado (${clp(p.monto)}) queda como costo "pasarela".</p>
        <form class="pila" id="f-con" novalidate>
          <div class="grid g2"><label class="campo">Monto abonado<input name="monto_abonado" type="number" min="0" max="${p.monto}" value="${p.neto_estimado ?? p.monto}"></label>
          <label class="campo">Fecha del abono<input name="abonado_en" type="date" value="${hoyISO()}" max="${hoyISO()}"></label></div>
          <button class="btn">Guardar conciliación</button></form>`);
      $('#f-con', m.el).onsubmit = async (e) => {
        e.preventDefault();
        try { await post(`/api/cobranza/pagos/${p.id}/conciliar`, datosForm(e.target)); m.cerrar(); toast('Abono conciliado', 'ok'); cobranza({ desde, hasta }); }
        catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
      };
    };
  });
}

// ================= Seguridad: alertas, intentos de ataque y extracción de datos =================
const NIVEL_ALERTA = { critica: ['e-fallido', 'Crítica'], alerta: ['e-pendiente', 'Alerta'], aviso: ['e-asignado', 'Aviso'] };
const NIVEL_EVENTO = { alerta: 'e-fallido', aviso: 'e-pendiente', info: 'e-creado' };

export async function seguridad(filtro = {}) {
  const vista = $('#vista');
  montar(vista, esqueleto(4));
  const horas = filtro.horas || 24;
  const qs = new URLSearchParams({ limite: 150, ...(filtro.sospechosos ? { sospechosos: '1' } : {}), ...(filtro.tipo ? { tipo: filtro.tipo } : {}) });
  const [r, alertas, extraccion, eventos] = await Promise.all([
    get(`/api/seguridad/resumen?horas=${horas}`), get('/api/seguridad/alertas'), get(`/api/seguridad/extraccion?horas=${Math.max(horas, 24 * 7)}`), get(`/api/seguridad/eventos?${qs}`),
  ]);
  const t = r.totales;
  const kpi = (etq, valor, nota, alerta) => html`<div class="kpi ${alerta ? 'destacado' : ''}"><div class="etiqueta">${etq}</div><div class="valor">${valor}</div><div class="nota">${nota}</div></div>`;
  montar(vista, html`
    <div class="encabezado"><div><h1>Seguridad</h1><p>Intentos de ataque, accesos indebidos y qué datos salieron de la plataforma. Los registros no se pueden borrar ni modificar.</p></div>
      <div class="fila"><select id="horas" aria-label="Período">${[[24, 'Últimas 24 horas'], [168, 'Últimos 7 días'], [720, 'Últimos 30 días']].map(([v, txt]) => html`<option value="${v}" ${v === horas ? html`selected` : ''}>${txt}</option>`)}</select>
        ${app.conf.auth_mode === 'jwt' ? html`<button class="btn peligro" id="emergencia">Cerrar todas las sesiones</button>` : ''}</div></div>
    ${alertas.length ? html`<div class="card" style="border-color:var(--error)"><div class="card-titulo"><h2>Alertas abiertas (${alertas.length})</h2>${alertas.length > 1 ? html`<button class="btn sec chico" id="revisar-todas">Marcar todas revisadas</button>` : html`<span class="sub">Revísalas y anota qué hiciste</span>`}</div>
      <div class="pila">${alertas.map((a) => html`<div class="fila entre" style="padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05)">
        <div><span class="badge ${NIVEL_ALERTA[a.nivel][0]}">${NIVEL_ALERTA[a.nivel][1]}</span> <b>${a.titulo}</b>
          <div class="sub">${fechaHora(a.creada_en)}${a.veces > 1 ? ` · se repitió ${a.veces} veces, última ${fechaHora(a.ultima_en)}` : ''}${a.ip ? ` · IP ${a.ip}` : ''}${a.usuario_nombre ? ` · ${a.usuario_nombre}` : ''}</div></div>
        <button class="btn sec chico" data-revisar="${a.id}">Marcar revisada</button></div>`)}</div></div>`
    : html`<div class="aviso ok" style="margin-bottom:16px">Sin alertas abiertas ✔</div>`}
    <div class="grid g4">
      ${kpi('Inicios de sesión fallidos', t.logins_fallidos, `${t.logins} correctos · ${t.bloqueos} bloqueo(s)`, t.bloqueos > 0)}
      ${kpi('Intentos de ver datos ajenos', t.sondeos, `${t.denegados} acciones sin permiso`, t.sondeos > 0)}
      ${kpi('Registros exportados', t.registros_exportados, `${t.exportaciones} exportación(es) · ${t.descargas} archivo(s) descargados`)}
      ${kpi('Sesiones o enlaces falsos', t.falsificaciones, `${t.excesos} exceso(s) de peticiones`, t.falsificaciones > 0)}
    </div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card" style="margin:0"><h2>¿Quién sacó datos? <span class="sub">(últimos ${Math.max(horas, 168) / 24} días)</span></h2>
        ${extraccion.usuarios.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Usuario</th><th class="num">Registros exportados</th><th class="num">Archivos</th><th class="num">Intentos ajenos</th><th>Último</th></tr></thead>
          <tbody>${extraccion.usuarios.map((u) => html`<tr><td><b>${u.nombre || 'Sin sesión'}</b><div class="sub">${u.correo || ''}</div></td><td class="num">${u.registros_exportados}</td><td class="num">${u.archivos_descargados}</td>
            <td class="num">${u.intentos_ajenos ? html`<span class="badge e-fallido">${u.intentos_ajenos}</span>` : 0}</td><td class="sub">${fechaHora(u.ultima)}</td></tr>`)}</tbody></table></div>` : html`<p class="sub">Nadie ha exportado ni descargado datos.</p>`}</div>
      <div class="card" style="margin:0"><h2>IPs sospechosas</h2>
        ${r.ips_sospechosas.length ? html`<div class="tabla-wrap"><table><thead><tr><th>IP</th><th class="num">Señales</th><th class="num">Cuentas probadas</th><th>Última</th></tr></thead>
          <tbody>${r.ips_sospechosas.map((i) => html`<tr><td class="mono"><a href="#" data-ip="${i.ip}">${i.ip}</a></td><td class="num">${i.sospechosos}</td><td class="num">${i.cuentas_probadas}</td><td class="sub">${fechaHora(i.ultima)}</td></tr>`)}</tbody></table></div>` : html`<p class="sub">Ninguna en el período.</p>`}
        <h3 style="margin-top:14px">Sesiones recientes</h3>
        ${r.sesiones_recientes.length ? html`<div class="pila">${r.sesiones_recientes.slice(0, 8).map((u) => html`<div class="fila entre"><span><b>${u.nombre}</b> <span class="sub">${u.rol}</span></span><span class="sub">${fechaHora(u.ultimo_acceso)}${u.ultima_ip ? ` · ${u.ultima_ip}` : ''}</span></div>`)}</div>` : html`<p class="sub">Nadie entró en el período.</p>`}
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-titulo"><h2>Registro de eventos</h2>
      <form class="fila" id="f-eventos"><label class="interruptor"><input type="checkbox" name="sospechosos" ${filtro.sospechosos ? html`checked` : ''}> Solo sospechosos</label>
        <select name="tipo" aria-label="Tipo"><option value="">Todos los tipos</option>${r.por_tipo.map((p) => html`<option value="${p.tipo}" ${filtro.tipo === p.tipo ? html`selected` : ''}>${p.etiqueta} (${p.n})</option>`)}</select></form></div>
      ${eventos.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Usuario</th><th>IP</th><th>Detalle</th></tr></thead>
        <tbody>${eventos.map((e) => html`<tr><td class="sub">${fechaHora(e.fecha)}</td><td><span class="badge ${NIVEL_EVENTO[e.nivel]}">${e.etiqueta}</span></td>
          <td>${e.usuario_nombre || e.correo || '—'}</td><td class="mono sub">${e.ip || ''}</td>
          <td class="sub" style="white-space:normal;max-width:360px">${e.registros ? `${e.registros} registro(s) · ` : ''}${e.ruta || ''}${e.detalle ? ` · ${resumirDetalle(e.detalle)}` : ''}</td></tr>`)}</tbody></table></div>` : vacio('Sin eventos con estos filtros.')}
    </div>
    <div class="aviso" style="margin-top:16px"><b>¿Sospechas un hackeo?</b> 1) Pulsa <b>Cerrar todas las sesiones</b>. 2) Cambia tu contraseña. 3) Revisa aquí qué usuario e IP actuaron y qué datos exportaron. 4) Sigue el protocolo de <b>docs/17-seguridad.md</b> (cambiar claves de Railway y Supabase).</div>`);

  $('#horas').onchange = (e) => seguridad({ ...filtro, horas: Number(e.target.value) });
  $('#f-eventos').onchange = (e) => seguridad({ ...datosForm(e.currentTarget), horas });
  $$('[data-ip]').forEach((a) => { a.onclick = async (ev) => { ev.preventDefault(); const lista = await get(`/api/seguridad/eventos?ip=${encodeURIComponent(a.dataset.ip)}&limite=50`); detalleIp(a.dataset.ip, lista); }; });
  $$('[data-revisar]').forEach((b) => {
    b.onclick = () => {
      const m = modal(html`<h2>Revisar alerta</h2><form class="pila" id="f-rev" novalidate>
        <label class="campo">¿Qué revisaste y qué hiciste? *<textarea name="nota" placeholder="Ej. era un cliente que olvidó su clave; se le asignó una nueva"></textarea></label>
        <button class="btn">Marcar como revisada</button></form>`);
      $('#f-rev', m.el).onsubmit = async (e) => {
        e.preventDefault();
        try { await post(`/api/seguridad/alertas/${b.dataset.revisar}/revisar`, datosForm(e.target)); m.cerrar(); toast('Alerta revisada', 'ok'); seguridad({ ...filtro, horas }); }
        catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
      };
    };
  });
  $('#revisar-todas')?.addEventListener('click', () => {
    const m = modal(html`<h2>Revisar ${alertas.length} alertas</h2><p class="sub">Úsalo cuando ya investigaste (por ejemplo, alertas generadas por pruebas). La nota queda en cada alerta.</p>
      <form class="pila" id="f-rev-todas" novalidate><label class="campo">¿Qué revisaste y qué hiciste? *<textarea name="nota"></textarea></label><button class="btn">Marcar todas como revisadas</button></form>`);
    $('#f-rev-todas', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { const r2 = await post('/api/seguridad/alertas/revisar-todas', datosForm(e.target)); m.cerrar(); toast(`${r2.revisadas} alerta(s) revisadas`, 'ok'); seguridad({ ...filtro, horas }); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  });
  $('#emergencia')?.addEventListener('click', () => {
    const m = modal(html`<h2>Cerrar todas las sesiones</h2>
      <p class="sub">Todos los usuarios (menos tú) tendrán que volver a iniciar sesión. Úsalo si sospechas que alguien robó una sesión o una contraseña.</p>
      <form class="pila" id="f-emer" novalidate><label class="campo">Escribe CERRAR para confirmar<input name="confirmar" autocomplete="off"></label>
        <button class="btn peligro">Cerrar todas las sesiones</button></form>`);
    $('#f-emer', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { const r2 = await post('/api/seguridad/cerrar-todas-las-sesiones', datosForm(e.target)); m.cerrar(); toast(`Se cerraron las sesiones de ${r2.usuarios} usuario(s)`, 'ok'); seguridad({ ...filtro, horas }); }
      catch (err) { marcarErrores(e.target, err.detalles); errorToast(err); }
    };
  });
}

function resumirDetalle(d) {
  const partes = [];
  if (d.motivo) partes.push(String(d.motivo).replace(/_/g, ' '));
  if (d.entidad) partes.push(`${d.entidad} #${d.id}${d.existe === false ? ' (no existe)' : ''}`);
  if (d.requiere) partes.push(`requiere ${d.requiere.join('/')}`);
  if (d.adjunto) partes.push(`archivo #${d.adjunto}${d.envio ? ` del envío #${d.envio}` : ''}`);
  if (d.correo) partes.push(d.correo);
  if (d.cambios) partes.push(`cambió: ${Array.isArray(d.cambios) ? d.cambios.join(', ') : Object.keys(d.cambios).join(', ')}`);
  if (d.alcance) partes.push(`alcance: ${d.alcance}`);
  if (d.grupo) partes.push(`límite ${d.grupo}`);
  return partes.join(' · ') || '';
}

function detalleIp(ip, eventos) {
  modal(html`<h2>Actividad de la IP <span class="mono">${ip}</span></h2>
    <p class="sub">Últimos ${eventos.length} eventos. Si es un ataque, bloquéala en el proveedor (Railway / Cloudflare) y revisa las cuentas que aparecen.</p>
    <div class="pila" style="max-height:60vh;overflow:auto">${eventos.map((e) => html`<div><span class="badge ${NIVEL_EVENTO[e.nivel]}">${e.etiqueta}</span>
      <span class="sub">${fechaHora(e.fecha)} · ${e.usuario_nombre || e.correo || 'sin sesión'}</span><div class="muted">${e.agente || ''}</div></div>`)}</div>`);
}
