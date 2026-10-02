import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { ESTADOS, textoPaquete } from './reglas.js';

export function urlQr(envio) {
  return `${config.publicBaseUrl}/q/${envio.token_qr}`;
}

export function urlSeguimiento(folio) {
  return `${config.publicBaseUrl}/#/seguimiento/${folio}`;
}

// Corrección de errores alta (H) y negro puro para que escanee bien en impresión térmica.
export function generarQrPng(texto, ancho = 480) {
  return QRCode.toBuffer(texto, { errorCorrectionLevel: 'H', margin: 2, width: ancho, color: { dark: '#000000', light: '#ffffff' } });
}

const fecha = (d) => (d ? new Date(d).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '—');
const LEYENDA_QR = {
  google: 'Escanea para ver la dirección en Google Maps',
  waze: 'Escanea para abrir la ruta en Waze',
  pagina: 'Escanea para ver la dirección y abrir Google Maps o Waze',
};

// Dibuja una etiqueta completa (una por bulto en el formato térmico). Devuelve la altura usada.
function dibujarEtiqueta(doc, { envio, conf, qr, bulto, termico, ancho, margen }) {
  const util = ancho - margen * 2;
  const t = termico ? 1 : 1.35;
  const gris = '#555555';
  const linea = () => {
    doc.moveDown(0.35);
    doc.moveTo(margen, doc.y).lineTo(ancho - margen, doc.y).lineWidth(0.6).dash(2, { space: 2 }).stroke('#000000').undash();
    doc.moveDown(0.35);
  };
  const seccion = (titulo) => {
    doc.moveDown(0.2).fontSize(7.5 * t).font('Helvetica-Bold').fillColor('#000000').text(titulo.toUpperCase(), { width: util, characterSpacing: 0.6 });
    doc.font('Helvetica').fontSize(9 * t).fillColor('#000000');
  };
  const par = (etiqueta, valor, { negrita = false } = {}) => {
    if (valor === null || valor === undefined || valor === '') return;
    doc.font('Helvetica').fontSize(8 * t).fillColor(gris).text(`${etiqueta}: `, { width: util, continued: true })
      .font(negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000000').fontSize(9 * t).text(String(valor));
  };

  // Encabezado de la empresa
  doc.fontSize(13 * t).font('Helvetica-Bold').fillColor('#000000').text(conf.negocio.nombre, { align: 'center', width: util });
  const contacto = [conf.negocio.rut && `RUT ${conf.negocio.rut}`, conf.negocio.telefono, conf.negocio.correo].filter(Boolean).join(' · ');
  if (contacto) doc.fontSize(7 * t).font('Helvetica').text(contacto, { align: 'center', width: util });
  doc.fontSize(6.5 * t).fillColor(gris).text('Comprobante interno de envío — no es documento tributario', { align: 'center', width: util });
  linea();

  // Folio, bulto y estado de pago
  doc.fillColor('#000000').fontSize(17 * t).font('Helvetica-Bold').text(envio.folio, { align: 'center', width: util });
  doc.fontSize(10 * t).text(bulto ? `BULTO ${bulto} DE ${envio.bultos}` : `${envio.bultos} ${envio.bultos > 1 ? 'BULTOS' : 'BULTO'}`, { align: 'center', width: util });
  doc.fontSize(7.5 * t).font('Helvetica').text(`Emitido ${fecha(envio.confirmado_en || envio.creado_en)} · Impreso ${fecha(new Date())}`, { align: 'center', width: util });
  const servicio = envio.tipo_destino === 'punto_courier' ? `ENTREGA EN PUNTO ${String(envio.courier_empresa).toUpperCase()}` : 'ENTREGA A DOMICILIO';
  doc.moveDown(0.3).fontSize(9 * t).font('Helvetica-Bold').text(servicio, { align: 'center', width: util });
  if (envio.horario_especial) doc.text(`HORARIO ESPECIAL ${envio.franja_horaria}`, { align: 'center', width: util });
  const pagado = ['pagado', 'reembolsado'].includes(envio.estado_pago);
  doc.fontSize(9 * t).text(pagado ? 'PAGADO' : 'PAGO PENDIENTE — NO RETIRAR', { align: 'center', width: util });
  linea();

  // QR hacia el mapa con la dirección de destino
  const ladoQr = termico ? 132 : 150; // > 4 cm: se lee bien desde el teléfono del repartidor
  doc.image(qr, (ancho - ladoQr) / 2, doc.y, { width: ladoQr });
  doc.y += ladoQr + 2;
  doc.fontSize(7.5 * t).font('Helvetica-Bold').text(LEYENDA_QR[conf.operacion.qr_destino] || LEYENDA_QR.google, { align: 'center', width: util });
  linea();

  // Remitente: quién envía (el cliente dueño del envío).
  seccion('Remitente');
  doc.font('Helvetica-Bold').fontSize(10 * t).text(envio.cliente_nombre, { width: util });
  doc.font('Helvetica').fontSize(9 * t);
  const contactoRemitente = [envio.cliente_telefono && `Tel. ${envio.cliente_telefono}`, envio.cliente_rut && `RUT ${envio.cliente_rut}`].filter(Boolean).join(' · ');
  if (contactoRemitente) doc.text(contactoRemitente, { width: util });
  if (envio.retiro_calle) {
    doc.text(`Retiro: ${envio.retiro_calle} ${envio.retiro_numero}${envio.retiro_depto ? `, ${envio.retiro_depto}` : ''} · ${envio.retiro_comuna_nombre || ''}`, { width: util });
    if (envio.retiro_referencia) doc.text(`Ref.: ${envio.retiro_referencia}`, { width: util });
  }
  linea();

  // Destinatario y dirección
  seccion('Destinatario');
  doc.font('Helvetica-Bold').fontSize(11 * t).text(envio.destinatario_nombre, { width: util });
  doc.font('Helvetica').fontSize(9.5 * t).text(`Tel. ${envio.destinatario_telefono}`, { width: util });
  seccion(envio.tipo_destino === 'punto_courier' ? `Entregar en punto ${envio.courier_empresa}` : 'Dirección de entrega');
  if (envio.tipo_destino === 'punto_courier') {
    doc.font('Helvetica-Bold').text(envio.courier_punto, { width: util }).font('Helvetica');
    if (envio.courier_codigo) par('Código del courier', envio.courier_codigo);
  }
  doc.font('Helvetica-Bold').fontSize(10.5 * t).text(`${envio.calle} ${envio.numero}`, { width: util });
  doc.font('Helvetica').fontSize(9.5 * t);
  if (envio.depto) doc.text(`Depto./Of.: ${envio.depto}`, { width: util });
  if (envio.referencia) doc.text(`Referencia: ${envio.referencia}`, { width: util });
  doc.moveDown(0.25).font('Helvetica-Bold').fontSize(16 * t).text(String(envio.comuna_nombre).toUpperCase(), { width: util });
  doc.font('Helvetica').fontSize(8.5 * t).text(`Región ${envio.region}${envio.region === 'Metropolitana' ? ' de Santiago' : ''}`, { width: util });
  linea();

  // Paquete (sin describir el producto: pedido del cliente 30-09)
  seccion('Paquete');
  par('Bultos', textoPaquete(envio, conf.tarifas));
  // Sin montos en la etiqueta: el valor declarado solo lo ve administración (para el seguro) y un valor impreso
  // en el paquete invita al robo. Tampoco se imprime el link de pago.
  if (envio.valor_declarado) par('Seguro', 'Asegurado');
  if (envio.observaciones) par('Observaciones', envio.observaciones);

  // Servicio
  seccion('Servicio');
  par('Estado', ESTADOS[envio.estado]);
  if (envio.repartidor_nombre) par('Repartidor', envio.repartidor_nombre);
  linea();

  // Recepción y seguimiento
  doc.fontSize(8 * t).font('Helvetica').text('Recibí conforme (nombre, RUT y firma):', { width: util });
  doc.moveDown(1.6);
  doc.moveTo(margen, doc.y).lineTo(ancho - margen, doc.y).lineWidth(0.6).stroke('#000000');
  doc.moveDown(0.6);
  doc.fontSize(7 * t).fillColor(gris).text(`Sigue tu envío: ${urlSeguimiento(envio.folio)}`, { align: 'center', width: util, link: urlSeguimiento(envio.folio) });
  if (conf.ticket.pie) doc.moveDown(0.3).text(conf.ticket.pie, { align: 'center', width: util });
  doc.fillColor('#000000');
  return doc.y + margen;
}

// Ticket en formato térmico 80 mm (una etiqueta por bulto, alto justo al contenido) o A4 (RF-20, RF-21).
export async function generarTicketPdf(envio, conf, formato = '80mm') {
  const termico = formato !== 'a4';
  const ancho = termico ? 226.77 : 595.28; // 80 mm en puntos
  const margen = termico ? 10 : 56;
  const qr = await generarQrPng(urlQr(envio));
  const opciones = { envio, conf, qr, termico, ancho, margen };

  // El rollo térmico no tiene alto fijo: se mide la etiqueta en una pasada previa para no gastar papel en blanco.
  let alto = 841.89;
  if (termico) {
    const medida = new PDFDocument({ size: [ancho, 5000], margin: margen, autoFirstPage: true });
    alto = Math.ceil(dibujarEtiqueta(medida, { ...opciones, bulto: 1 }));
    medida.end();
  }

  const doc = new PDFDocument({ size: [ancho, alto], margin: margen, autoFirstPage: false, info: { Title: `Ticket ${envio.folio}`, Author: conf.negocio.nombre } });
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const fin = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(partes))));
  const etiquetas = termico ? Math.max(1, Number(envio.bultos) || 1) : 1;
  for (let bulto = 1; bulto <= etiquetas; bulto++) {
    doc.addPage({ size: [ancho, alto], margin: margen });
    dibujarEtiqueta(doc, { ...opciones, bulto: termico ? bulto : null });
  }
  doc.end();
  return fin;
}
