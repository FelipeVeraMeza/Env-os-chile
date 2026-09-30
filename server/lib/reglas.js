// Reglas de negocio puras (sin base de datos) para poder probarlas de forma aislada.
// Cada regla referencia el requerimiento que implementa (ver docs/02-requerimientos.md).

export const ROLES = ['admin', 'cliente', 'repartidor'];

export const ESTADOS = {
  borrador: 'Borrador',
  creado: 'Creado',
  asignado: 'Asignado',
  en_ruta: 'Retirado / En ruta',
  entregado: 'Entregado',
  fallido: 'Fallido',
  reagendado: 'Reagendado',
  devuelto: 'Devuelto',
  anulado: 'Anulado',
};

export const ESTADOS_FINALES = ['entregado', 'devuelto', 'anulado'];

// Máquina de estados (RF-30). Clave: estado actual → estados permitidos.
export const TRANSICIONES = {
  borrador: ['creado'],
  creado: ['asignado', 'anulado'],
  asignado: ['en_ruta', 'creado', 'anulado'],
  en_ruta: ['entregado', 'fallido'],
  fallido: ['reagendado', 'devuelto'],
  reagendado: ['en_ruta'],
  entregado: [],
  devuelto: [],
  anulado: [],
};

export const MOTIVOS_FALLO = {
  nadie_en_domicilio: 'Nadie en el domicilio',
  espera_excedida: 'Tiempo máximo de espera excedido',
  direccion_incorrecta: 'Dirección incorrecta o inexistente',
  rechazado: 'Destinatario rechaza el envío',
  punto_cerrado: 'Punto courier cerrado o no recibe',
  otro: 'Otro',
};

export const COURIERS = ['Blue Express', 'Starken', 'Chilexpress', 'Correos de Chile', 'Otra'];
export const FRANJAS = ['08:00 – 10:00', '10:00 – 13:00', '13:00 – 16:00', '16:00 – 19:00', '19:00 – 21:00', '21:00 – 23:00'];

export const CONFIG_POR_DEFECTO = {
  negocio: {
    nombre: 'Tu Empresa de Envíos',
    rut: '',
    telefono: '',
    correo: '',
    logo_url: '',
  },
  tarifas: {
    // Pedido del cliente 30-09: la tarifa no depende de la cantidad de bultos.
    base: 3500, // Paquete estándar dentro de Santiago: hasta 10 kg y 40×40×40 cm por bulto
    peso_estandar_kg: 10,
    dim_estandar_cm: 40,
    recargo_sobredimension: 2000, // Sobre el estándar y hasta el máximo: $3.500 + $2.000 = $5.500
    peso_max_kg: 20, // Sobre 20 kg o 60×60×60 cm no se recibe el paquete
    dim_max_cm: 60,
    recargo_horario_especial: 1000,
  },
  operacion: {
    intentos_max: 3,
    espera_max_min: 5,
    gps_obligatorio: true,
    registro_clientes: true, // RF-56: los clientes crean su cuenta solos (pedido del cliente 30-09; se puede cerrar en Tarifas y reglas)
    qr_destino: 'google', // google (abre el mapa con la dirección, pedido del cliente 26-09) | pagina | waze
    // Los repartidores ven los envíos pagados sin asignar y pueden tomarlos ellos mismos (DEC-15).
    // Si es false, solo administración asigna (el repartidor no ve nada hasta que lo asignen).
    autoasignacion: true,
    // Envío a puntos de otras compañías (Blue Express, Starken…): en pausa por pedido del cliente (30-09).
    punto_courier: false,
  },
  ticket: {
    pie: 'Conserve este ticket. Consultas y reclamos indicando el folio.',
  },
  listas: {
    couriers: COURIERS, // empresas de puntos courier que se ofrecen al crear un envío
    franjas: FRANJAS, // franjas del envío con horario especial
  },
  pagos: {
    proveedor: 'simulado', // simulado | webpay | mercadopago | flow (etapa de desarrollo)
  },
  // Cuenta a la que el cliente transfiere antes de subir el comprobante (se muestra al pagar).
  transferencia: {
    banco: '',
    tipo_cuenta: '',
    numero_cuenta: '',
    titular: '',
    rut: '',
    correo: '',
  },
};

