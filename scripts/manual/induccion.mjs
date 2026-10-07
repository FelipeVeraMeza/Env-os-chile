// Guía de inducción: material para la sesión de capacitación con el cliente (administración, clientes y repartidores).
// A diferencia del manual (referencia de cada pantalla), esta guía es práctica: agenda, ejercicios paso a paso,
// verificación de lo aprendido, rutina diaria, buenas prácticas de seguridad y acta de la inducción.
import { crearPiezas, CSS } from './piezas.mjs';

export function htmlInduccion({ fotos, conf, modo, version, hoy }) {
  const { img, par, nota, alerta, pasos, tabla, check, ejercicio } = crearPiezas(fotos);
  const conLogin = modo !== 'demo';
  const clp = (n) => `$${Number(n).toLocaleString('es-CL')}`;
  const t = conf.tarifas;
  const op = conf.operacion;
  const empresa = conf.negocio.nombre;

  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><title>Guía de inducción</title><style>${CSS}</style></head><body>

<div class="portada">
  <h1>Guía de inducción</h1>
  <p><b style="color:#fff">${empresa}</b> · Plataforma de gestión de envíos</p>
  <p>Capacitación para administración, clientes y repartidores</p>
  <div class="meta">Versión ${version} · ${hoy} · Duración sugerida: 2 horas</div>
</div>

<h1>Cómo usar esta guía</h1>
<p>Esta guía acompaña la <b>sesión de inducción</b>: cada participante hace los ejercicios en su propio teléfono o computador con datos de prueba.
Al final se completa el <b>acta</b> (última página). Para el detalle de cada pantalla, consulta el <b>Manual de usuario</b>.</p>
<h2>Agenda de la sesión</h2>
${tabla(['Tiempo', 'Tema', 'Participan'], [
  ['10 min', '1. Qué es la plataforma y cómo funciona un envío de principio a fin', 'Todos'],
  ['15 min', `2. Primer ingreso${conLogin ? ', contraseña propia' : ''} e instalación en el teléfono`, 'Todos'],
  ['25 min', '3. Práctica del cliente: crear, pagar, imprimir y compartir un envío', 'Clientes y administración'],
  ['25 min', '4. Práctica del repartidor: tomar, retirar, llegar y entregar con foto y GPS', 'Repartidores y administración'],
  ['30 min', '5. Práctica de administración: asignar, cobrar, seguros, usuarios y seguridad', 'Administración'],
  ['10 min', '6. Seguridad para todos y qué hacer ante problemas', 'Todos'],
  ['5 min', '7. Preguntas y firma del acta', 'Todos'],
])}
<h2>Antes de la sesión (administración)</h2>
${check([
  'Nombre, RUT, teléfono, correo y logo de la empresa cargados en <b>Ajustes</b>.',
  `Tarifas revisadas en <b>Tarifas</b> (base ${clp(t.base)}, horario especial +${clp(t.recargo_horario_especial)}, límites ${t.peso_max_kg} kg / ${t.dim_max_cm} cm).`,
  'Comunas en cobertura revisadas (Tarifas → Cobertura por comuna).',
  `Un usuario creado para cada participante en <b>Usuarios</b>${conLogin ? ', con su contraseña temporal anotada para entregarla en persona' : ''}.`,
  'Teléfonos de los repartidores con internet, cámara y ubicación (GPS) funcionando.',
  'Un envío de prueba a una dirección real cercana para practicar la entrega.',
  'Impresora térmica (80 mm) o A4 disponible si se usará el ticket impreso.',
])}

<h1>1. Cómo funciona un envío</h1>
${tabla(['Paso', 'Quién', 'Qué pasa'], [
  ['1. Crear', 'Cliente', 'Registra destinatario, dirección y paquete. Recibe un folio (ENV-AAAA-NNNNNN) y un QR.'],
  ['2. Pagar', 'Cliente', `Paga ${clp(t.base)} (u otra tarifa). <b>Sin pago no se puede retirar.</b>`],
  ['3. Tomar / asignar', 'Repartidor o administración', 'El envío pagado aparece a todos los repartidores; uno lo toma (o administración lo asigna).'],
  ['4. Retirar', 'Repartidor', 'Lo retira y sale a ruta con Google Maps o Waze.'],
  ['5. Entregar', 'Repartidor', `Pulsa "Llegué" (espera máxima ${op.espera_max_min} min) y entrega con <b>foto y GPS</b>. Si no puede, registra un intento fallido (máx. ${op.intentos_max}).`],
  ['6. Seguimiento', 'Destinatario', 'Sigue el estado con el folio o el enlace de WhatsApp, sin ver datos personales.'],
])}
${nota('Toda acción queda registrada con fecha, hora y usuario en el historial del envío.')}

<h1>2. Primer ingreso</h1>
${conLogin ? `
${ejercicio('Ejercicio 2.1 · Entrar y crear tu contraseña', `
${pasos([
  'Abre la dirección de la plataforma que te entregó administración.',
  'Escribe tu correo y la <b>contraseña temporal</b> que te entregaron en persona.',
  'La plataforma te pide <b>crear tu propia contraseña</b>: mínimo 8 caracteres, con letras y números, que no sea común ni contenga tu nombre o correo.',
  'Guárdala en un lugar seguro. <b>No la compartas con nadie</b>, ni siquiera con compañeros.',
])}
${par(img('login', 'Pantalla de ingreso', 'movil'), img('obligatorio', 'Crear la contraseña propia', 'movil'))}`)}` : `
${nota('En esta versión de demostración se elige el perfil sin contraseña. Con el inicio de sesión activado, cada persona entra con su correo y contraseña.')}`}
${ejercicio('Ejercicio 2.2 · Instalar la app en el teléfono', `
${pasos([
  '<b>Android (Chrome):</b> menú ⋮ → <b>Instalar aplicación</b> (o "Agregar a pantalla principal").',
  '<b>iPhone (Safari):</b> botón Compartir → <b>Agregar a pantalla de inicio</b>.',
  'Abre la app desde el ícono nuevo. Permite <b>cámara</b> y <b>ubicación</b> cuando lo pida (los repartidores los necesitan para entregar).',
])}`)}
${conLogin ? `${ejercicio('Ejercicio 2.3 · Conocer "Mi cuenta"', `
<p>Toca tu nombre (arriba a la derecha, o <b>Más</b> en el celular). Ubica <b>Cambiar contraseña</b>, <b>Cerrar sesión en mis otros dispositivos</b> y <b>Cerrar sesión</b>.</p>
${img('cuenta', 'Menú Mi cuenta', 'movil')}`)}` : ''}

<h1>3. Práctica del cliente</h1>
${ejercicio('Ejercicio 3.1 · Crear un envío', `
${pasos([
  'Menú <b>Nuevo envío</b>. Paso 1: elige <b>Nuevo destinatario</b> y escribe nombre y teléfono (+56 9 …).',
  'Paso 2: <b>A domicilio</b>; escribe calle, número, depto, <b>comuna</b> y una referencia útil para el repartidor.',
  `Paso 3: describe el producto, bultos, peso y medidas. Escribe un <b>valor declarado</b> (tope del seguro). Prueba marcar <b>horario especial</b> y mira cómo cambia la tarifa (+${clp(t.recargo_horario_especial)}).`,
  'Paso 4: revisa el resumen y pulsa <b>Confirmar envío</b>. Anota el <b>folio</b>.',
])}
${par(img('c-nuevo-1', 'Paso 1', 'movil'), img('c-nuevo-2', 'Paso 2', 'movil'))}
${par(img('c-nuevo-3', 'Paso 3', 'movil'), img('c-nuevo-4', 'Paso 4', 'movil'))}`)}
${ejercicio('Ejercicio 3.2 · Pagar, imprimir y compartir', `
${pasos([
  'En la pantalla de confirmación pulsa <b>Pagar</b> y completa el pago.',
  'Pulsa <b>Ticket 80 mm</b> o <b>Ticket A4</b> e imprímelo; pégalo en el paquete (el QR abre la ruta para el repartidor).',
  'Pulsa <b>Compartir por WhatsApp</b> y envíale el seguimiento al destinatario.',
])}
${par(img('c-exito', 'Envío confirmado', 'movil'), img('c-pago', 'Pago del envío', 'movil'))}`)}
${ejercicio('Ejercicio 3.3 · Seguir, buscar y reclamar', `
${pasos([
  'Menú <b>Mis envíos</b>: busca tu envío por folio o nombre y ábrelo. Revisa la barra de progreso y el historial.',
  'Menú <b>Destinatarios</b>: agrega una segunda dirección a tu destinatario y márcala como <b>Principal</b>.',
  'Abre un envío <b>entregado</b> con valor declarado y ubica <b>Reclamar seguro</b> (sin enviarlo): la boleta es obligatoria.',
])}
${img('c-detalle', 'Detalle de un envío entregado con su constancia')}`)}
<h3>El cliente ya sabe…</h3>
${check(['Crear un envío a domicilio y a un punto Blue Express / Starken', 'Pagar un envío y saber que sin pago no se retira', 'Imprimir el ticket con QR y compartir el seguimiento', 'Buscar sus envíos y ver la constancia de entrega (foto y GPS)', 'Usar la libreta de destinatarios', 'Cuándo y cómo reclamar el seguro (con boleta)'])}

<h1>4. Práctica del repartidor</h1>
${ejercicio('Ejercicio 4.1 · Tomar un envío', `
${pasos([
  'Abre <b>Mi ruta</b>. En <b>Disponibles para tomar</b> aparecen los envíos pagados que nadie ha tomado, <b>de cualquier zona</b>.',
  'Pulsa <b>Tomar</b> en el envío de prueba. Pasa a <b>Por retirar</b>. (Si otro repartidor lo tomó antes, la app te avisa.)',
])}
${img('r-ruta', 'Mi ruta con envíos disponibles para tomar', 'movil')}`)}
${ejercicio('Ejercicio 4.2 · Retirar, llegar y entregar', `
${pasos([
  'Abre el envío y pulsa <b>Paquete retirado</b>. Usa <b>Ir con Google Maps</b> o <b>Ir con Waze</b>.',
  `Al llegar pulsa <b>Llegué al destino</b>: empieza el contador de ${op.espera_max_min} minutos.`,
  'Pulsa <b>Entregar</b>, toma la <b>foto</b> de la entrega, espera "Ubicación lista", escribe quién recibe y pulsa <b>Confirmar entrega</b>.',
])}
${par(img('r-en-ruta', 'Envío en ruta', 'movil'), img('r-entregar', 'Cierre con foto y GPS', 'movil'))}`)}
${ejercicio('Ejercicio 4.3 · Registrar un intento fallido', `
${pasos([
  'En otro envío de prueba pulsa <b>No se pudo entregar</b> y elige un motivo (por ejemplo "Nadie en el domicilio").',
  `Observa que <b>Espera excedida</b> solo se habilita tras ${op.espera_max_min} minutos desde "Llegué".`,
])}
${img('r-fallido', 'Motivos del intento fallido', 'movil')}`)}
<h3>El repartidor ya sabe…</h3>
${check(['Tomar envíos disponibles y ver su ruta', 'Que un envío sin pagar no se puede retirar', 'Navegar con Google Maps o Waze', 'Registrar la llegada y respetar la espera máxima', 'Entregar con foto y GPS (y activar permisos si fallan)', 'Registrar un intento fallido con el motivo correcto'])}

<h1>5. Práctica de administración</h1>
${ejercicio('Ejercicio 5.1 · Controlar la operación', `
${pasos([
  '<b>Panel</b>: revisa ganancia neta, ingresos, costos y el recuadro <b>Sin asignar</b>.',
  '<b>Envíos</b>: filtra por "Sin asignar", abre uno y asígnalo a un repartidor. Luego cámbialo a otro.',
  'En un envío sin pagar, pulsa <b>Registrar pago manual</b> (transferencia, con número de operación).',
  'En un envío con intento fallido, practica <b>Reagendar</b> y conoce <b>Devolver al origen</b>.',
])}
${img('a-panel', 'Panel de administración')}`)}
${ejercicio('Ejercicio 5.2 · Cobranza y seguros', `
${pasos([
  '<b>Cobranza</b>: revisa lo cobrado, lo que falta por cobrar y los abonos por llegar. Usa el comparador de proveedores de pago.',
  '<b>Seguros</b>: abre un reclamo, revisa la boleta, resuélvelo (aprobar con monto o rechazar con nota) y conoce <b>Pagar</b>.',
])}
${img('a-cobranza', 'Cobranza')}`)}
${ejercicio('Ejercicio 5.3 · Usuarios y seguridad', `
${pasos([
  `<b>Usuarios → Nuevo usuario</b>: crea un cliente de prueba${conLogin ? ' (la contraseña temporal se propone sola)' : ''}.`,
  conLogin ? 'Con <b>Contraseña</b> asígnale una clave nueva y con <b>Cerrar sesiones</b> ciérrale las sesiones abiertas.' : 'Activa y desactiva el usuario de prueba.',
  '<b>Seguridad</b>: revisa las alertas, la tabla "¿Quién sacó datos?" y las IPs sospechosas. Marca una alerta como revisada con una nota.',
  'Ubica el botón <b>Cerrar todas las sesiones</b> (no lo pulses en la práctica): es para emergencias.',
])}
${img('a-seguridad', 'Panel de seguridad')}`)}
<h3>Administración ya sabe…</h3>
${check(['Asignar y reasignar repartidores', 'Registrar pagos manuales y revisar la cobranza', 'Reagendar, devolver y anular envíos', 'Resolver y pagar reclamos de seguro', 'Crear usuarios, asignar contraseñas y cerrar sesiones', 'Revisar el panel de Seguridad y responder a una alerta', 'Cambiar tarifas, comunas y datos de la empresa'])}

<h1>6. Seguridad para todos</h1>
${tabla(['Hacer', 'No hacer'], [
  ['Usar una contraseña propia, larga y con números', 'Usar la misma contraseña de otros sitios, o 12345678'],
  ['Cerrar sesión en computadores compartidos', 'Dejar la sesión abierta en un equipo ajeno'],
  ['Avisar de inmediato a administración si pierdes el teléfono', 'Esperar a ver si aparece'],
  ['Desconfiar de mensajes que piden tu contraseña (nadie de la empresa la pedirá)', 'Enviar la contraseña por WhatsApp o correo'],
  ['Exportar solo los datos que necesitas y guardarlos protegidos', 'Compartir planillas con datos de clientes'],
])}
${alerta('Toda exportación de datos y cada descarga de fotos o boletas queda registrada con el nombre de quien la hizo. Los registros de seguridad no se pueden borrar.')}
<h2>Rutina recomendada</h2>
${tabla(['Quién', 'Cada día', 'Cada semana'], [
  ['Administración', 'Revisar <b>Sin asignar</b> y envíos fallidos; revisar alertas abiertas en <b>Seguridad</b>', 'Revisar <b>Cobranza</b> (por cobrar y abonos), conciliar con la cartola, revisar "¿Quién sacó datos?" y registrar costos'],
  ['Repartidores', 'Abrir <b>Mi ruta</b> al comenzar; tomar envíos; cerrar cada entrega con foto y GPS', 'Revisar su historial'],
  ['Clientes', 'Pagar al crear el envío para que se retire ese día', 'Mantener la libreta de destinatarios al día'],
])}

<h1>7. ¿Qué hacer si…?</h1>
${tabla(['Situación', 'Qué hacer'], [
  ['Un repartidor perdió el teléfono', `Administración: <b>Usuarios → Cerrar sesiones</b> de esa persona${conLogin ? ' y asignarle una contraseña nueva' : ''}.`],
  ['Alguien olvidó su contraseña', conLogin ? 'Administración: <b>Usuarios → Contraseña</b>. Se entrega en persona; al entrar se le pide crear una propia.' : 'No aplica en la versión de demostración.'],
  ['Un envío pagado no lo ve ningún repartidor', 'Revisar que esté <b>pagado</b>; si nadie lo toma, asignarlo desde el detalle del envío.'],
  ['El repartidor no puede cerrar la entrega', 'Faltan la foto o el GPS: activar el permiso de ubicación del navegador y volver a intentar.'],
  ['Aparece una alerta crítica en Seguridad', 'Leerla, identificar al usuario o IP, cerrar sesiones si corresponde y marcarla revisada con una nota.'],
  ['Se sospecha un hackeo', '1) Seguridad → <b>Cerrar todas las sesiones</b>. 2) Cambiar la contraseña de administración. 3) Revisar qué datos salieron y quién. 4) Seguir el protocolo del documento 17 · Seguridad (cambio de claves del servidor y aviso a la autoridad si salieron datos personales).'],
])}

<h1>Acta de inducción</h1>
<p>Empresa: <b>${empresa}</b> &nbsp;·&nbsp; Fecha: ____________________ &nbsp;·&nbsp; Lugar / modalidad: ____________________</p>
<h3>Temas cubiertos</h3>
${check(['Funcionamiento general de un envío', `Primer ingreso${conLogin ? ' y contraseña propia' : ''} / instalación en el teléfono`, 'Práctica del cliente', 'Práctica del repartidor', 'Práctica de administración', 'Seguridad para todos y protocolo ante incidentes', 'Entrega del Manual de usuario y de esta guía'])}
<h3>Participantes</h3>
${tabla(['Nombre', 'Perfil', 'Correo', 'Firma'], Array.from({ length: 8 }, () => ['', '', '', '']), 'firma')}
<p style="margin-top:8mm">Responsable de la inducción: ______________________________ &nbsp;&nbsp; Firma: ____________________</p>
<p>Observaciones / compromisos: ____________________________________________________________________________</p>
<p>______________________________________________________________________________________________________</p>
</body></html>`;
}
