// Cuentas reales (AUTH_MODE=jwt): ingreso, registro, recuperación y cambio de contraseña (RF-01, RF-02, RF-03, RF-56).
import { app } from '../app.js';
import { fijarToken, post } from '../api.js';
import { $, datosForm, errorToast, html, marcarErrores, montar, toast } from '../ui.js';

const tarjeta = (titulo, texto, cuerpo) => html`<div class="card cuenta-card" style="max-width:440px;margin:24px auto">
  <h1 style="margin-top:0">${titulo}</h1>${texto ? html`<p class="sub">${texto}</p>` : ''}${cuerpo}</div>`;

function entrar({ token }) {
  fijarToken(token);
  location.hash = '#/';
  location.reload();
}

async function enviar(form, ruta, datos, alTerminar) {
  const boton = form.querySelector('button[type=submit], button:not([type])');
  boton.disabled = true;
  marcarErrores(form, {});
  try {
    alTerminar(await post(ruta, datos));
  } catch (err) {
    marcarErrores(form, err.detalles);
    errorToast(err);
  } finally {
    boton.disabled = false;
  }
}

export function ingreso() {
  const op = app.conf?.operacion || {};
  montar($('#menu'), '');
  montar($('#vista'), tarjeta('Ingresar', 'Usa el correo y la contraseña de tu cuenta.', html`
    <form class="pila" id="f-login" novalidate>
      <label class="campo">Correo<input name="correo" type="email" autocomplete="username" inputmode="email" required></label>
      <label class="campo">Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn ancho" type="submit">Ingresar</button>
    </form>
    <div class="fila entre" style="margin-top:14px">
      <a href="#/recuperar">¿Olvidaste tu contraseña?</a>
      ${op.registro_clientes ? html`<a href="#/registro">Crear cuenta de cliente</a>` : ''}
      <a href="#/seguimiento">Seguir un envío</a>
    </div>`));
  $('#f-login').onsubmit = (e) => {
    e.preventDefault();
    const d = datosForm(e.target);
    if (!d.correo || !d.password) return marcarErrores(e.target, { ...(d.correo ? {} : { correo: 'Obligatorio' }), ...(d.password ? {} : { password: 'Obligatoria' }) });
    enviar(e.target, '/api/auth/login', d, entrar);
  };
  $('#f-login [name=correo]').focus();
}

export function registro() {
  if (!app.conf?.operacion?.registro_clientes) {
    montar($('#vista'), tarjeta('Registro cerrado', 'Pide tu cuenta a administración.', html`<a class="btn sec" href="#/">Volver</a>`));
    return;
  }
  montar($('#vista'), tarjeta('Crear cuenta de cliente', 'Con tu cuenta podrás crear, pagar y seguir tus envíos.', html`
    <form class="pila" id="f-registro" novalidate>
      <label class="campo">Nombre o empresa *<input name="nombre" autocomplete="name"></label>
      <label class="campo">Correo *<input name="correo" type="email" autocomplete="email" inputmode="email"></label>
      <label class="campo">Teléfono móvil *<input name="telefono" type="tel" autocomplete="tel" placeholder="+56 9 1234 5678"></label>
      <label class="campo">RUT <small>(opcional)</small><input name="rut" placeholder="12.345.678-5"></label>
      <label class="campo">Contraseña * <small>(mínimo 8 caracteres)</small><input name="password" type="password" autocomplete="new-password"></label>
      <button class="btn ancho" type="submit">Crear cuenta</button>
    </form><p class="sub" style="margin-top:12px"><a href="#/">Ya tengo cuenta</a></p>`));
  $('#f-registro').onsubmit = (e) => {
    e.preventDefault();
    enviar(e.target, '/api/auth/registro', datosForm(e.target), (r) => { toast('Cuenta creada', 'ok'); entrar(r); });
  };
}

export function recuperar() {
  montar($('#vista'), tarjeta('Recuperar contraseña', 'Escribe el correo de tu cuenta.', html`
    <form class="pila" id="f-recuperar" novalidate>
      <label class="campo">Correo<input name="correo" type="email" autocomplete="email" inputmode="email"></label>
      <button class="btn ancho" type="submit">Continuar</button>
    </form><div id="res-recuperar"></div><p class="sub" style="margin-top:12px"><a href="#/">Volver a ingresar</a></p>`));
  $('#f-recuperar').onsubmit = (e) => {
    e.preventDefault();
    enviar(e.target, '/api/auth/recuperar', datosForm(e.target), (r) => montar($('#res-recuperar'), html`<div class="aviso" style="margin-top:12px">${r.mensaje}</div>`));
  };
}

export function restablecer(token) {
  montar($('#menu'), '');
  montar($('#vista'), tarjeta('Nueva contraseña', 'Elige una contraseña de al menos 8 caracteres.', html`
    <form class="pila" id="f-restablecer" novalidate>
      <label class="campo">Nueva contraseña<input name="password" type="password" autocomplete="new-password"></label>
      <label class="campo">Repítela<input name="repetir" type="password" autocomplete="new-password"></label>
      <button class="btn ancho" type="submit">Guardar contraseña</button>
    </form>`));
  $('#f-restablecer').onsubmit = (e) => {
    e.preventDefault();
    const d = datosForm(e.target);
    if (d.password !== d.repetir) return marcarErrores(e.target, { repetir: 'No coincide' });
    enviar(e.target, '/api/auth/restablecer', { token, password: d.password }, () => {
      fijarToken(null);
      toast('Contraseña guardada. Ya puedes ingresar.', 'ok');
      location.hash = '#/';
    });
  };
}

export function miCuenta() {
  const u = app.usuario;
  const real = app.conf?.auth_mode === 'jwt';
  montar($('#vista'), html`<div class="encabezado"><div><h1>Mi cuenta</h1><p>${u.nombre} · ${u.correo || ''}</p></div></div>
    ${real ? html`<form class="card pila" id="f-clave" style="max-width:480px" novalidate><h2>Cambiar contraseña</h2>
      <label class="campo">Contraseña actual<input name="actual" type="password" autocomplete="current-password"></label>
      <label class="campo">Nueva contraseña <small>(mínimo 8)</small><input name="nueva" type="password" autocomplete="new-password"></label>
      <label class="campo">Repite la nueva<input name="repetir" type="password" autocomplete="new-password"></label>
      <button class="btn" type="submit">Cambiar contraseña</button>
      <p class="muted">Al cambiarla se cierra la sesión en tus otros dispositivos.</p></form>
    <button class="btn sec" id="salir">Cerrar sesión</button>`
    : html`<div class="aviso">La demo no usa contraseñas: se entra eligiendo un perfil. Con el inicio de sesión real (AUTH_MODE=jwt) aquí se cambia la contraseña y se cierra la sesión.</div>`}`);
  if (!real) return;
  $('#f-clave').onsubmit = (e) => {
    e.preventDefault();
    const d = datosForm(e.target);
    if (d.nueva !== d.repetir) return marcarErrores(e.target, { repetir: 'No coincide' });
    enviar(e.target, '/api/auth/cambiar-password', { actual: d.actual, nueva: d.nueva }, (r) => {
      fijarToken(r.token);
      e.target.reset();
      toast('Contraseña actualizada', 'ok');
    });
  };
  $('#salir').onclick = cerrarSesion;
}

export function cerrarSesion() {
  fijarToken(null);
  location.hash = '#/';
  location.reload();
}
