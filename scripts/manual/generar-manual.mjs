// Genera el manual de usuario en PDF con capturas reales de la aplicación.
//
// Uso:
//   1) Servidor con datos de ejemplo:  npm run dev  y  node scripts/datos-demo.js local
//   2) node scripts/manual/generar-manual.mjs [URL] [salida.pdf]
//      URL por defecto http://localhost:3000 · salida por defecto docs/manual/manual-de-usuario.pdf
//   Con AUTH_MODE=jwt usa las cuentas demo (Demo.2026) y MANUAL_ADMIN_CORREO / MANUAL_ADMIN_PASSWORD.
//   Navegador: Chromium de Playwright o el indicado en CHROMIUM_PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { tomarCapturas } from './capturas.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const salida = path.resolve(process.argv[3] || path.join(raiz, 'docs/manual/manual-de-usuario.pdf'));
const ejecutable = process.env.CHROMIUM_PATH || undefined;
const credenciales = {
  admin: { correo: process.env.MANUAL_ADMIN_CORREO || 'admin@envios.local', password: process.env.MANUAL_ADMIN_PASSWORD || 'Cambiar.Esta.Clave.2026' },
  cliente: { correo: 'cliente@demo.cl', password: 'Demo.2026' },
  repartidor: { correo: 'repartidor@demo.cl', password: 'Demo.2026' },
};

console.log(`▶ Capturando pantallas de ${url}`);
const { fotos, modo, avisos } = await tomarCapturas({ url, credenciales, ejecutable });
const conf = await (await fetch(`${url}/api/config/publica`)).json();
const version = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;
const hoy = new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago' });
const clp = (n) => `$${Number(n).toLocaleString('es-CL')}`;
const t = conf.tarifas;
const op = conf.operacion;

// ---------- Piezas de maquetación ----------
const img = (id, pie, clase = '') => (fotos[id]
  ? `<figure class="${clase}"><img src="data:image/jpeg;base64,${fotos[id]}" alt="${pie}"><figcaption>${pie}</figcaption></figure>` : '');
