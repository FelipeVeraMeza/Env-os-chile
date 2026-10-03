// Optimización del orden de la ruta del repartidor (pedido 03-10).
// Las direcciones casi nunca tienen coordenadas (no se usa un servicio de geocodificación externo), así que cada
// parada se ubica por sus coordenadas GPS si las tiene o, si no, por el centro aproximado de su comuna. Con eso se
// arma la ruta con "vecino más cercano" desde donde está el repartidor y se mejora con 2-opt. Dentro de una misma
// comuna se mantienen juntas las paradas de la misma calle.

// Centro aproximado de las comunas en cobertura (provincia de Santiago + Puente Alto + San Bernardo).
export const CENTRO_COMUNA = {
  Santiago: [-33.4489, -70.6693], Cerrillos: [-33.4997, -70.7120], 'Cerro Navia': [-33.4250, -70.7353],
  'Conchalí': [-33.3843, -70.6750], 'El Bosque': [-33.5616, -70.6750], 'Estación Central': [-33.4594, -70.6984],
  Huechuraba: [-33.3669, -70.6380], Independencia: [-33.4170, -70.6650], 'La Cisterna': [-33.5300, -70.6640],
  'La Florida': [-33.5227, -70.5986], 'La Granja': [-33.5390, -70.6250], 'La Pintana': [-33.5833, -70.6333],
  'La Reina': [-33.4450, -70.5350], 'Las Condes': [-33.4150, -70.5830], 'Lo Barnechea': [-33.3500, -70.5180],
  'Lo Espejo': [-33.5208, -70.6900], 'Lo Prado': [-33.4440, -70.7250], Macul: [-33.4900, -70.5990],
  'Maipú': [-33.5100, -70.7570], 'Ñuñoa': [-33.4569, -70.5970], 'Pedro Aguirre Cerda': [-33.4930, -70.6780],
  'Peñalolén': [-33.4870, -70.5430], Providencia: [-33.4320, -70.6090], Pudahuel: [-33.4400, -70.7600],
  Quilicura: [-33.3600, -70.7300], 'Quinta Normal': [-33.4280, -70.6970], Recoleta: [-33.4060, -70.6400],
  Renca: [-33.4060, -70.7280], 'San Joaquín': [-33.4950, -70.6280], 'San Miguel': [-33.4960, -70.6510],
  'San Ramón': [-33.5410, -70.6450], Vitacura: [-33.3900, -70.5960], 'Puente Alto': [-33.6117, -70.5758],
  'San Bernardo': [-33.5922, -70.6997],
};
// Centro de Santiago: punto de partida si no hay GPS, y ubicación de comunas fuera de la tabla.
const CENTRO = CENTRO_COMUNA.Santiago;

// Distancia en km entre dos puntos [lat, lon].
export function distanciaKm([lat1, lon1], [lat2, lon2]) {
  const rad = (g) => (g * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// Ubicación de una parada: GPS si lo tiene, si no el centro de su comuna. La calle desempata paradas de la
// misma comuna (quedan juntas y en orden de calle).
export function ubicar({ lat, lon, comuna }) {
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== null && lon !== null) return [Number(lat), Number(lon)];
  return CENTRO_COMUNA[comuna] || CENTRO;
}

// paradas: [{ id, lat, lon, comuna, calle }]. Devuelve los ids en el orden sugerido.
export function optimizarRuta(paradas, inicio = null) {
  if (paradas.length < 2) return paradas.map((p) => p.id);
  const pts = paradas.map((p) => ({ ...p, pos: ubicar(p), clave: `${p.comuna || ''}|${String(p.calle || '').toLowerCase()}` }));
  const origen = inicio && Number.isFinite(inicio[0]) && Number.isFinite(inicio[1]) ? inicio : CENTRO;
  // Vecino más cercano; con empate de distancia (misma comuna sin GPS) gana la misma calle y luego el orden alfabético.
  const pendientes = [...pts];
  const orden = [];
  let actual = { pos: origen, clave: null };
  while (pendientes.length) {
    pendientes.sort((a, b) => {
      const d = distanciaKm(actual.pos, a.pos) - distanciaKm(actual.pos, b.pos);
      if (Math.abs(d) > 1e-9) return d;
      if ((a.clave === actual.clave) !== (b.clave === actual.clave)) return a.clave === actual.clave ? -1 : 1;
      return a.clave.localeCompare(b.clave, 'es') || a.id - b.id;
    });
    actual = pendientes.shift();
    orden.push(actual);
  }
  // 2-opt: invierte tramos mientras acorte el recorrido total. Hasta 60 paradas (más allá el vecino más cercano
  // ya es una buena ruta y el cálculo dejaría de ser instantáneo).
  const largo = (r) => r.reduce((s, p, i) => s + distanciaKm(i ? r[i - 1].pos : origen, p.pos), 0);
  let mejor = orden;
  let mejoro = orden.length <= 60;
  for (let vueltas = 0; mejoro && vueltas < 50; vueltas++) {
    mejoro = false;
    for (let i = 0; i < mejor.length - 1; i++) {
      for (let k = i + 1; k < mejor.length; k++) {
        const prueba = [...mejor.slice(0, i), ...mejor.slice(i, k + 1).reverse(), ...mejor.slice(k + 1)];
        if (largo(prueba) < largo(mejor) - 1e-6) { mejor = prueba; mejoro = true; }
      }
    }
  }
  return mejor.map((p) => p.id);
}
