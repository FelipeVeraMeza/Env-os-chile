// Entregas sin conexión (pedido 01-10): si el repartidor se queda sin internet, la entrega (foto, hora, GPS si hay)
// queda guardada en el teléfono y se envía sola apenas vuelve la señal. También se guardan la ruta y el detalle de
// cada envío para poder abrirlos sin señal.
import { enviarForm } from './api.js';
import { toast } from './ui.js';

const BASE = 'envios-sin-conexion';
const TABLA = 'entregas';

function abrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLA, { keyPath: 'envioId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tabla(modo, operacion) {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLA, modo);
    const r = operacion(tx.objectStore(TABLA));
    tx.oncomplete = () => { db.close(); resolve(r?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Guarda una entrega hecha sin señal. Se identifica por el envío: guardarla de nuevo reemplaza la anterior.
export async function guardarEntrega({ envioId, foto, lat, lon, precision, receptor }) {
  await tabla('readwrite', (t) => t.put({ envioId, foto, lat, lon, precision, receptor, hora: new Date().toISOString() }));
}

export async function entregasPendientes() {
  try { return (await tabla('readonly', (t) => t.getAll())) || []; } catch { return []; }
}

export async function entregaPendiente(envioId) {
  return (await entregasPendientes()).find((x) => x.envioId === envioId) || null;
}

let enviando = false;
// Envía las entregas guardadas. Una que el servidor ya tiene como entregada (409) también se da por enviada.
export async function enviarPendientes() {
  if (enviando || !navigator.onLine) return 0;
  enviando = true;
  let enviadas = 0;
  try {
    for (const x of await entregasPendientes()) {
      const fd = new FormData();
      fd.append('foto', x.foto, 'entrega.jpg');
      if (x.lat != null && x.lon != null) { fd.append('lat', x.lat); fd.append('lon', x.lon); if (x.precision) fd.append('precision', x.precision); }
      if (x.receptor) fd.append('receptor', x.receptor);
      fd.append('hora_entrega', x.hora);
      try {
        await enviarForm(`/api/envios/${x.envioId}/entregar`, fd);
        enviadas++;
      } catch (err) {
        if (err.status === 0) break; // sigue sin señal: se reintenta después
        if (err.status !== 409 && err.status !== 404) continue; // otro error: se deja para revisarlo
      }
      await tabla('readwrite', (t) => t.delete(x.envioId));
    }
  } finally { enviando = false; }
  if (enviadas) toast(`${enviadas} entrega(s) guardada(s) sin conexión ya se enviaron`, 'ok');
  return enviadas;
}

// Copia local de lo último que se vio con señal (ruta y detalle de envíos).
export function guardarCopia(clave, datos) {
  try { localStorage.setItem(`envios.copia.${clave}`, JSON.stringify(datos)); } catch { /* sin almacenamiento */ }
}
export function leerCopia(clave) {
  try { return JSON.parse(localStorage.getItem(`envios.copia.${clave}`)); } catch { return null; }
}

if (typeof window !== 'undefined' && 'indexedDB' in window) {
  window.addEventListener('online', () => { enviarPendientes(); });
  setInterval(() => { enviarPendientes(); }, 60_000);
}
