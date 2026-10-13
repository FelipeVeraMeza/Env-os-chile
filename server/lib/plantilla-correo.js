// Correos con la marca (pedido 12-10): azul 60 %, magenta 30 %, blanco 10 %, como la app. HTML para clientes de correo
// (Gmail, Outlook, Apple Mail): tablas, estilos en línea y sin imágenes incrustadas (Gmail bloquea las data: URL; el
// logo se carga desde /api/config/logo.png). Siempre va con su versión de texto plano.
export const COLORES = {
  azulOscuro: '#0a1a6b', azul: '#1537d6', azulClaro: '#eef2ff', azulBorde: '#c3cfff',
  magenta: '#e0218a', magentaClaro: '#fdeef6', texto: '#1b2147', textoSuave: '#5b6385', fondo: '#f2f4fb', blanco: '#ffffff',
};
const C = COLORES;
const FUENTE = "'Plus Jakarta Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Todo lo que escribe un usuario (nombres, mensajes) se escapa: un nombre con HTML no puede alterar el correo.
export function escaparHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const contactoEmpresa = (negocio = {}) => [negocio.telefono, negocio.whatsapp && negocio.whatsapp !== negocio.telefono ? `WhatsApp ${negocio.whatsapp}` : '', negocio.correo]
  .filter(Boolean).map(escaparHtml).join(' &nbsp;·&nbsp; ');

// pasos: [{ texto, activo }] — la línea de estados del envío (el actual en magenta).
function lineaPasos(pasos) {
  const celdas = pasos.map((p) => `
    <td align="center" valign="top" style="width:${Math.floor(100 / pasos.length)}%;padding:0 2px;">
      <div style="width:14px;height:14px;line-height:14px;border-radius:50%;margin:0 auto 6px;background:${p.activo ? C.magenta : C.azulBorde};"></div>
      <div style="font-family:${FUENTE};font-size:12px;line-height:16px;color:${p.activo ? C.magenta : C.textoSuave};font-weight:${p.activo ? 700 : 500};">${escaparHtml(p.texto)}</div>
    </td>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr>${celdas}</tr></table>`;
}

export function plantillaCorreo({ negocio = {}, logoUrl = '', resumen = '', titulo, saludo = '', parrafos = [], destacado, boton, pasos, notaPie = '' }) {
  const empresa = escaparHtml(negocio.nombre || 'Envíos');
  const nombre = `<span style="font-family:${FUENTE};font-size:22px;font-weight:800;color:${C.blanco};letter-spacing:-.3px;">${empresa}</span>`;
  const marca = logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="padding-right:12px;"><img src="${escaparHtml(logoUrl)}" alt="" height="44" style="display:block;height:44px;max-width:160px;border:0;outline:none;text-decoration:none;"></td>
        <td valign="middle">${nombre}</td></tr></table>`
    : nombre;
  const contacto = contactoEmpresa(negocio);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:${C.fondo};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.fondo};">${escaparHtml(resumen)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.fondo};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${C.blanco};border-radius:16px;overflow:hidden;border:1px solid #e3e7f5;">
    <tr><td style="background:${C.azulOscuro};background-image:linear-gradient(120deg,${C.azulOscuro} 0%,${C.azul} 100%);padding:22px 28px;">${marca}</td></tr>
    <tr><td style="height:5px;line-height:5px;font-size:0;background:${C.magenta};">&nbsp;</td></tr>
    <tr><td style="padding:30px 28px 8px;font-family:${FUENTE};color:${C.texto};">
      ${saludo ? `<p style="margin:0 0 6px;font-size:15px;line-height:22px;color:${C.textoSuave};">${escaparHtml(saludo)}</p>` : ''}
      <h1 style="margin:0 0 14px;font-size:24px;line-height:30px;font-weight:800;color:${C.azulOscuro};">${escaparHtml(titulo)}</h1>
      ${parrafos.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:23px;color:${C.texto};">${p}</p>`).join('')}
    </td></tr>
    ${destacado ? `<tr><td style="padding:4px 28px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.azulClaro};border-radius:12px;border-left:5px solid ${C.magenta};">
        <tr><td style="padding:16px 20px;font-family:${FUENTE};">
          <div style="font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:1px;font-weight:700;color:${C.textoSuave};">${escaparHtml(destacado.etiqueta)}</div>
          <div style="font-family:Consolas,'SFMono-Regular',Menlo,monospace;font-size:24px;line-height:32px;font-weight:700;color:${C.azulOscuro};letter-spacing:.5px;">${escaparHtml(destacado.valor)}</div>
        </td></tr></table></td></tr>` : ''}
    ${pasos ? `<tr><td style="padding:14px 28px 4px;">${lineaPasos(pasos)}</td></tr>` : ''}
    ${boton ? `<tr><td align="center" style="padding:22px 28px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border-radius:999px;background:${C.magenta};">
        <a href="${escaparHtml(boton.url)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${FUENTE};font-size:16px;font-weight:800;color:${C.blanco};text-decoration:none;border-radius:999px;">${escaparHtml(boton.texto)}</a>
      </td></tr></table>
      <p style="margin:14px 0 0;font-family:${FUENTE};font-size:12px;line-height:18px;color:${C.textoSuave};">¿El botón no funciona? Copia este enlace en tu navegador:<br>
        <a href="${escaparHtml(boton.url)}" style="color:${C.azul};word-break:break-all;">${escaparHtml(boton.url)}</a></p>
    </td></tr>` : ''}
    <tr><td style="padding:22px 28px 26px;font-family:${FUENTE};font-size:12px;line-height:18px;color:${C.textoSuave};">${notaPie}</td></tr>
    <tr><td style="background:${C.azulOscuro};padding:18px 28px;font-family:${FUENTE};font-size:12px;line-height:18px;color:#c3cfff;">
      <b style="color:${C.blanco};font-size:13px;">${empresa}</b>${contacto ? `<br>${contacto}` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
