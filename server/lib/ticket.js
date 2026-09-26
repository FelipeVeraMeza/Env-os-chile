import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { ESTADOS } from './reglas.js';

export function urlQr(envio) {
  return `${config.publicBaseUrl}/q/${envio.token_qr}`;
}

// Corrección de errores alta (H) para que escanee bien en impresión térmica.
export function generarQrPng(texto, ancho = 480) {
  return QRCode.toBuffer(texto, { errorCorrectionLevel: 'H', margin: 2, width: ancho, color: { dark: '#0b1f7a', light: '#ffffff' } });
}

const clp = (n) => `$${Number(n || 0).toLocaleString('es-CL')}`;
const fecha = (d) => (d ? new Date(d).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '—');

// Ticket en formato térmico 80 mm o A4 (RF-20, RF-21).
export async function generarTicketPdf(envio, conf, formato = '80mm') {
  const termico = formato !== 'a4';
  const ancho = termico ? 226.77 : 595.28; // 80 mm en puntos
  const alto = termico ? 640 : 841.89;
  const margen = termico ? 12 : 48;
  const qr = await generarQrPng(urlQr(envio));

  const doc = new PDFDocument({ size: [ancho, alto], margin: margen, info: { Title: `Ticket ${envio.folio}` } });
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const fin = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(partes))));

  const util = ancho - margen * 2;
  const t = termico ? 1 : 1.5;

  doc.fontSize(12 * t).font('Helvetica-Bold').text(conf.negocio.nombre, { align: 'center', width: util });
  if (conf.negocio.telefono || conf.negocio.rut) {
    doc.fontSize(7 * t).font('Helvetica').text([conf.negocio.rut && `RUT ${conf.negocio.rut}`, conf.negocio.telefono].filter(Boolean).join(' · '), { align: 'center', width: util });
  }
  doc.moveDown(0.4);
  doc.fontSize(7 * t).font('Helvetica').text('COMPROBANTE INTERNO — NO ES DOCUMENTO TRIBUTARIO', { align: 'center', width: util });
  doc.moveDown(0.5);
  doc.fontSize(14 * t).font('Helvetica-Bold').text(envio.folio, { align: 'center', width: util });
  doc.fontSize(7 * t).font('Helvetica').text(`Emitido: ${fecha(envio.confirmado_en || envio.creado_en)}`, { align: 'center', width: util });
  doc.moveDown(0.5);

  const ladoQr = termico ? 120 : 170; // > 2,5 cm con margen blanco
  doc.image(qr, (ancho - ladoQr) / 2, doc.y, { width: ladoQr });
  doc.y += ladoQr + 4;
  doc.fontSize(6.5 * t).text('Escanee para abrir la ruta en el mapa', { align: 'center', width: util });
  doc.moveDown(0.6);

  const seccion = (titulo) => {
    doc.moveDown(0.3).fontSize(7 * t).font('Helvetica-Bold').fillColor('#c0137e').text(titulo.toUpperCase(), { width: util });
    doc.fillColor('#000000').font('Helvetica').fontSize(8.5 * t);
  };

  seccion('Destinatario');
  doc.text(`${envio.destinatario_nombre} · ${envio.destinatario_telefono}`, { width: util });

  seccion(envio.tipo_destino === 'punto_courier' ? `Entrega en punto ${envio.courier_empresa}` : 'Dirección');
  if (envio.tipo_destino === 'punto_courier') doc.text(`Punto: ${envio.courier_punto}${envio.courier_codigo ? ` · Cód. ${envio.courier_codigo}` : ''}`, { width: util });
  doc.text(`${envio.calle} ${envio.numero}${envio.depto ? `, ${envio.depto}` : ''}`, { width: util });
  if (envio.referencia) doc.text(`Ref.: ${envio.referencia}`, { width: util });
  doc.font('Helvetica-Bold').fontSize(13 * t).text(envio.comuna_nombre.toUpperCase(), { width: util });
  doc.font('Helvetica').fontSize(8.5 * t);

  seccion('Producto');
  doc.text(`${envio.descripcion_producto}`, { width: util });
  doc.text(`Bultos: ${envio.bultos} · ${envio.peso_kg} kg · ${envio.largo_cm}×${envio.ancho_cm}×${envio.alto_cm} cm`, { width: util });
  if (envio.valor_declarado) doc.text(`Valor declarado (seguro): ${clp(envio.valor_declarado)}`, { width: util });
  if (envio.horario_especial) doc.font('Helvetica-Bold').text(`HORARIO ESPECIAL: ${envio.franja_horaria}`, { width: util }).font('Helvetica');

  seccion('Servicio');
  doc.text(`Tarifa: ${clp(envio.tarifa_total)} · Pago: ${envio.estado_pago === 'pagado' ? 'PAGADO' : 'PENDIENTE'}`, { width: util });
  doc.text(`Estado: ${ESTADOS[envio.estado]}`, { width: util });

  doc.moveDown(0.8).fontSize(6.5 * t).fillColor('#444444').text(conf.ticket.pie, { align: 'center', width: util });
  doc.end();
  return fin;
}
