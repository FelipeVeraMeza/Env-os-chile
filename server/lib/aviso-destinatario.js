import { config } from '../config.js';
import { query, uno } from '../db/pool.js';
import { leerConfig } from './configuracion.js';
import { correoConfigurado, enviarCorreo } from './correo.js';
import { COLORES, escaparHtml, plantillaCorreo } from './plantilla-correo.js';

// Pedido del cliente 12-10: cuando el cliente crea (confirma) un envío, al destinatario le llega un correo con el
// enlace de seguimiento. El correo no lleva la dirección ni otros datos personales: si el correo está mal escrito,
// quien lo reciba solo ve un folio y el seguimiento público (que tampoco muestra datos personales).
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const urlSeguimiento = (folio) => `${config.publicBaseUrl}/#/seguimiento/${encodeURIComponent(folio)}`;

// Logo de la empresa para los correos (Gmail no muestra imágenes incrustadas): solo si se subió uno en Ajustes.
export const urlLogoCorreo = (negocio) => (negocio?.logo_url ? `${config.publicBaseUrl}/api/config/logo.png` : '');

export function correoAvisoDestinatario({ folio, destinatario, remitente, negocio = {} }) {
  const empresa = negocio.nombre || 'Envíos';
  const url = urlSeguimiento(folio);
  return {
    asunto: `${remitente} te envió un paquete · ${folio}`,
    texto: `Hola ${destinatario}:\n\n${remitente} creó un envío para ti con ${empresa}.\n\nFolio: ${folio}\nSigue tu envío aquí: ${url}\n\n`
      + `En el seguimiento verás cuándo lo retiramos, cuándo sale a reparto y cuándo se entrega.\n\n— ${empresa}`,
    // Versión con la marca (pedido 12-10): azul, magenta y blanco como la app.
    html: plantillaCorreo({
      negocio,
      logoUrl: urlLogoCorreo(negocio),
      resumen: `${remitente} creó un envío para ti. Síguelo con el folio ${folio}.`,
      saludo: `Hola ${destinatario},`,
      titulo: '¡Tienes un envío en camino!',
      parrafos: [
        `<b style="color:${COLORES.azulOscuro};">${escaparHtml(remitente)}</b> creó un envío para ti con <b style="color:${COLORES.magenta};">${escaparHtml(empresa)}</b>.`,
        'Desde el seguimiento verás cuándo lo retiramos, cuándo sale a reparto y cuándo se entrega.',
      ],
      destacado: { etiqueta: 'Folio de seguimiento', valor: folio },
      pasos: [{ texto: 'Creado', activo: true }, { texto: 'Retirado' }, { texto: 'En reparto' }, { texto: 'Entregado' }],
      boton: { texto: 'Seguir mi envío', url },
      notaPie: `Recibiste este correo porque ${escaparHtml(remitente)} te registró como destinatario de un envío. Por tu seguridad, nunca incluimos tu dirección en los correos.`,
    }),
  };
}

// Envía el aviso una sola vez por envío. Devuelve true si salió el correo. Nunca lanza: un correo que falla no
// debe impedir crear el envío.
export async function avisarDestinatario(envioId) {
  try {
    if (!correoConfigurado()) return false;
    const conf = await leerConfig();
    if (conf.operacion.aviso_destinatario === false) return false;
    // Se marca antes de enviar: dos confirmaciones simultáneas no mandan dos correos.
    const e = await uno(
      `UPDATE envio e SET aviso_destinatario_en = now() FROM destinatario d, usuario cli
        WHERE e.id = $1 AND d.id = e.destinatario_id AND cli.id = e.cliente_id AND e.folio IS NOT NULL
          AND e.aviso_destinatario_en IS NULL AND d.correo IS NOT NULL AND d.anonimizado_en IS NULL
        RETURNING e.folio, d.correo, d.nombre AS destinatario, cli.nombre AS remitente`, [envioId]);
    if (!e || !EMAIL.test(e.correo)) return false;
    try {
      await enviarCorreo({ para: e.correo, ...correoAvisoDestinatario({ ...e, negocio: conf.negocio }), responderA: conf.negocio.correo || undefined });
      return true;
    } catch (err) {
      await query('UPDATE envio SET aviso_destinatario_en = NULL WHERE id = $1', [envioId]);
      console.error(`[aviso] no se pudo avisar al destinatario del envío ${e.folio}:`, err.message);
      return false;
    }
  } catch (err) {
    console.error('[aviso] no se pudo preparar el aviso al destinatario:', err.message);
    return false;
  }
}
