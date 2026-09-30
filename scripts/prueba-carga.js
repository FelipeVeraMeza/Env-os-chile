// Prueba de carga (RNF-09): muchos clientes, repartidores y administración usando la app al mismo tiempo.
//   node scripts/prueba-carga.js [URL] [--clientes 40] [--repartidores 15] [--envios 5]
// Cada cliente crea y paga sus envíos, administración los asigna, cada repartidor los retira y los entrega
// con foto + GPS, y mientras tanto todos refrescan sus listas. Al final verifica que no haya errores,
// que los folios sean únicos y que todos los envíos terminen entregados.
// Usa solo la API pública de la app. Crea usuarios y envíos "QA …": no usar contra la base del cliente.
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => { const i = args.indexOf(`--${nombre}`); return i >= 0 ? Number(args[i + 1]) : porDefecto; };
process.env.QA_API_URL = args.find((a) => /^https?:\/\//.test(a)) || process.env.QA_API_URL || 'http://localhost:3000';
const { API, crearUsuarioQa, comunaEnCobertura, datosEnvio, formulario, jpegPrueba, peticion, sesionAdmin } = await import('../qa/cliente.js');

const N_CLIENTES = opcion('clientes', 40);
const N_REPARTIDORES = opcion('repartidores', 15);
const N_ENVIOS = opcion('envios', 5);

const tiempos = {};
const errores = [];
async function medir(operacion, fn) {
  const t0 = performance.now();
  const r = await fn();
  (tiempos[operacion] ||= []).push(performance.now() - t0);
  if (r.status >= 400) errores.push({ operacion, status: r.status, error: r.datos?.error });
  return r;
}
const percentil = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

console.log(`\n▶ Prueba de carga contra ${API}`);
console.log(`  ${N_CLIENTES} clientes · ${N_REPARTIDORES} repartidores · ${N_ENVIOS} envíos por cliente = ${N_CLIENTES * N_ENVIOS} envíos\n`);

const admin = await sesionAdmin();
const comuna = await comunaEnCobertura();
const clientes = await Promise.all(Array.from({ length: N_CLIENTES }, (_, i) => crearUsuarioQa(admin, 'cliente', `Carga${i}`)));
const repartidores = await Promise.all(Array.from({ length: N_REPARTIDORES }, (_, i) => crearUsuarioQa(admin, 'repartidor', `Carga${i}`)));

const inicio = performance.now();
let asignados = 0;

// 1) Clientes: crean, confirman y pagan; administración asigna cada envío apenas está pagado.
const creados = (await Promise.all(clientes.map(async (cli, i) => {
  const propios = [];
  for (let n = 0; n < N_ENVIOS; n++) {
    const c = await medir('crear envío', () => peticion('POST', '/api/envios', { sesion: cli, json: { ...datosEnvio(comuna.id), confirmar: true } }));
    if (c.status !== 201) continue;
    const p = await medir('subir comprobante', () => peticion('POST', `/api/envios/${c.datos.id}/comprobante`, { sesion: cli, form: formulario({}, { archivo: [jpegPrueba(), 'comprobante.jpg'] }) }));
    if (p.status !== 201) continue;
    await medir('aprobar comprobante', () => peticion('POST', `/api/cobranza/comprobantes/${p.datos.id}/aprobar`, { sesion: admin, json: {} }));
    const rep = repartidores[(i * N_ENVIOS + n) % repartidores.length];
    const a = await medir('asignar', () => peticion('POST', `/api/envios/${c.datos.id}/asignar`, { sesion: admin, json: { repartidor_id: rep.usuario.id } }));
    if (a.status === 200) asignados++;
    await medir('listar mis envíos', () => peticion('GET', '/api/envios?limite=20', { sesion: cli }));
    propios.push(c.datos);
  }
  return propios;
}))).flat();

// 2) Repartidores: cada uno recorre su ruta (retira y entrega con foto + GPS) mientras refresca la lista.
await Promise.all(repartidores.map(async (rep) => {
  const ruta = await medir('ver mi ruta', () => peticion('GET', '/api/envios?estado=asignado&limite=100', { sesion: rep }));
  for (const e of ruta.datos.items || []) {
    await medir('retirar', () => peticion('POST', `/api/envios/${e.id}/estado`, { sesion: rep, json: { estado: 'en_ruta' } }));
    await medir('entregar (foto+GPS)', () => peticion('POST', `/api/envios/${e.id}/entregar`, {
      sesion: rep, form: formulario({ lat: -33.4263, lon: -70.617, precision: 10, receptor: 'Titular' }, { foto: [jpegPrueba(), 'entrega.jpg'] }),
    }));
    await medir('ver mi ruta', () => peticion('GET', '/api/envios?estado=asignado,en_ruta&limite=100', { sesion: rep }));
  }
}));

// 3) Administración revisa el panel mientras tanto.
await medir('panel de ganancias', () => peticion('GET', '/api/reportes/ganancias', { sesion: admin }));
const duracion = (performance.now() - inicio) / 1000;

// Verificación de consistencia.
const folios = creados.map((e) => e.folio);
const finales = await Promise.all(creados.map((e) => peticion('GET', `/api/envios/${e.id}`, { sesion: admin })));
const entregados = finales.filter((r) => r.datos.estado === 'entregado').length;
const totalSolicitudes = Object.values(tiempos).reduce((s, xs) => s + xs.length, 0);

console.log('  Operación                 n     p50 ms   p95 ms   máx ms');
for (const [op, xs] of Object.entries(tiempos)) {
  console.log(`  ${op.padEnd(22)} ${String(xs.length).padStart(5)} ${percentil(xs, 50).toFixed(0).padStart(9)} ${percentil(xs, 95).toFixed(0).padStart(8)} ${Math.max(...xs).toFixed(0).padStart(8)}`);
}
const todas = Object.values(tiempos).flat();
console.log(`\n  ${totalSolicitudes} solicitudes en ${duracion.toFixed(1)} s (${(totalSolicitudes / duracion).toFixed(0)}/s) · p95 global ${percentil(todas, 95).toFixed(0)} ms`);
console.log(`  Envíos creados ${creados.length}/${N_CLIENTES * N_ENVIOS} · asignados ${asignados} · entregados ${entregados} · folios únicos ${new Set(folios).size === folios.length ? 'sí' : 'NO'}`);
console.log(`  Errores: ${errores.length}${errores.length ? ` → ${JSON.stringify(errores.slice(0, 5))}` : ''}\n`);

const ok = !errores.length && entregados === N_CLIENTES * N_ENVIOS && new Set(folios).size === folios.length && percentil(todas, 95) < 2000;
console.log(ok ? '✔ La app soportó la carga sin errores ni datos inconsistentes.\n' : '✖ La prueba de carga encontró problemas.\n');
process.exit(ok ? 0 : 1);