// ---------- Pago por transferencia con comprobante ----------

export const MIME_COMPROBANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Se puede subir un comprobante solo si el envío está confirmado, tiene monto y su pago está pendiente.
export function validarSubidaComprobante(envio) {
  if (['borrador', 'anulado'].includes(envio.estado)) throw new ErrorNegocio(409, 'Confirma el envío antes de pagar');
  if (envio.estado_pago === 'en_revision') throw new ErrorNegocio(409, 'Ya enviaste un comprobante: está en revisión');
  if (envio.estado_pago !== 'pendiente') throw new ErrorNegocio(409, 'El envío ya está pagado');
  if (!(envio.tarifa_total > 0)) throw new ErrorNegocio(409, 'Este envío no tiene monto a pagar');
}

// Rechazar un comprobante exige decirle al cliente por qué (lo ve al subir uno nuevo).
export function validarMotivoRechazo(motivo) {
  const texto = String(motivo ?? '').trim();
  if (!texto) throw new ErrorNegocio(422, 'Indica el motivo del rechazo', { motivo: 'Obligatorio: el cliente lo verá' });
  if (texto.length > 300) throw new ErrorNegocio(422, 'El motivo puede tener hasta 300 caracteres', { motivo: 'Máximo 300 caracteres' });
  return texto;
}

export class ErrorNegocio extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

// ---------- Validaciones de datos ----------

// Teléfono móvil chileno: +56 9 XXXX XXXX. Devuelve formato normalizado o null.
export function normalizarTelefono(valor) {
  if (!valor) return null;
  let d = String(valor).replace(/[^\d]/g, '');
  if (d.startsWith('56')) d = d.slice(2);
  if (d.length === 8) d = '9' + d;
  if (!/^9\d{8}$/.test(d)) return null;
  return `+56 9 ${d.slice(1, 5)} ${d.slice(5)}`;
}

// RUT chileno con dígito verificador (módulo 11). Devuelve "12.345.678-5" o null.
export function normalizarRut(valor) {
  if (!valor) return null;
  const limpio = String(valor).replace(/[^0-9kK]/g, '').toUpperCase();
  if (limpio.length < 2) return null;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  if (!/^\d{1,8}$/.test(cuerpo)) return null;
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const res = 11 - (suma % 11);
  const esperado = res === 11 ? '0' : res === 10 ? 'K' : String(res);
  if (dv !== esperado) return null;
  return `${Number(cuerpo).toLocaleString('es-CL')}-${dv}`;
}

