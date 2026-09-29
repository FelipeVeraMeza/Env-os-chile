// Cobranza: costo de cada medio de pago, verificación de que el pago realmente ocurrió y
// fecha estimada de abono. Reglas puras (sin base de datos) para poder probarlas aisladas.
// Ver docs/15-diagnostico-envios-y-cobranza.md
import { ErrorNegocio } from './reglas.js';

export const IVA = 0.19;

// [REFERENCIAL] Comisiones públicas aproximadas en Chile para comercios pequeños (2025-2026).
// Cambian por contrato, rubro y volumen: CONFIRMAR con cada proveedor antes de elegir.
// porcentaje y fijo se cobran por transacción; iva = la comisión lleva IVA encima.
export const PROVEEDORES_PAGO = {
  simulado: {
    nombre: 'Simulado (demo)', porcentaje: 0, fijo: 0, iva: false, dias_abono: 0, verificacion: 'simulado',
    nota: 'Solo para pruebas: no mueve dinero real.',
  },
  webpay: {
    nombre: 'Webpay Plus (Transbank)', porcentaje: 2.95, fijo: 0, iva: true, dias_abono: 2, verificacion: 'consulta_api',
    nota: 'Crédito, débito y prepago. Se confirma con commit de la transacción (API REST). Requiere contrato con Transbank.',
  },
  mercadopago: {
    nombre: 'Mercado Pago (Checkout Pro)', porcentaje: 3.19, fijo: 0, iva: true, dias_abono: 0, verificacion: 'webhook',
    nota: 'Liberación inmediata a mayor comisión (menor si se espera el abono). Confirmación por webhook + consulta del pago.',
  },
  flow: {
    nombre: 'Flow', porcentaje: 2.89, fijo: 0, iva: true, dias_abono: 3, verificacion: 'webhook',
    nota: 'Agrupa Webpay, Mach, Khipu y otros en un solo contrato. Confirmación por URL de confirmación + getStatus firmado.',
  },
  khipu: {
    nombre: 'Khipu (transferencia simplificada)', porcentaje: 1.0, fijo: 0, iva: true, dias_abono: 1, verificacion: 'webhook',
    nota: 'Paga desde la cuenta bancaria. Más barato que tarjeta; no todos los clientes lo usan.',
  },
  transferencia: {
    nombre: 'Transferencia bancaria manual', porcentaje: 0, fijo: 0, iva: false, dias_abono: 0, verificacion: 'manual',
    nota: 'Sin comisión, pero administración debe revisar la cartola y registrar cada pago a mano (costo en horas).',
  },
};

export const VERIFICACIONES = ['simulado', 'webhook', 'consulta_api', 'manual'];

// Costo de cobrar un monto con un proveedor.
export function estimarCosto(monto, proveedor) {
  const p = typeof proveedor === 'string' ? PROVEEDORES_PAGO[proveedor] : proveedor;
  if (!p) throw new Error(`Proveedor de pago desconocido: ${proveedor}`);
  const m = Math.max(0, Math.round(Number(monto) || 0));
  const comision = m ? Math.round((m * p.porcentaje) / 100 + p.fijo) : 0;
  const iva = p.iva ? Math.round(comision * IVA) : 0;
  const costo = comision + iva;
  return { monto: m, comision, iva, costo, neto: m - costo, porcentaje_efectivo: m ? costo / m : 0 };
}

// Compara todos los proveedores reales para un monto y un volumen mensual de envíos.
export function compararProveedores(monto, enviosMes = 0) {
  return Object.entries(PROVEEDORES_PAGO)
    .filter(([clave]) => clave !== 'simulado')
    .map(([clave, p]) => {
      const e = estimarCosto(monto, p);
      return {
        proveedor: clave, nombre: p.nombre, porcentaje: p.porcentaje, fijo: p.fijo, lleva_iva: p.iva, dias_abono: p.dias_abono,
        verificacion: p.verificacion, nota: p.nota, ...e,
        costo_mes: e.costo * enviosMes, neto_mes: e.neto * enviosMes,
      };
    })
    .sort((a, b) => a.costo - b.costo);
}

// Suma días hábiles (lunes a viernes; los feriados no se consideran: es una estimación).
export function fechaAbonoEstimada(desde, diasHabiles) {
  const d = new Date(desde);
  let restantes = diasHabiles;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return d.toISOString().slice(0, 10);
}

// Un pago solo se da por aprobado si lo que informa el proveedor calza con lo que se cobró:
// mismo token/orden, mismo monto exacto, en pesos chilenos, y que no se haya procesado antes.
export function verificarConfirmacion(pago, informe) {
  if (pago.estado !== 'iniciado') throw new ErrorNegocio(409, 'El pago ya fue procesado');
  if (informe.estado !== 'aprobado') return { aprobado: false, motivo: informe.motivo || 'Rechazado por el proveedor' };
  const errores = {};
  if (informe.token !== undefined && informe.token !== pago.token) errores.token = 'La orden informada no corresponde a este pago';
  if (Number(informe.monto) !== Number(pago.monto)) errores.monto = `Monto informado ($${informe.monto}) distinto al cobrado ($${pago.monto})`;
  if (informe.moneda && informe.moneda !== 'CLP') errores.moneda = 'La moneda debe ser CLP';
  if (!String(informe.transaccion_id || '').trim()) errores.transaccion_id = 'Falta el identificador de la transacción del proveedor';
  if (Object.keys(errores).length) throw new ErrorNegocio(422, 'El pago informado no calza con el cobro', errores);
  return { aprobado: true };
}

// Conciliación: lo que realmente llegó a la cuenta. La comisión real es la diferencia
// entre lo cobrado y lo abonado (así siempre cuadra con la cartola).
export function validarConciliacion(pago, { monto_abonado: abonado, abonado_en: fecha }, hoy = new Date()) {
  if (pago.estado !== 'aprobado') throw new ErrorNegocio(409, 'Solo se concilia un pago aprobado');
  if (pago.abonado_en) throw new ErrorNegocio(409, 'El pago ya fue conciliado');
  const errores = {};
  const m = abonado === '' || abonado === null || abonado === undefined ? NaN : Number(abonado);
  if (!Number.isInteger(m) || m < 0 || m > pago.monto) errores.monto_abonado = `Debe estar entre $0 y $${pago.monto}`;
  const f = fecha ? new Date(fecha) : hoy;
  if (Number.isNaN(f.getTime())) errores.abonado_en = 'Fecha inválida';
  else if (f.getTime() > hoy.getTime() + 864e5) errores.abonado_en = 'La fecha de abono no puede ser futura';
  if (Object.keys(errores).length) throw new ErrorNegocio(422, 'Revisa los datos de la conciliación', errores);
  return { monto_abonado: m, comision_real: pago.monto - m, abonado_en: f.toISOString().slice(0, 10) };
}
