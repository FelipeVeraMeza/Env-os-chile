import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';

// Logo de la etiqueta: el que se subió en Ajustes (PNG en data URL) o, si no hay, el ícono de la plataforma.
let logoPorDefecto;
function logoEtiqueta(conf) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(conf.negocio.logo_url || '');
  if (m) return Buffer.from(m[1], 'base64');
  if (logoPorDefecto === undefined) {
    try { logoPorDefecto = readFileSync(new URL('../../web/icons/icono-512.png', import.meta.url)); } catch { logoPorDefecto = null; }
  }
  return logoPorDefecto;
}

export function urlQr(envio) {
  return `${config.publicBaseUrl}/q/${envio.token_qr}`;
}

// Corrección de errores alta (H) y negro puro para que escanee bien en impresión térmica.
export function generarQrPng(texto, ancho = 480) {
  return QRCode.toBuffer(texto, { errorCorrectionLevel: 'H', margin: 2, width: ancho, color: { dark: '#000000', light: '#ffffff' } });
}

const LEYENDA_QR = {
  google: 'Escanea para ver la dirección en Google Maps',
  waze: 'Escanea para abrir la ruta en Waze',
  pagina: 'Escanea para ver la dirección y abrir Google Maps o Waze',
};

// Dibuja una etiqueta completa (una por bulto en el formato térmico). Devuelve la altura usada.
function dibujarEtiqueta(doc, { envio, conf, qr, termico, ancho, margen }) {
  const util = ancho - margen * 2;
  const t = termico ? 1 : 1.35;
  const linea = () => {
    doc.moveDown(0.35);
    doc.moveTo(margen, doc.y).lineTo(ancho - margen, doc.y).lineWidth(0.6).dash(2, { space: 2 }).stroke('#000000').undash();
    doc.moveDown(0.35);
  };
  const seccion = (titulo) => {
    doc.moveDown(0.2).fontSize(7.5 * t).font('Helvetica-Bold').fillColor('#000000').text(titulo.toUpperCase(), { width: util, characterSpacing: 0.6 });
    doc.font('Helvetica').fontSize(9 * t).fillColor('#000000');
  };

  // Etiqueta mínima (pedido del cliente 03-10, con la etiqueta marcada): logo, folio, QR, remitente y
  // destinatario con su dirección. Lo demás (nombre y contacto de la empresa, bulto, fechas, pago, estado,
  // paquete, firma, seguimiento y pie) lo ven el repartidor en su app y administración en el sistema.

  // Logo centrado (el subido en Ajustes; ya lleva el nombre de la empresa)
  const logo = logoEtiqueta(conf);
  if (logo) {
    const ladoLogo = termico ? 96 : 110;
    const inicio = doc.y;
    try {
      doc.image(logo, (ancho - ladoLogo) / 2, inicio, { fit: [ladoLogo, ladoLogo], align: 'center', valign: 'center' });
      doc.y = inicio + ladoLogo;
      linea();
    } catch { doc.y = inicio; /* un logo dañado no debe impedir imprimir la etiqueta */ }
  }

  // Folio
  doc.fillColor('#000000').fontSize(17 * t).font('Helvetica-Bold').text(envio.folio, { align: 'center', width: util });
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
  linea();

  // Destinatario y dirección
  seccion('Destinatario');
  doc.font('Helvetica-Bold').fontSize(11 * t).text(envio.destinatario_nombre, { width: util });
  const contactoDestinatario = [envio.destinatario_telefono && `Tel. ${envio.destinatario_telefono}`, envio.destinatario_rut && `RUT ${envio.destinatario_rut}`].filter(Boolean).join(' · ');
  doc.font('Helvetica').fontSize(9.5 * t).text(contactoDestinatario, { width: util });
  seccion(envio.tipo_destino === 'punto_courier' ? `Entregar en punto ${envio.courier_empresa}` : 'Dirección de entrega');
  if (envio.tipo_destino === 'punto_courier') {
    doc.font('Helvetica-Bold').text(envio.courier_punto, { width: util }).font('Helvetica');
    if (envio.courier_codigo) doc.text(`Código del courier: ${envio.courier_codigo}`, { width: util });
  }
  doc.font('Helvetica-Bold').fontSize(10.5 * t).text(`${envio.calle} ${envio.numero}`, { width: util });
  doc.font('Helvetica').fontSize(9.5 * t);
  if (envio.depto) doc.text(`Depto./Of.: ${envio.depto}`, { width: util });
  if (envio.referencia) doc.text(`Referencia: ${envio.referencia}`, { width: util });
  doc.moveDown(0.25).font('Helvetica-Bold').fontSize(16 * t).text(String(envio.comuna_nombre).toUpperCase(), { width: util });
  doc.font('Helvetica').fontSize(8.5 * t).text(`Región ${envio.region}${envio.region === 'Metropolitana' ? ' de Santiago' : ''}`, { width: util });
  doc.fillColor('#000000');
  return doc.y + margen;
}

// Ticket en formato térmico 80 mm (una etiqueta por bulto, alto justo al contenido) o A4 (RF-20, RF-21).
export function generarTicketPdf(envio, conf, formato = '80mm') {
  return generarEtiquetasPdf([envio], conf, formato, `Ticket ${envio.folio}`);
}

// Varias etiquetas en un solo PDF (impresión en lote del día, pedido 03-10): en térmico una por bulto de cada
// envío; en A4 una hoja por envío.
export async function generarEtiquetasPdf(envios, conf, formato = '80mm', titulo = 'Etiquetas') {
  const termico = formato !== 'a4';
  const ancho = termico ? 226.77 : 595.28; // 80 mm en puntos
  const margen = termico ? 10 : 56;
  const doc = new PDFDocument({ margin: margen, autoFirstPage: false, info: { Title: titulo, Author: conf.negocio.nombre } });
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const fin = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(partes))));
  for (const envio of envios) {
    const opciones = { envio, conf, qr: await generarQrPng(urlQr(envio)), termico, ancho, margen };
    // El rollo térmico no tiene alto fijo: se mide la etiqueta en una pasada previa para no gastar papel en blanco.
    let alto = 841.89;
    if (termico) {
      const medida = new PDFDocument({ size: [ancho, 5000], margin: margen, autoFirstPage: true });
      alto = Math.ceil(dibujarEtiqueta(medida, opciones));
      medida.end();
    }
    const etiquetas = termico ? Math.max(1, Number(envio.bultos) || 1) : 1;
    for (let bulto = 1; bulto <= etiquetas; bulto++) {
      doc.addPage({ size: [ancho, alto], margin: margen });
      dibujarEtiqueta(doc, opciones);
    }
  }
  doc.end();
  return fin;
}