function entero(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Límites absolutos (también para cotización especial): evitan valores que no caben en la base.
export const LIMITES = { bultos: 100, peso_kg: 1000, dim_cm: 500, valor_declarado: 50_000_000, monto: 100_000_000 };

// Valida el paquete contra el máximo que se recibe (20 kg y 60×60×60 cm por bulto). Sobre eso no se toma el despacho.
export function validarPaquete(p, tarifas = CONFIG_POR_DEFECTO.tarifas) {
  const errores = {};
  if (!p.descripcion_producto || !String(p.descripcion_producto).trim()) {
    errores.descripcion_producto = 'Describe el producto';
  }
  const bultos = entero(p.bultos ?? 1);
  if (!Number.isInteger(bultos) || bultos < 1) errores.bultos = 'Debe haber al menos 1 bulto';
  else if (bultos > LIMITES.bultos) errores.bultos = `Fuera de rango: hasta ${LIMITES.bultos} bultos por envío`;

  const peso = entero(p.peso_kg);
  if (peso === null || Number.isNaN(peso) || peso <= 0) errores.peso_kg = 'Indica el peso por bulto (kg)';
  else if (peso > LIMITES.peso_kg) errores.peso_kg = `Fuera de rango: hasta ${LIMITES.peso_kg} kg`;
  else if (peso > tarifas.peso_max_kg) errores.peso_kg = `No se reciben bultos de más de ${tarifas.peso_max_kg} kg`;

  for (const dim of ['largo_cm', 'ancho_cm', 'alto_cm']) {
    const v = entero(p[dim]);
    if (v === null || Number.isNaN(v) || v <= 0) errores[dim] = 'Obligatorio';
    else if (!Number.isInteger(v)) errores[dim] = 'Usa centímetros enteros';
    else if (v > LIMITES.dim_cm) errores[dim] = `Fuera de rango: hasta ${LIMITES.dim_cm} cm`;
    else if (v > tarifas.dim_max_cm) errores[dim] = `No se reciben bultos de más de ${tarifas.dim_max_cm} cm por lado`;
  }
  const valor = entero(p.valor_declarado ?? 0);
  if (Number.isNaN(valor) || valor < 0 || (valor !== null && !Number.isInteger(valor))) errores.valor_declarado = 'Valor declarado inválido (pesos enteros)';
  else if (valor > LIMITES.valor_declarado) errores.valor_declarado = `El valor declarado no puede superar $${LIMITES.valor_declarado.toLocaleString('es-CL')}`;
  return errores;
}

export function validarDestinatario(d) {
  const errores = {};
  if (!d || !String(d.nombre || '').trim()) errores.nombre = 'Nombre obligatorio';
  if (!normalizarTelefono(d?.telefono)) errores.telefono = 'Teléfono inválido (formato +56 9 XXXX XXXX)';
  if (d?.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) errores.correo = 'Correo inválido';
  if (d?.rut && !normalizarRut(d.rut)) errores.rut = 'RUT inválido';
  return errores;
}

export function validarDireccion(d) {
  const errores = {};
  if (!d || !String(d.calle || '').trim()) errores.calle = 'Calle obligatoria';
  if (!d || !String(d.numero || '').trim()) errores.numero = 'Número obligatorio';
  if (!d || !d.comuna_id) errores.comuna_id = 'Selecciona la comuna';
  return errores;
}

// Compara franjas sin importar espacios ni el tipo de guion ("19:00 - 21:00" = "19:00 – 21:00").
const claveFranja = (f) => String(f || '').replace(/[\s]/g, '').replace(/[‐-―−]/g, '-');

// Normaliza una lista editable desde Ajustes (arreglo o texto con una opción por línea).
export function normalizarLista(valor, { max = 20, largo = 60 } = {}) {
  const items = Array.isArray(valor) ? valor : String(valor ?? '').split('\n');
  const limpia = [...new Set(items.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (!limpia.length) return { error: 'Debe tener al menos una opción' };
  if (limpia.length > max) return { error: `Máximo ${max} opciones` };
  if (limpia.some((x) => x.length > largo)) return { error: `Cada opción puede tener hasta ${largo} caracteres` };
  return { lista: limpia };
}

export function validarDestino(e, listas = CONFIG_POR_DEFECTO.listas, puntoCourier = CONFIG_POR_DEFECTO.operacion.punto_courier) {
  const errores = {};
  const tipo = e.tipo_destino || 'domicilio';
  if (!['domicilio', 'punto_courier'].includes(tipo)) errores.tipo_destino = 'Tipo de destino inválido';
  if (tipo === 'punto_courier' && !puntoCourier) errores.tipo_destino = 'El envío a puntos de otras compañías está en pausa: elige entrega a domicilio';
  else if (tipo === 'punto_courier') {
    if (!listas.couriers.includes(e.courier_empresa)) errores.courier_empresa = `Selecciona la empresa (${listas.couriers.slice(0, 2).join(', ')}, …)`;
    if (!String(e.courier_punto || '').trim()) errores.courier_punto = 'Indica el punto o sucursal';
  }
  if (e.horario_especial && !String(e.franja_horaria || '').trim()) {
    errores.franja_horaria = 'Indica la franja horaria solicitada';
  } else if (e.horario_especial && !listas.franjas.some((f) => claveFranja(f) === claveFranja(e.franja_horaria))) {
    errores.franja_horaria = 'Franja horaria no disponible';
  }
  return errores;
}

// ---------- Tarifa ----------

// Sobredimensionado: algún bulto pasa de 10 kg o de 40 cm por lado (sin superar el máximo que se recibe).
export function esSobredimensionado({ peso_kg, largo_cm, ancho_cm, alto_cm }, tarifas = CONFIG_POR_DEFECTO.tarifas) {
  return Number(peso_kg) > tarifas.peso_estandar_kg || [largo_cm, ancho_cm, alto_cm].some((d) => Number(d) > tarifas.dim_estandar_cm);
}

// Calcula la tarifa del envío. tarifaComuna: tarifa propia de la comuna o su zona (o null → base).
// La cantidad de bultos no cambia el precio: estándar $3.500, sobredimensionado +$2.000, horario especial +$1.000.
export function calcularTarifa(paquete, tarifas = CONFIG_POR_DEFECTO.tarifas, tarifaComuna = null) {
  const base = tarifaComuna ?? tarifas.base;
  const recargo_sobredimension = esSobredimensionado(paquete, tarifas) ? tarifas.recargo_sobredimension : 0;
  const recargo_horario = paquete.horario_especial ? tarifas.recargo_horario_especial : 0;
  return {
    tarifa_base: base,
    recargo_bultos: 0,
    recargo_sobredimension,
    recargo_horario,
    tarifa_total: base + recargo_sobredimension + recargo_horario,
  };
}

// ---------- Estados ----------

export function puedeTransicionar(actual, nuevo) {
  return (TRANSICIONES[actual] || []).includes(nuevo);
}

// Quién puede ejecutar cada transición (RF-04).
export function rolPuedeTransicionar(rol, actual, nuevo, { esDueno = false, esAsignado = false, estadoPago = 'pendiente' } = {}) {
  if (rol === 'admin') return true;
  if (rol === 'cliente') {
    if (nuevo === 'creado' && actual === 'borrador') return esDueno;
    if (nuevo === 'anulado' && actual === 'creado') return esDueno && estadoPago === 'pendiente';
    return false;
  }
  if (rol === 'repartidor') {
    return esAsignado && ['en_ruta', 'entregado', 'fallido'].includes(nuevo);
  }
  return false;
}

export function validarTransicion({ actual, nuevo, estadoPago, intentos, config = CONFIG_POR_DEFECTO, motivo, llegadaEn, ahora = new Date() }) {
  if (!puedeTransicionar(actual, nuevo)) {
    throw new ErrorNegocio(409, `No se puede pasar de "${ESTADOS[actual] || actual}" a "${ESTADOS[nuevo] || nuevo}"`);
  }
  if (nuevo === 'en_ruta' && estadoPago !== 'pagado') {
    throw new ErrorNegocio(409, 'El servicio debe estar pagado antes de retirar el envío');
  }
  if (nuevo === 'fallido') {
    if (!motivo || !MOTIVOS_FALLO[motivo]) throw new ErrorNegocio(422, 'Indica el motivo del intento fallido');
    if (motivo === 'espera_excedida' && !esperaCumplida(llegadaEn, config.operacion.espera_max_min, ahora)) {
      throw new ErrorNegocio(409, `Debe registrar la llegada y esperar ${config.operacion.espera_max_min} minutos antes de usar este motivo`);
    }
  }
  if (nuevo === 'reagendado' && intentos >= config.operacion.intentos_max) {
    throw new ErrorNegocio(409, `Se alcanzó el máximo de ${config.operacion.intentos_max} intentos: el envío debe devolverse`);
  }
  if (nuevo === 'anulado' && !String(motivo || '').trim()) {
    throw new ErrorNegocio(422, 'Indica el motivo de la anulación');
  }
}

export function esperaCumplida(llegadaEn, minutos, ahora = new Date()) {
  if (!llegadaEn) return false;
  return ahora.getTime() - new Date(llegadaEn).getTime() >= minutos * 60 * 1000;
}

export function validarUbicacion({ lat, lon }, obligatorio = true) {
  const la = Number(lat);
  const lo = Number(lon);
  const presente = lat !== undefined && lat !== null && lat !== '' && lon !== undefined && lon !== null && lon !== '';
  if (!presente) {
    if (obligatorio) throw new ErrorNegocio(422, 'Se requiere la ubicación GPS para cerrar la entrega');
    return null;
  }
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new ErrorNegocio(422, 'Coordenadas GPS inválidas');
  }
  return { lat: la, lon: lo };
}

// ---------- Folios ----------

export function formatearFolio(prefijo, anio, numero) {
  return `${prefijo}-${anio}-${String(numero).padStart(6, '0')}`;
}

// ---------- Seguro ----------

export const MOTIVOS_RECLAMO = {
  perdida: 'Pérdida del envío',
  dano: 'Daño del producto',
  robo: 'Robo',
  otro: 'Otro',
};

export const ESTADOS_RECLAMO = {
  solicitado: 'Solicitado',
  en_revision: 'En revisión',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  pagado: 'Pagado',
};

export const MIME_BOLETA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

// La boleta es OBLIGATORIA para cobrar el seguro.
export function validarReclamo({ envio, boleta, datos, reclamosPrevios = [], ahora = new Date() }) {
  if (!envio.valor_declarado || envio.valor_declarado <= 0) {
    throw new ErrorNegocio(409, 'El envío no tiene valor declarado: no está asegurado');
  }
  if (['borrador', 'anulado'].includes(envio.estado)) {
    throw new ErrorNegocio(409, 'No se puede reclamar el seguro de un envío en borrador o anulado');
  }
  if (reclamosPrevios.some((r) => r.estado !== 'rechazado')) {
    throw new ErrorNegocio(409, 'Ya existe un reclamo activo para este envío');
  }

  const errores = {};
  if (!boleta) errores.boleta = 'La boleta es obligatoria para cobrar el seguro';
  else if (!MIME_BOLETA.includes(boleta.mime)) errores.boleta = 'La boleta debe ser PDF, JPG, PNG o WebP';

  if (!MOTIVOS_RECLAMO[datos.motivo]) errores.motivo = 'Selecciona el motivo';
  if (!String(datos.boleta_numero || '').trim()) errores.boleta_numero = 'Número de boleta obligatorio';

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(datos.boleta_fecha || '')) ? new Date(`${datos.boleta_fecha}T00:00:00Z`) : null;
  if (!fecha || Number.isNaN(fecha.getTime())) errores.boleta_fecha = 'Fecha de boleta obligatoria (AAAA-MM-DD)';
  else if (fecha.getTime() > ahora.getTime()) errores.boleta_fecha = 'La fecha de la boleta no puede ser futura';

  const montoBoleta = Number(datos.boleta_monto);
  if (!Number.isInteger(montoBoleta) || montoBoleta <= 0) errores.boleta_monto = 'Monto de la boleta obligatorio';
  else if (montoBoleta > LIMITES.monto) errores.boleta_monto = 'Monto fuera de rango';

  const montoReclamado = Number(datos.monto_reclamado);
  if (!Number.isInteger(montoReclamado) || montoReclamado <= 0) errores.monto_reclamado = 'Monto a reclamar obligatorio';
  else {
    const tope = Math.min(envio.valor_declarado || 0, Number.isInteger(montoBoleta) ? montoBoleta : 0);
    if (montoReclamado > tope) {
      errores.monto_reclamado = `No puede superar el valor declarado ni el monto de la boleta (tope $${tope.toLocaleString('es-CL')})`;
    }
  }

  if (Object.keys(errores).length) throw new ErrorNegocio(422, 'Revisa los datos del reclamo', errores);
}

// ---------- Mapas ----------

export function textoDireccion(d) {
  const partes = [`${d.calle} ${d.numero}`.trim(), d.comuna, d.region ? `Región ${d.region}` : null, 'Chile'];
  return partes.filter(Boolean).join(', ');
}

export function enlacesMapa(d) {
  const texto = encodeURIComponent(textoDireccion(d));
  const coords = d.lat != null && d.lon != null ? `${d.lat},${d.lon}` : null;
  return {
    // "ver" muestra la dirección marcada en Google Maps (con su botón "Cómo llegar"); "google" abre la ruta directa.
    ver: `https://www.google.com/maps/search/?api=1&query=${coords ? encodeURIComponent(coords) : texto}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${coords ? encodeURIComponent(coords) : texto}&travelmode=driving`,
    waze: coords ? `https://waze.com/ul?ll=${encodeURIComponent(coords)}&navigate=yes` : `https://waze.com/ul?q=${texto}&navigate=yes`,
  };
}

// ---------- Visibilidad de montos ----------

const CAMPOS_MONTO = ['tarifa_base', 'recargo_bultos', 'recargo_horario', 'tarifa_total', 'valor_declarado'];

export function ocultarMontos(envio) {
  const copia = { ...envio };
  for (const c of CAMPOS_MONTO) delete copia[c];
  return copia;
}
