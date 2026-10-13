// Soporte (pedidos 09-10 y 13-10): reglas puras, sin base de datos, para probarlas de forma aislada.
import { COLORES, escaparHtml, plantillaCorreo } from './plantilla-correo.js';

export const MOTIVOS_SOPORTE = {
  envio: 'Un envío (retiro, entrega o seguimiento)',
  pago: 'Pago o comprobante',
  reclamo: 'Reclamo o paquete dañado',
  cuenta: 'Mi cuenta',
  otro: 'Otro',
};
export const ESTADOS_SOPORTE = { nuevo: 'Por responder', respondido: 'Respondido', cerrado: 'Cerrado' };
export const LARGO_SOPORTE = { nombre: 80, contacto: 120, mensaje: 2000, titulo: 60 };
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v) => String(v ?? '').trim();

// Caso nuevo. Sin sesión hay que dejar nombre y cómo responder (correo o teléfono).
export function validarCasoSoporte(b, { conSesion }) {
  const d = { nombre: texto(b.nombre), contacto: texto(b.contacto), folio: texto(b.folio).toUpperCase(), mensaje: texto(b.mensaje), motivo: texto(b.motivo) || 'otro' };
  const errores = {};
  if (!conSesion) {
    if (d.nombre.length < 2) errores.nombre = 'Escribe tu nombre';
    if (!EMAIL.test(d.contacto) && d.contacto.replace(/\D/g, '').length < 8) errores.contacto = 'Escribe tu correo o tu teléfono para responderte';
  }
  for (const k of ['nombre', 'contacto', 'mensaje']) if (d[k].length > LARGO_SOPORTE[k]) errores[k] = `Máximo ${LARGO_SOPORTE[k]} caracteres`;
  if (d.folio && !/^ENV-\d{4}-\d{6,9}$/.test(d.folio)) errores.folio = 'Folio con formato inválido (ej. ENV-2026-000123)';
  if (!Object.hasOwn(MOTIVOS_SOPORTE, d.motivo)) errores.motivo = 'Elige el motivo';
  if (d.mensaje.length < 5) errores.mensaje = 'Cuéntanos en qué te podemos ayudar';
  return { datos: d, errores };
}

// Mensaje dentro de la conversación: texto o un archivo (no puede ir vacío).
export function validarMensajeConversacion(b, { conArchivo = false } = {}) {
  const t = texto(b.texto ?? b.respuesta);
  const errores = {};
  if (!t && !conArchivo) errores.texto = 'Escribe un mensaje o adjunta un archivo';
  if (t.length > LARGO_SOPORTE.mensaje) errores.texto = `Máximo ${LARGO_SOPORTE.mensaje} caracteres`;
  return { texto: t, interno: b.interno === true || b.interno === 'true', errores };
}

// Correos de soporte con la marca. enlace: la conversación (con sesión o con el enlace privado del caso).
export function correoCasoCreado({ caso, negocio, enlace }) {
  const empresa = negocio.nombre || 'Soporte';
  return {
    asunto: `Recibimos tu mensaje · caso ${caso.folio_caso}`,
    texto: `Hola ${caso.nombre}:\n\nRecibimos tu mensaje y te responderemos pronto.\n\nCaso: ${caso.folio_caso}\nVer la conversación y responder: ${enlace}\n\n— ${empresa}`,
    html: plantillaCorreo({
      negocio, resumen: `Recibimos tu mensaje (caso ${caso.folio_caso}).`, saludo: `Hola ${caso.nombre},`, titulo: 'Recibimos tu mensaje',
      parrafos: ['Te responderemos lo antes posible. Desde el enlace puedes ver la conversación y agregar más detalles o fotos.'],
      destacado: { etiqueta: 'Número de caso', valor: caso.folio_caso }, boton: { texto: 'Ver mi caso', url: enlace },
      notaPie: 'Guarda este correo: el enlace es privado y te permite seguir la conversación sin iniciar sesión.',
    }),
  };
}

export function correoRespuestaSoporte({ caso, negocio, enlace, respuesta }) {
  const empresa = negocio.nombre || 'Soporte';
  return {
    asunto: `Respuesta de ${empresa} · caso ${caso.folio_caso}`,
    texto: `Hola ${caso.nombre}:\n\n${respuesta}\n\nVer la conversación y responder: ${enlace}\n\n— ${empresa}`,
    html: plantillaCorreo({
      negocio, resumen: respuesta.slice(0, 120), saludo: `Hola ${caso.nombre},`, titulo: 'Tienes una respuesta de soporte',
      parrafos: [`<span style="white-space:pre-line;">${escaparHtml(respuesta)}</span>`],
      destacado: { etiqueta: 'Número de caso', valor: caso.folio_caso }, boton: { texto: 'Ver y responder', url: enlace },
      notaPie: `Para contestar, usa el botón: tu respuesta llega directo al equipo de <span style="color:${COLORES.magenta};">${escaparHtml(empresa)}</span>.`,
    }),
  };
}

export function correoAvisoAdmin({ caso, negocio, enlace, texto: mensaje, esRespuesta }) {
  return {
    asunto: `${esRespuesta ? 'Nueva respuesta' : 'Nuevo caso'} de soporte · ${caso.folio_caso} · ${caso.nombre}`,
    texto: `${caso.nombre}${caso.contacto ? ` (${caso.contacto})` : ''}${caso.folio ? ` · envío ${caso.folio}` : ''} · ${MOTIVOS_SOPORTE[caso.motivo] || ''}\n\n${mensaje}\n\nResponde desde Soporte en la plataforma: ${enlace}`,
    html: plantillaCorreo({
      negocio, resumen: mensaje.slice(0, 120), titulo: esRespuesta ? `${caso.nombre} respondió` : `Nuevo caso de ${caso.nombre}`,
      parrafos: [
        `<b>Motivo:</b> ${escaparHtml(MOTIVOS_SOPORTE[caso.motivo] || 'Otro')}${caso.folio ? ` · <b>Envío:</b> ${escaparHtml(caso.folio)}` : ''}${caso.contacto ? `<br><b>Contacto:</b> ${escaparHtml(caso.contacto)}` : ''}`,
        `<span style="white-space:pre-line;">${escaparHtml(mensaje)}</span>`,
      ],
      destacado: { etiqueta: 'Caso', valor: caso.folio_caso }, boton: { texto: 'Responder en la plataforma', url: enlace },
    }),
  };
}
