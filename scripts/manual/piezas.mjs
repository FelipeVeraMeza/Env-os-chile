// Piezas compartidas del manual y de la guía de inducción: estilos, bloques de maquetación y exportación a PDF.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const CSS = `
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
.check { list-style: none; padding-left: 0; } .check li { padding-left: 7mm; position: relative; margin-bottom: 1.5mm; }
.check li::before { content: ''; position: absolute; left: 0; top: .6mm; width: 3.6mm; height: 3.6mm; border: 1.4px solid #1537d6; border-radius: .8mm; }
.firma td { height: 11mm; }
.ejercicio { border: 1.5px solid #e0218a; border-radius: 3mm; padding: 3mm 4mm; margin: 4mm 0; page-break-inside: avoid; }
.ejercicio h3 { margin-top: 0; color: #e0218a; }
`;

export function crearPiezas(fotos) {
  const img = (id, pie, clase = '') => (fotos[id]
    ? `<figure class="${clase}"><img src="data:image/jpeg;base64,${fotos[id]}" alt="${pie}"><figcaption>${pie}</figcaption></figure>` : '');
  return {
    img,
    par: (a, b) => `<div class="par">${a}${b}</div>`,
    trio: (a, b, c) => `<div class="trio">${a}${b}${c}</div>`,
    nota: (txt) => `<div class="nota">${txt}</div>`,
    alerta: (txt) => `<div class="nota alerta">${txt}</div>`,
    pasos: (lista) => `<ol class="pasos">${lista.map((p) => `<li>${p}</li>`).join('')}</ol>`,
    check: (lista) => `<ul class="check">${lista.map((p) => `<li>${p}</li>`).join('')}</ul>`,
    tabla: (cab, filas, clase = '') => `<table class="${clase}"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    ejercicio: (titulo, cuerpo) => `<div class="ejercicio"><h3>${titulo}</h3>${cuerpo}</div>`,
  };
}

export async function generarPdf({ html, salida, pie, ejecutable }) {
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  const navegador = await chromium.launch({ executablePath: ejecutable || undefined });
  const pagina = await navegador.newPage();
  await pagina.setContent(html, { waitUntil: 'load' });
  await pagina.pdf({
    path: salida, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-size:8px;color:#5b6390;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial">
      <span>${pie.replace(/[<>&]/g, '')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  });
  await navegador.close();
  return fs.statSync(salida).size;
}
