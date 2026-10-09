import nodemailer from 'nodemailer';

// Envío de correos: soporte, recuperación de contraseña, avisos de pago y de vencimiento. Dos formas:
//   1) RESEND_API_KEY (recomendada en Railway): API HTTPS de Resend. Railway bloquea SMTP (puertos 465/587) en los
//      planes Free, Trial y Hobby; una API por HTTPS funciona en todos.
//   2) SMTP_URL, por ejemplo smtps://usuario:clave@smtp.gmail.com:465 (en Railway solo con el plan Pro).
// El remitente se define en CORREO_REMITENTE (o SMTP_FROM). Sin ninguna de las dos claves no se envía nada: el
// administrador genera el enlace de contraseña a mano y los mensajes de soporte quedan solo en la plataforma.
let transporte = null;

export const correoConfigurado = () => Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);

const remitente = () => process.env.CORREO_REMITENTE || process.env.SMTP_FROM
  || (process.env.RESEND_API_KEY ? 'onboarding@resend.dev' : 'no-responder@envios.local');

// responderA: al tocar "Responder" en el correo, la respuesta va a esa dirección (p. ej. quien escribió a soporte).
export async function enviarCorreo({ para, asunto, texto, responderA }) {
  if (!correoConfigurado()) return false;
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remitente(), to: [para], subject: asunto, text: texto, ...(responderA ? { reply_to: responderA } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Resend respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return true;
  }
  transporte ||= nodemailer.createTransport(process.env.SMTP_URL);
  await transporte.sendMail({ from: remitente(), to: para, subject: asunto, text: texto, ...(responderA ? { replyTo: responderA } : {}) });
  return true;
}
