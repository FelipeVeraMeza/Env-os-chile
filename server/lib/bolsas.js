// Bolsas de envío (pedido del cliente 11-10): reglas puras, sin base de datos, para probarlas de forma aislada.

export const ESTADOS_PEDIDO_BOLSAS = {
  pendiente: 'Pendiente de pago',
  en_revision: 'Comprobante en revisión',
  pagado: 'Pagado: por entregar',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

export const MAX_PAQUETES_POR_LINEA = 100;
export const MAX_LINEAS_PEDIDO = 30;
const PRECIO_MAX = 10_000_000;
const texto = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const entero = (v) => (v === '' || v === null || v === undefined || typeof v === 'boolean' ? NaN : Number(v));

// "17 x 30", "17X30 cm" o "17×30" quedan como "17x30".
export function normalizarMedida(v) {
  const m = /^(\d{1,3})\s*[x×*]\s*(\d{1,3})(?:\s*cm)?$/i.exec(texto(v));
  return m ? `${Number(m[1])}x${Number(m[2])}` : null;
}

// Producto del catálogo. Con parcial=true (editar) solo se validan los campos que vienen.
export function validarProductoBolsa(b = {}, { parcial = false } = {}) {
  const datos = {};
  const errores = {};
  const tiene = (k) => !parcial || b[k] !== undefined;
  if (tiene('color')) {
    const color = texto(b.color);
    if (!color || color.length > 30) errores.color = 'Escribe el color (hasta 30 caracteres)';
    else datos.color = color.charAt(0).toUpperCase() + color.slice(1);
  }
  if (tiene('medida')) {
    const medida = normalizarMedida(b.medida);
    if (!medida) errores.medida = 'Medida en cm como ancho x alto (ej. 17x30)';
    else datos.medida = medida;
  }
  if (tiene('unidades')) {
    const n = entero(b.unidades ?? (parcial ? undefined : 100));
    if (!Number.isInteger(n) || n < 1 || n > 10_000) errores.unidades = 'Bolsas por paquete: entero entre 1 y 10.000';
    else datos.unidades = n;
  }
  if (tiene('precio')) {
    const n = entero(b.precio);
    if (!Number.isInteger(n) || n < 1 || n > PRECIO_MAX) errores.precio = 'Precio en pesos enteros, mayor que $0';
    else datos.precio = n;
  }
  if (b.costo !== undefined) {
    if (b.costo === '' || b.costo === null) datos.costo = null;
    else {
      const n = entero(b.costo);
      if (!Number.isInteger(n) || n < 0 || n > PRECIO_MAX) errores.costo = 'Costo en pesos enteros (o vacío)';
      else datos.costo = n;
    }
  }
  if (b.activo !== undefined) {
    if (typeof b.activo !== 'boolean') errores.activo = 'Debe ser verdadero o falso';
    else datos.activo = b.activo;
  }
  if (b.orden !== undefined) {
    const n = entero(b.orden);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) errores.orden = 'Orden: entero entre 0 y 10.000';
    else datos.orden = n;
  }
  return { datos, errores };
}

// Calcula el pedido con los precios del catálogo (nunca con montos que mande el navegador).
// items: [{ bolsa_id, cantidad }] · catalogo: productos activos [{ id, color, medida, unidades, precio }].
export function calcularPedidoBolsas(items, catalogo) {
  const errores = {};
  if (!Array.isArray(items) || !items.length) return { lineas: [], total: 0, errores: { items: 'Elige al menos una bolsa' } };
  if (items.length > MAX_LINEAS_PEDIDO) return { lineas: [], total: 0, errores: { items: `Máximo ${MAX_LINEAS_PEDIDO} medidas por pedido` } };
  const porId = new Map(catalogo.map((p) => [Number(p.id), p]));
  const cantidades = new Map();
  items.forEach((it, i) => {
    const id = entero(it?.bolsa_id);
    const cantidad = entero(it?.cantidad);
    const p = porId.get(id);
    if (!p) { errores[`items.${i}.bolsa_id`] = 'Esa bolsa ya no está disponible'; return; }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_PAQUETES_POR_LINEA) {
      errores[`items.${i}.cantidad`] = `Cantidad de paquetes: entre 1 y ${MAX_PAQUETES_POR_LINEA}`;
      return;
    }
    // La misma bolsa dos veces en el pedido se suma en una sola línea.
    cantidades.set(id, (cantidades.get(id) || 0) + cantidad);
  });
  if ([...cantidades.values()].some((n) => n > MAX_PAQUETES_POR_LINEA)) errores.items = `Máximo ${MAX_PAQUETES_POR_LINEA} paquetes de cada medida`;
  if (Object.keys(errores).length) return { lineas: [], total: 0, errores };
  const lineas = [...cantidades].map(([id, cantidad]) => {
    const p = porId.get(id);
    return { bolsa_id: p.id, color: p.color, medida: p.medida, unidades: p.unidades, precio_unitario: p.precio, cantidad, subtotal: p.precio * cantidad };
  });
  return { lineas, total: lineas.reduce((t, l) => t + l.subtotal, 0), errores };
}

// Precio por bolsa (para mostrar "$42 c/u"): redondeado a peso.
export const precioPorBolsa = (precio, unidades) => Math.round(Number(precio) / Math.max(Number(unidades) || 1, 1));
