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
function dibujarEtiqueta(doc, { envio, conf, qr, bulto, termico, ancho, margen }) {
  const util = ancho - margen * 2;
  const t = termico ? 1 : 1.35;
  const gris = '#555555';
  const linea = () => {
    doc.moveDown(0.35);
    doc.moveTo(margen, doc.y).lineTo(ancho - margen, doc.y).lineWidth(0.6).dash(2, { space: 2 }).stroke('#000000').undash();
    doc.moveDown(0.35);
  };
  const par = (etiqueta, valor, { tamano = 10.5 } = {}) => {
    if (valor === null || valor === undefined || valor === '') return;
    doc.font('Helvetica').fontSize(8.5 * t).fillColor(gris).text(`${etiqueta}: `, { width: util, continued: true })
      .font('Helvetica-Bold').fillColor('#000000').fontSize(tamano * t).text(String(valor));
    doc.moveDown(0.15);
  };

  // Etiqueta mínima (pedido del cliente 02-10, "como el sticker que pegan al paquete"): logo, folio, pagado o
  // por pagar, QR y los datos del destinatario. Lo demás (fechas, estado, repartidor, contacto de la empresa,
  // paquete, firma) lo ven el repartidor en su app y administración en el sistema.

  // Encabezado: térmico con el logo grande centrado sobre el nombre; A4 con el logo a la izquierda del nombre.
  const logo = logoEtiqueta(conf);
  const ladoLogo = termico ? 96 : 72;
  const inicioEncabezado = doc.y;
  let anchoEncabezado = util;
  let xEncabezado = margen;
  let yNombre = doc.y;
  if (logo) {
    try {
      doc.image(logo, termico ? (ancho - ladoLogo) / 2 : margen, inicioEncabezado, { fit: [ladoLogo, ladoLogo], align: 'center', valign: 'center' });
      if (termico) yNombre = inicioEncabezado + ladoLogo + 6;
      else {
        xEncabezado = margen + ladoLogo + 12; anchoEncabezado = util - (ladoLogo + 12) * 2;
        yNombre = inicioEncabezado + (ladoLogo - 13 * t) / 2; // nombre centrado a la altura del logo
      }
    } catch { /* un logo dañado no debe impedir imprimir la etiqueta */ }
  }
  doc.fontSize(13 * t).font('Helvetica-Bold').fillColor('#000000').text(conf.negocio.nombre, xEncabezado, yNombre, { align: 'center', width: anchoEncabezado });
  doc.x = margen;
  if (logo && !termico) doc.y = Math.max(doc.y, inicioEncabezado + ladoLogo);
  linea();

  // Folio, bulto, pagado o por pagar
  doc.fillColor('#000000').fontSize(17 * t).font('Helvetica-Bold').text(envio.folio, { align: 'center', width: util });
  doc.fontSize(10 * t).text(bulto ? `BULTO ${bulto} DE ${envio.bultos}` : `${envio.bultos} ${envio.bultos > 1 ? 'BULTOS' : 'BULTO'}`, { align: 'center', width: util });
  const pagado = ['pagado', 'reembolsado'].includes(envio.estado_pago);
  doc.moveDown(0.3).fontSize(11 * t).text(pagado ? 'PAGADO' : 'POR PAGAR', { align: 'center', width: util });
  if (envio.horario_especial) doc.fontSize(9 * t).text(`HORARIO ESPECIAL ${envio.franja_horaria}`, { align: 'center', width: util });
  linea();

  // QR hacia el mapa con la dirección de destino
  const ladoQr = termico ? 118 : 140; // > 4 cm: se lee bien desde el teléfono del repartidor
  doc.image(qr, (ancho - ladoQr) / 2, doc.y, { width: ladoQr });
  doc.y += ladoQr + 2;
  doc.fontSize(7.5 * t).font('Helvetica-Bold').text(LEYENDA_QR[conf.operacion.qr_destino] || LEYENDA_QR.google, { align: 'center', width: util });
  linea();

  // Destinatario: los mismos datos que el sticker (nombre, RUT, celular, dirección).
  par('Nombre', envio.destinatario_nombre, { tamano: 12 });
  par('RUT', envio.destinatario_rut);
  par('Celular', envio.destinatario_telefono);
  if (envio.tipo_destino === 'punto_courier') {
    par(`Entregar en punto ${envio.courier_empresa}`, envio.courier_punto);
    par('Código', envio.courier_codigo);
  }
  par('Dirección', `${envio.calle} ${envio.numero}${envio.depto ? `, ${envio.depto}` : ''}`);
  par('Referencia', envio.referencia, { tamano: 9.5 });
  doc.moveDown(0.2).font('Helvetica-Bold').fontSize(16 * t).fillColor('#000000').text(String(envio.comuna_nombre).toUpperCase(), { width: util });
  linea();

  // Quién envía (la tienda) y el texto al pie que se configura en Ajustes.
  doc.font('Helvetica').fontSize(8 * t).fillColor(gris).text('Envía: ', { width: util, continued: true })
    .font('Helvetica-Bold').fillColor('#000000').text(envio.cliente_nombre);
  if (conf.ticket.pie) doc.moveDown(0.4).font('Helvetica').fontSize(7.5 * t).fillColor(gris).text(conf.ticket.pie, { align: 'center', width: util });
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