const par = (a, b) => `<div class="par">${a}${b}</div>`;
const trio = (a, b, c) => `<div class="trio">${a}${b}${c}</div>`;
const nota = (txt) => `<div class="nota">${txt}</div>`;
const alerta = (txt) => `<div class="nota alerta">${txt}</div>`;
const pasos = (lista) => `<ol class="pasos">${lista.map((p) => `<li>${p}</li>`).join('')}</ol>`;
const tabla = (cab, filas) => `<table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const conLogin = modo !== 'demo';
const entrar = conLogin ? `
  <h2 id="entrar">1.3 Cómo entrar</h2>
  <p>Cada persona entra con <b>su correo y su contraseña</b>. La plataforma reconoce el perfil (administrador, cliente o repartidor)
  y muestra solo lo que le corresponde. La sesión queda abierta en ese teléfono o computador hasta que se cierre.</p>
  ${par(img('login', 'Pantalla de inicio de sesión en el celular'), img('login-escritorio', 'La misma pantalla en el computador'))}
  ${pasos([
    'Abre la dirección de la plataforma en el navegador (o el ícono instalado en el teléfono).',
    'Escribe tu <b>correo</b> y tu <b>contraseña</b> y pulsa <b>Entrar</b>. Con <b>Mostrar</b> puedes ver lo que escribiste.',
    'Si es tu primera vez (o administración te dio una contraseña temporal), la plataforma te pide <b>crear tu propia contraseña</b> antes de continuar.',
    'Si te equivocas <b>5 veces</b>, esa cuenta queda bloqueada <b>15 minutos</b> (protección contra accesos indebidos).',
    '¿Olvidaste la contraseña? Pídele a administración una nueva desde <b>Usuarios → Contraseña</b>.',
  ])}
  <h3>Mi cuenta: cambiar contraseña y cerrar sesión</h3>
  <p>Toca tu nombre arriba a la derecha (o <b>Más</b> en el celular). Ahí están tus datos, <b>Cambiar contraseña</b> (pide la actual y la nueva,
  mínimo 8 caracteres) y <b>Cerrar sesión</b>. Al cambiar la contraseña se cierran tus sesiones en otros dispositivos.</p>
  ${img('cuenta', 'Menú Mi cuenta', 'movil')}
  ${nota('El <b>seguimiento por folio</b> no necesita sesión: el enlace "Seguir un envío con su folio" está en la misma pantalla de ingreso.')}
  ${nota('Las cuentas las crea el administrador (sección <b>Usuarios</b>). No hay registro público.')}`
  : `
  <h2 id="entrar">1.3 Cómo entrar (versión de demostración)</h2>
  <p>Esta versión todavía <b>no pide contraseña</b>: arriba a la derecha (o en <b>Más</b> en el celular) se elige el perfil con el que
  se quiere recorrer la plataforma: <b>Administrador</b>, <b>Cliente</b> o <b>Repartidor</b>. Si la demo publicada tiene clave,
  se pide una sola vez.</p>
  ${nota('El inicio de sesión con correo y contraseña para cada perfil se agrega en la siguiente versión; este manual se actualizará con esa pantalla.')}`;

const html = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><title>Manual de usuario</title><style>
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font-family: 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif; color: #1b2240; font-size: 10.5pt; line-height: 1.5; margin: 0; }
h1 { font-size: 22pt; color: #0a1a6b; margin: 0 0 6mm; page-break-before: always; border-bottom: 3px solid #e0218a; padding-bottom: 3mm; }
h1.sin-salto { page-break-before: avoid; }
h2 { font-size: 14pt; color: #1537d6; margin: 7mm 0 2mm; page-break-after: avoid; }
h3 { font-size: 11.5pt; color: #0a1a6b; margin: 5mm 0 1.5mm; page-break-after: avoid; }
p { margin: 0 0 2.5mm; }
b { color: #0a1a6b; }
figure { margin: 3mm auto; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; max-height: 205mm; border: 1px solid #c9d0ea; border-radius: 3mm; box-shadow: 0 1mm 3mm rgba(10,26,107,.15); }
figcaption { font-size: 8.5pt; color: #5b6390; margin-top: 1.5mm; font-style: italic; }
.par, .trio { display: flex; gap: 6mm; justify-content: center; align-items: flex-start; page-break-inside: avoid; }
.par figure { flex: 1; } .par figure img { max-height: 150mm; }
.trio figure { flex: 1; } .trio figure img { max-height: 120mm; }
.movil img { max-height: 170mm; }
.nota { background: #eef1fd; border-left: 4px solid #1537d6; padding: 2.5mm 4mm; border-radius: 2mm; margin: 3mm 0; page-break-inside: avoid; }
.nota.alerta { background: #fdeef6; border-color: #e0218a; }
ol.pasos { padding-left: 6mm; margin: 2mm 0 3mm; } ol.pasos li { margin-bottom: 1.2mm; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; page-break-inside: avoid; }
th { background: #0a1a6b; color: #fff; text-align: left; padding: 2mm; }
td { border-bottom: 1px solid #dde2f3; padding: 1.8mm 2mm; vertical-align: top; }
tr:nth-child(even) td { background: #f6f7fd; }
.portada { height: 250mm; display: flex; flex-direction: column; justify-content: center; text-align: center;
  background: linear-gradient(160deg, #0a1a6b, #1537d6 60%, #e0218a); color: #fff; border-radius: 6mm; padding: 20mm; }
.portada h1 { color: #fff; border: 0; font-size: 34pt; page-break-before: avoid; margin-bottom: 4mm; }
.portada p { font-size: 13pt; opacity: .95; } .portada .meta { margin-top: 18mm; font-size: 10pt; opacity: .85; }
.indice { columns: 2; column-gap: 10mm; } .indice a { color: #1b2240; text-decoration: none; display: block; padding: .8mm 0; }
.indice .n1 { font-weight: bold; color: #0a1a6b; margin-top: 2mm; }
.chip { display: inline-block; padding: .3mm 2.5mm; border-radius: 3mm; font-size: 8.5pt; font-weight: bold; color: #fff; background: #1537d6; }
.chip.m { background: #e0218a; } .chip.v { background: #0f8a5f; } .chip.g { background: #6b7280; } .chip.n { background: #c2410c; }
</style></head><body>

<div class="portada">
  <h1>Manual de usuario</h1>
  <p><b style="color:#fff">${conf.negocio.nombre}</b> · Plataforma de gestión de envíos</p>
  <p>Clientes · Repartidores · Administración</p>
  <div class="meta">Versión ${version} · ${conLogin ? 'con inicio de sesión' : 'versión de demostración'} · ${hoy}</div>
</div>

<h1>Contenido</h1>
<div class="indice">
  <a class="n1" href="#intro">1. Introducción</a><a href="#perfiles">1.1 Los tres perfiles</a><a href="#celular">1.2 Usar en el celular</a><a href="#entrar">1.3 Cómo entrar</a>
  <a class="n1" href="#conceptos">2. Conceptos clave</a><a href="#estados">2.1 Estados de un envío</a><a href="#tarifas">2.2 Tarifas</a><a href="#reglas">2.3 Reglas que la plataforma hace cumplir</a>
  <a class="n1" href="#cliente">3. Cliente</a><a href="#c-inicio">3.1 Inicio</a><a href="#c-nuevo">3.2 Crear un envío</a><a href="#c-pagar">3.3 Pagar</a><a href="#c-envios">3.4 Mis envíos y detalle</a><a href="#c-libreta">3.5 Destinatarios</a><a href="#c-seguro">3.6 Seguro y reclamos</a><a href="#seguimiento">3.7 Seguimiento por folio</a>
  <a class="n1" href="#repartidor">4. Repartidor</a><a href="#r-ruta">4.1 Mi ruta y envíos disponibles</a><a href="#r-retirar">4.2 Retirar</a><a href="#r-entregar">4.3 Llegar y entregar</a><a href="#r-fallido">4.4 Intento fallido</a><a href="#r-historial">4.5 Historial</a>
  <a class="n1" href="#admin">5. Administración</a><a href="#a-panel">5.1 Panel</a><a href="#a-envios">5.2 Envíos</a><a href="#a-detalle">5.3 Gestionar un envío</a><a href="#a-cobranza">5.4 Cobranza</a><a href="#a-seguros">5.5 Seguros</a><a href="#a-tarifas">5.6 Tarifas y reglas</a><a href="#a-usuarios">5.7 Usuarios</a><a href="#a-ajustes">5.8 Ajustes y costos</a>
  <a class="n1" href="#qr">6. QR y ticket</a>
  <a class="n1" href="#faq">7. Preguntas frecuentes</a>
  <a class="n1" href="#glosario">8. Glosario</a>
</div>

<h1 id="intro">1. Introducción</h1>
<p>La plataforma permite <b>crear, pagar, seguir y entregar envíos</b> dentro de Santiago. El cliente registra su envío y lo paga en línea;
un repartidor lo toma (o se lo asigna administración), lo retira y lo entrega con <b>foto y ubicación GPS</b> como constancia.
Administración controla la operación, los cobros, los seguros y las ganancias.</p>
<h2 id="perfiles">1.1 Los tres perfiles</h2>
${tabla(['Perfil', 'Qué hace', 'Qué NO puede hacer'], [
  ['<span class="chip">Cliente</span>', 'Crea envíos, los paga, imprime el ticket con QR, sigue sus envíos, guarda destinatarios y reclama el seguro.', 'Ver envíos de otros clientes, asignar repartidores, ver ganancias.'],
  ['<span class="chip m">Repartidor</span>', 'Ve su ruta, toma envíos pagados disponibles, los retira, registra la llegada y entrega con foto y GPS, o registra un intento fallido.', 'Ver montos ni tarifas, retirar un envío sin pagar, crear envíos.'],
  ['<span class="chip v">Administrador</span>', 'Ve y gestiona todo: envíos, asignaciones, pagos manuales, cobranza, seguros, tarifas, comunas, usuarios, costos y ganancias.', '—'],
])}
<h2 id="celular">1.2 Usar en el celular</h2>
<p>La plataforma está pensada primero para el teléfono. En el celular el menú queda <b>abajo</b>; las opciones que no caben están en <b>Más</b>.
Se puede <b>instalar como app</b>: en Android (Chrome) menú ⋮ → <b>Instalar aplicación</b>; en iPhone (Safari) botón Compartir → <b>Agregar a pantalla de inicio</b>.</p>
${par(img('a-panel-movil', 'Menú inferior en el celular (perfil administrador)', 'movil'), img('c-inicio', 'Inicio del cliente en el celular', 'movil'))}
${entrar}

<h1 id="conceptos">2. Conceptos clave</h1>
<h2 id="estados">2.1 Estados de un envío</h2>
<p>Cada envío avanza por estos estados. El historial de cada envío guarda quién hizo cada cambio y cuándo.</p>
${tabla(['Estado', 'Qué significa', 'Quién lo cambia'], [
  ['<span class="chip g">Borrador</span>', 'Envío guardado sin confirmar (no tiene folio).', 'Cliente / administración'],
  ['<span class="chip">Creado</span>', 'Confirmado, con folio ENV-AAAA-NNNNNN. Falta pagar y/o asignar repartidor.', 'Cliente al confirmar'],
  ['<span class="chip">Asignado</span>', 'Tiene repartidor (lo tomó él o lo asignó administración).', 'Repartidor (Tomar) o administración'],
  ['<span class="chip m">En ruta</span>', 'El repartidor lo retiró. <b>Solo es posible si está pagado.</b>', 'Repartidor'],
  ['<span class="chip v">Entregado</span>', 'Entregado con foto obligatoria y GPS.', 'Repartidor'],
  ['<span class="chip n">Fallido</span>', 'No se pudo entregar (con motivo). Suma un intento.', 'Repartidor'],
  ['<span class="chip">Reagendado</span>', 'Administración programa un nuevo intento (máximo ' + op.intentos_max + ' intentos).', 'Administración'],
  ['<span class="chip g">Devuelto</span>', 'Se devuelve al origen (por ejemplo, al agotar los intentos).', 'Administración'],
  ['<span class="chip g">Anulado</span>', 'Cancelado con motivo.', 'Cliente (si no está pagado) o administración'],
])}
<p>Además, cada envío tiene un <b>estado de pago</b>: <span class="chip n">Pago pendiente</span> o <span class="chip v">Pagado</span>.</p>
<h2 id="tarifas">2.2 Tarifas</h2>
${tabla(['Concepto', 'Valor actual'], [
  ['Envío dentro de Santiago (comunas en cobertura)', clp(t.base)],
  ['Límite de la tarifa estándar por bulto', `${t.peso_max_kg} kg y ${t.dim_max_cm}×${t.dim_max_cm}×${t.dim_max_cm} cm`],
  ['Bulto adicional a domicilio', clp(t.bulto_adicional_domicilio)],
  ['Bulto adicional a punto Blue Express, Starken u otro', t.bulto_adicional_punto ? clp(t.bulto_adicional_punto) : 'Sin costo (sin límite de bultos)'],
  ['Envío especial por horario (con franja)', `+ ${clp(t.recargo_horario_especial)}`],
  ['Paquetes sobre el límite', 'Cotización especial: solo administración puede crearlos con tarifa manual'],
])}
${nota('Los valores los cambia administración en <b>Tarifas</b>; aplican a los envíos nuevos. Una comuna puede tener tarifa propia.')}
<h2 id="reglas">2.3 Reglas que la plataforma hace cumplir</h2>
${tabla(['Regla', 'Detalle'], [
  ['Pago previo', 'Sin pago verificado el repartidor <b>no puede retirar</b> el envío.'],
  ['Pago verificado', 'Un envío queda "Pagado" solo si el pago calza en monto exacto y tiene número de transacción, o si administración lo registra a mano.'],
  ['Foto y GPS', 'Toda entrega exige <b>foto</b>' + (op.gps_obligatorio ? ' y <b>ubicación GPS</b>' : '') + '.'],
  ['Espera máxima', `Tras pulsar "Llegué", el repartidor espera hasta <b>${op.espera_max_min} minutos</b>; recién ahí puede usar el motivo "espera excedida".`],
  ['Intentos', `Máximo <b>${op.intentos_max} intentos</b> de entrega; después corresponde devolver.`],
  ['Seguro', 'Para cobrar el seguro la <b>boleta de compra es obligatoria</b>; el monto no supera el valor declarado ni la boleta.'],
  ['Privacidad', 'El repartidor no ve montos; el seguimiento público no muestra nombres ni teléfonos; las fotos no guardan la ubicación del teléfono.'],
])}

<h1 id="cliente">3. Cliente</h1>
<h2 id="c-inicio">3.1 Inicio</h2>
<p>Muestra un resumen: envíos <b>en curso</b>, <b>por pagar</b> (con el total), <b>entregados</b> y el total. Si hay envíos sin pagar aparece un aviso,
porque el repartidor no puede retirarlos. Desde aquí se crea un envío o se sigue un folio.</p>
<h2 id="c-nuevo">3.2 Crear un envío (4 pasos)</h2>
<p>Menú <b>Nuevo envío</b>. El asistente guía en cuatro pasos; los campos con * son obligatorios y los errores se marcan en rojo en el mismo campo.</p>
<h3>Paso 1 · Destinatario</h3>
<p>Elige a alguien de tu <b>libreta</b> (se puede buscar por nombre o teléfono) o crea un <b>nuevo destinatario</b> con nombre y teléfono móvil
(+56 9 XXXX XXXX). Correo y RUT son opcionales. Los destinatarios nuevos quedan guardados en tu libreta.</p>
<h3>Paso 2 · Destino</h3>
<p>Elige <b>A domicilio</b> o <b>Punto Blue / Starken / otro</b>. En punto courier indica la empresa, el punto o sucursal y, si tienes, el código del envío.
Luego elige una dirección guardada o escribe una nueva (calle, número, depto, <b>comuna</b> y referencia). Solo aparecen las comunas en cobertura.</p>
${par(img('c-nuevo-1', 'Paso 1: destinatario nuevo', 'movil'), img('c-nuevo-2', 'Paso 2: dirección de entrega', 'movil'))}
<h3>Paso 3 · Paquete</h3>
<p>Describe el producto e indica <b>bultos</b>, <b>peso por bulto</b> (kg) y <b>medidas</b> en centímetros enteros. La tarifa se calcula al instante.
En <b>Seguro del envío</b> escribe el <b>valor declarado</b> (tope de la indemnización) y, si la tienes, adjunta la <b>boleta de compra</b>
(la necesitarás para cobrar el seguro; también puedes subirla después). Marca <b>Envío especial por horario</b> si necesitas una franja (+${clp(t.recargo_horario_especial)}).
Opcional: foto del paquete y observaciones (por ejemplo "frágil").</p>
<h3>Paso 4 · Confirmar</h3>
<p>Revisa el resumen y la tarifa y pulsa <b>Confirmar envío</b>. Se asigna el folio y aparece la pantalla de éxito.</p>
${par(img('c-nuevo-3', 'Paso 3: paquete, seguro y horario', 'movil'), img('c-nuevo-4', 'Paso 4: resumen y tarifa', 'movil'))}
${alerta(`Si el paquete supera ${t.peso_max_kg} kg o ${t.dim_max_cm} cm por lado, la plataforma no deja continuar con la tarifa estándar: contacta a administración para una cotización especial.`)}
<h3>Pantalla de envío confirmado</h3>
<p>Muestra el <b>folio</b>, el <b>código QR</b>, el total y los botones: <b>Pagar</b>, <b>Ticket 80 mm</b> (impresora térmica), <b>Ticket A4</b>,
<b>Compartir por WhatsApp</b> (envía el enlace de seguimiento al destinatario), <b>Ver detalle</b> y <b>Crear otro envío</b>.</p>
${img('c-exito', 'Envío confirmado con folio, QR y opciones', 'movil')}
<h2 id="c-pagar">3.3 Pagar</h2>
<p>Pulsa <b>Pagar</b> en la pantalla de éxito o en el detalle del envío. Se abre la ventana de pago; al aprobarse, el envío queda <b>Pagado</b>
y aparece a los repartidores como disponible. Si el pago es rechazado puedes volver a intentarlo.</p>
${img('c-pago', 'Ventana de pago del envío', 'movil')}
${nota(conf.pagos.proveedor === 'simulado' ? 'En esta versión el pago es <b>simulado</b> (no se cobra dinero real). En la etapa de desarrollo se conecta la pasarela elegida (Flow, Webpay, Mercado Pago o Khipu).' : 'El pago se procesa en la pasarela del comercio.')}
${nota('También puedes pagar por transferencia o en efectivo: administración lo registra como <b>pago manual</b>.')}
<h2 id="c-envios">3.4 Mis envíos y detalle</h2>
<p><b>Mis envíos</b> lista todos tus envíos con su estado y si están pagados. Puedes <b>buscar</b> por folio, nombre, teléfono, calle o comuna,
filtrar por <b>estado</b> y <b>fechas</b>, y <b>Exportar a Excel (CSV)</b> lo que estás viendo.</p>
<p>Al abrir un envío ves: la barra de progreso, el destino con botones a Google Maps y Waze, el paquete y la tarifa, el seguro, el QR,
la <b>constancia de entrega</b> (fecha, quién recibió, GPS con enlace al mapa y foto) y el <b>historial</b> completo.
Mientras esté <b>Creado</b> y sin pagar puedes <b>Anular</b> el envío indicando un motivo.</p>
${img('c-envios', 'Mis envíos', 'movil')}
${img('c-detalle', 'Detalle de un envío entregado, con constancia de entrega e historial')}
<h2 id="c-libreta">3.5 Destinatarios (libreta)</h2>
<p>Cada destinatario puede tener <b>varias direcciones</b> (por ejemplo, si se cambia de casa). Desde aquí puedes crear destinatarios,
<b>agregar direcciones</b>, marcar una como <b>Principal</b> (se propone primero al crear un envío) o <b>Quitar</b> una dirección
(se oculta, pero se conserva en los envíos anteriores).</p>
${img('c-libreta', 'Libreta de destinatarios con sus direcciones', 'movil')}
<h2 id="c-seguro">3.6 Seguro y reclamos</h2>
<p>Si el envío tiene <b>valor declarado</b>, en su detalle aparece <b>Reclamar seguro</b>. Completa el motivo (pérdida, daño, robo u otro),
la descripción, la <b>boleta</b> (archivo o la que ya adjuntaste), su número, fecha y monto, y el <b>monto a reclamar</b>.</p>
${alerta('Sin boleta no se puede reclamar. El monto reclamado no puede superar el valor declarado ni el monto de la boleta. Solo hay un reclamo activo por envío.')}
${img('c-reclamo', 'Formulario de reclamo de seguro')}
<p>En <b>Seguros</b> sigues el estado de tus reclamos: Solicitado → En revisión → Aprobado o Rechazado → Pagado.</p>
${img('c-seguros', 'Mis reclamos de seguro')}
<h2 id="seguimiento">3.7 Seguimiento por folio</h2>
<p>Cualquier persona (por ejemplo el destinatario) puede ver el estado de un envío ingresando el folio en <b>Seguimiento</b> o abriendo el
enlace compartido por WhatsApp. Solo se muestra el estado, la comuna y el historial: <b>no aparecen nombres, teléfonos ni direcciones</b>.</p>
${img('seguimiento', 'Seguimiento público por folio', 'movil')}

<h1 id="repartidor">4. Repartidor</h1>
<h2 id="r-ruta">4.1 Mi ruta y envíos disponibles</h2>
<p><b>Mi ruta</b> es la pantalla principal del repartidor. Arriba ve cuántos envíos tiene en ruta, por retirar, cerrados hoy y disponibles. Tiene tres secciones:</p>
${tabla(['Sección', 'Qué contiene'], [
  ['En ruta', 'Envíos que ya retiró y debe entregar.'],
  ['Por retirar / reintentar', 'Envíos asignados a él, reagendados o con intento fallido.'],
  ['Disponibles para tomar', 'Envíos <b>pagados que nadie ha tomado</b>, de <b>cualquier zona</b>. Pulsa <b>Tomar</b> y pasan a su ruta. Si otro repartidor lo tomó antes, la app lo avisa.'],
])}
${img('r-ruta', 'Mi ruta con envíos en ruta, por retirar y disponibles para tomar', 'movil')}
${nota('Los envíos sin pagar no aparecen como disponibles. Si administración desactiva la opción de tomar envíos, el repartidor solo ve los que le asignan.')}
<h2 id="r-retirar">4.2 Retirar</h2>
<p>Abre el envío: ve el folio, la dirección en grande, la comuna, el destinatario con su teléfono (se puede llamar tocándolo), el paquete,
avisos de horario especial o punto courier y los botones <b>Ir con Google Maps</b> e <b>Ir con Waze</b>. Pulsa <b>Retirar y salir a ruta</b>.</p>
${par(img('r-asignado', 'Envío por retirar', 'movil'), img('r-en-ruta', 'Envío en ruta: Llegué, Entregar o No se pudo entregar', 'movil'))}
<h2 id="r-entregar">4.3 Llegar y entregar</h2>
${pasos([
  'Al llegar, pulsa <b>Llegué al destino</b>: comienza el contador de espera de ' + op.espera_max_min + ' minutos.',
  'Pulsa <b>Entregar</b>. Toma la <b>foto de la entrega</b> (obligatoria) con la cámara del teléfono.',
  'La app obtiene la <b>ubicación GPS</b>; cuando dice "Ubicación lista" se habilita el botón. Si el permiso de ubicación está bloqueado, actívalo en el navegador.',
  'Opcional: escribe quién recibe. Pulsa <b>Confirmar entrega</b>.',
])}
${par(img('r-espera', 'Contador de espera tras "Llegué"', 'movil'), img('r-entregar', 'Cierre de entrega con foto y GPS', 'movil'))}
<h2 id="r-fallido">4.4 Intento fallido</h2>
<p>Si no se puede entregar, pulsa <b>No se pudo entregar</b>, elige el motivo (nadie en el domicilio, dirección incorrecta, rechazo, punto cerrado,
espera excedida u otro) y confirma. Queda registrado con la ubicación. El motivo <b>espera excedida</b> solo se habilita
cuando se cumplen los ${op.espera_max_min} minutos desde "Llegué". Administración decide si se <b>reagenda</b> o se <b>devuelve</b>.</p>
${img('r-fallido', 'Registrar un intento fallido con motivo', 'movil')}
<h2 id="r-historial">4.5 Historial</h2>
<p>En <b>Historial</b> el repartidor busca todos sus envíos (sin montos).</p>
${img('r-historial', 'Historial del repartidor', 'movil')}

<h1 id="admin">5. Administración</h1>
<h2 id="a-panel">5.1 Panel</h2>
<p>Resumen del período elegido (Hoy, Mes o fechas a medida): <b>ganancia neta</b> (ingresos de envíos entregados menos costos),
<b>ingresos</b>, <b>costos</b> por tipo, <b>cobrado</b> en el período, gráfico de ingresos por día, comunas con más ingresos,
envíos <b>sin asignar</b>, desempeño de <b>repartidores</b> y el estado de la operación (con aviso de reclamos por revisar).</p>
${img('a-panel', 'Panel de administración')}
<h2 id="a-envios">5.2 Envíos</h2>
<p>Registro completo con búsqueda y filtros por estado, <b>repartidor</b> (incluye "Sin asignar") y fechas. <b>Exportar a Excel (CSV)</b> descarga lo filtrado.
Administración también puede crear envíos a nombre de un cliente (menú <b>Nuevo</b>), incluida la <b>tarifa manual</b> para paquetes sobre el límite.</p>
${img('a-envios', 'Registro de envíos con filtros')}
<h2 id="a-detalle">5.3 Gestionar un envío</h2>
<p>En el detalle, el recuadro <b>Administración</b> muestra las acciones posibles según el estado:</p>
${tabla(['Acción', 'Cuándo', 'Qué hace'], [
  ['Repartidor asignado', 'Creado, Asignado o Reagendado', 'Asigna, cambia o quita el repartidor (un reagendado siempre debe quedar con uno).'],
  ['Registrar pago manual', 'Pago pendiente', 'Marca el envío como pagado por transferencia, efectivo u otro, con número de operación. Queda como pago verificado por el administrador.'],
  ['Reagendar', 'Fallido, con intentos disponibles', 'Programa un nuevo intento.'],
  ['Devolver al origen', 'Fallido', 'Cierra el envío como devuelto.'],
  ['Anular envío', 'Creado o Asignado', 'Cancela el envío con motivo (si estaba pagado no hay reembolso automático).'],
])}
${img('a-asignar', 'Envío pagado sin repartidor: elegir repartidor')}
${img('a-fallido', 'Envío con intento fallido: reagendar o devolver')}
${img('a-pago-manual', 'Registrar un pago manual')}
<h2 id="a-cobranza">5.4 Cobranza</h2>
<p>Controla que cada pago sea real: <b>Cobrado (verificado)</b>, <b>Comisiones de pago</b>, <b>Por cobrar</b> (envíos confirmados sin pagar y su antigüedad)
y <b>Abonos por llegar</b> (dinero que la pasarela aún no deposita). La tabla <b>Pagos</b> muestra cómo se verificó cada uno y su número de transacción.
Con <b>Conciliar</b> se registra lo que realmente llegó a la cuenta según la cartola; la diferencia queda como costo "pasarela".
El comparador <b>¿Qué proveedor de pago conviene?</b> calcula el costo por envío y al mes de cada pasarela.</p>
${img('a-cobranza', 'Cobranza: pagos verificados, por cobrar, abonos y comparador de proveedores')}
<h2 id="a-seguros">5.5 Seguros</h2>
<p>Lista de reclamos con su boleta (enlace para verla). Flujo: <b>Revisar</b> → <b>Resolver</b> (aprobar con monto o rechazar con nota obligatoria)
→ <b>Pagar</b>. Al pagar, la indemnización se registra como costo "seguro" y descuenta de la ganancia.</p>
${img('a-reclamos', 'Reclamos de seguro')}
<h2 id="a-tarifas">5.6 Tarifas y reglas</h2>
<p><b>Tarifas</b>: tarifa base, recargo por horario, bultos adicionales y límites de peso y medidas. <b>Operación</b>: intentos máximos, espera en destino,
qué abre el QR, GPS obligatorio y si los repartidores pueden <b>tomar envíos</b>. <b>Cobertura por comuna</b>: activa o desactiva cada comuna y
define una tarifa propia (vacía = tarifa base).</p>
${img('a-tarifas', 'Tarifas, reglas de operación y cobertura por comuna')}
<h2 id="a-usuarios">5.7 Usuarios</h2>
<p>Crea usuarios (nombre, correo, perfil, teléfono y <b>contraseña inicial</b>, que la plataforma propone al azar) y los activa o desactiva.
La tabla muestra el <b>último acceso</b> de cada persona. Un repartidor con envíos en curso no se puede desactivar hasta reasignarlos,
y un administrador no puede quitarse su propio acceso.${conLogin ? ' Con <b>Contraseña</b> se asigna una clave temporal a quien la olvidó: se cierran sus sesiones abiertas y, al entrar, se le pide crear una propia. Desactivar a alguien también cierra su sesión de inmediato.' : ''}</p>
${img('a-usuarios', 'Usuarios de la plataforma')}
<h2 id="a-ajustes">5.8 Ajustes y costos</h2>
<p><b>Empresa</b>: nombre, RUT, teléfono, correo y logo (aparecen en la app y en el ticket). <b>Ticket</b>: texto al pie.
<b>Costos del mes</b>: registra bencina, comisiones de repartidores, peajes, mantención u otros; descuentan de la ganancia neta.</p>
${img('a-ajustes', 'Ajustes de la empresa, ticket y costos')}

<h1 id="qr">6. QR y ticket</h1>
<p>Cada envío confirmado tiene un <b>ticket</b> (80 mm para impresora térmica o A4) con folio, destino, paquete, estado de pago y un <b>código QR</b>.
Al escanear el QR se abre una página con la dirección y los botones <b>Ir con Google Maps</b> e <b>Ir con Waze</b> (sin teléfono ni nombre del destinatario).
Administración puede hacer que el QR abra Google Maps o Waze directamente (Tarifas → Operación).</p>
${img('qr', 'Página que abre el QR del ticket', 'movil')}
${nota('El ticket es un comprobante interno: <b>no es boleta ni factura</b>. La emisión de documentos tributarios queda para una etapa posterior.')}

<h1 id="faq">7. Preguntas frecuentes</h1>
${tabla(['Pregunta', 'Respuesta'], [
  ...(conLogin ? [
    ['Olvidé mi contraseña.', 'Administración te asigna una temporal en <b>Usuarios → Contraseña</b>; al entrar con ella se te pedirá crear una propia.'],
    ['Dice "Demasiados intentos fallidos".', 'La cuenta se bloquea 15 minutos tras 5 intentos fallidos. Espera o pide una contraseña nueva a administración.'],
    ['La app me sacó y pide iniciar sesión otra vez.', 'Tu contraseña cambió (o administración la cambió o te desactivó). Entra con la contraseña vigente.'],
  ] : []),
  ['Creé un envío y el repartidor no lo ve.', 'Revisa que esté <b>pagado</b>. Los envíos pagados aparecen en <b>Disponibles para tomar</b> de todos los repartidores; si nadie lo toma, administración puede asignarlo en el detalle del envío.'],
  ['El repartidor no puede retirar.', 'El envío no está pagado. El cliente debe pagarlo o administración registrar un pago manual.'],
  ['No se habilita "Confirmar entrega".', 'Falta la foto o la ubicación GPS. Activa el permiso de ubicación del navegador para la plataforma y vuelve a abrir la ventana.'],
  ['No aparece la opción "espera excedida".', `Primero se debe pulsar "Llegué" y esperar ${op.espera_max_min} minutos.`],
  ['No puedo reagendar.', `Se alcanzó el máximo de ${op.intentos_max} intentos: corresponde devolver el envío.`],
  ['Mi comuna no aparece.', 'Está fuera de la cobertura. Administración puede activarla en Tarifas → Cobertura por comuna.'],
  ['El paquete pesa más de lo permitido.', 'Pide una cotización especial a administración; solo el administrador puede crear el envío con tarifa manual.'],
  ['No puedo anular mi envío.', 'El cliente solo anula envíos Creados y sin pagar. En otros casos, pídelo a administración.'],
  ['El reclamo de seguro no avanza.', 'La boleta es obligatoria, y el monto no puede superar el valor declarado ni la boleta.'],
  ['No veo los cambios nuevos en la app instalada.', 'Cierra la app y vuelve a abrirla (se actualiza sola).'],
])}

<h1 id="glosario">8. Glosario</h1>
${tabla(['Término', 'Significado'], [
  ['Folio', 'Número único del envío, formato ENV-AAAA-NNNNNN. Se usa para seguimiento y reclamos.'],
  ['Valor declarado', 'Valor del contenido según el cliente; es el tope de la indemnización del seguro.'],
  ['Punto courier', 'Sucursal de Blue Express, Starken u otra empresa donde se deja el paquete.'],
  ['Pago verificado', 'Pago cuyo monto y transacción fueron confirmados por la pasarela o por administración.'],
  ['Conciliación', 'Comparar lo cobrado con lo que realmente llegó a la cuenta bancaria.'],
  ['Comisión de pasarela', 'Lo que cobra el proveedor de pagos por cada transacción.'],
  ['Cobertura', 'Comunas donde se hacen entregas a la tarifa estándar.'],
  ['Constancia de entrega', 'Foto, fecha, hora y ubicación GPS registradas al entregar.'],
])}
</body></html>`;

// ---------- PDF ----------
fs.mkdirSync(path.dirname(salida), { recursive: true });
const navegador = await chromium.launch({ executablePath: ejecutable || undefined });
const pagina = await navegador.newPage();
await pagina.setContent(html, { waitUntil: 'load' });
await pagina.pdf({
  path: salida, format: 'A4', printBackground: true, displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:8px;color:#5b6390;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial">
    <span>Manual de usuario · ${conf.negocio.nombre.replace(/[<>&]/g, '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
});
await navegador.close();
const faltan = ['c-inicio', 'c-nuevo-1', 'r-ruta', 'a-panel'].filter((k) => !fotos[k]);
console.log(`✔ Manual generado: ${path.relative(raiz, salida)} (${Object.keys(fotos).length} capturas, ${(fs.statSync(salida).size / 1e6).toFixed(1)} MB)`);
for (const a of avisos) console.warn(`⚠ ${a}`);
if (faltan.length) { console.error(`✖ Faltan capturas esenciales: ${faltan.join(', ')}`); process.exit(1); }
