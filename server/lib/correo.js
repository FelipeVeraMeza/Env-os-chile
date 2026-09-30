import nodemailer from 'nodemailer';

// Envío de correos (recuperación de contraseña). Se activa con SMTP_URL, por ejemplo
//   smtps://usuario:clave@smtp.gmail.com:465   o el SMTP de Brevo / SendGrid / Resend.
// Sin SMTP_URL no se envía nada: el administrador genera el enlace y lo comparte a mano.
let transporte = null;

export const correoConfigurado = () => Boolean(process.env.SMTP_URL);

export async function enviarCorreo({ para, asunto, texto }) {
  if (!correoConfigurado()) return false;
  transporte ||= nodemailer.createTransport(process.env.SMTP_URL);
  await transporte.sendMail({ from: process.env.SMTP_FROM || 'no-responder@envios.local', to: para, subject: asunto, text: texto });
  return true;
}
