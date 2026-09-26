// Descubre automáticamente el "Session pooler" de un proyecto Supabase a partir de
// SUPABASE_URL y SUPABASE_DB_PASSWORD, para no tener que copiar la URL de conexión a mano.
// El pooler responde "Tenant or user not found" cuando el proyecto no está en esa región.

export const REGIONES_SUPABASE = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
];

export function refDeProyecto(supabaseUrl) {
  const m = String(supabaseUrl || '').match(/^https?:\/\/([a-z0-9]{15,30})\.supabase\.co\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

// URL del Session pooler (puerto 5432). La contraseña se codifica: puede tener @ : / # ?
export function urlPooler(ref, password, host) {
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

export function candidatos(ref, password) {
  const lista = [];
  for (const prefijo of ['aws-0', 'aws-1']) {
    for (const region of REGIONES_SUPABASE) {
      const host = `${prefijo}-${region}.pooler.supabase.com`;
      lista.push({ region, host, url: urlPooler(ref, password, host) });
    }
  }
  return lista;
}

// probar(url) debe resolver si conecta o rechazar con el error de pg.
export async function descubrirPooler({ ref, password, probar }) {
  const lista = candidatos(ref, password);
  const resultados = await Promise.allSettled(lista.map((c) => probar(c.url).then(() => c)));
  const ok = resultados.find((r) => r.status === 'fulfilled');
  if (ok) return ok.value;
  const errores = resultados.map((r) => r.reason);
  const clave = errores.find((e) => /password authentication failed|28P01/.test(`${e?.code} ${e?.message}`));
  if (clave) {
    const err = new Error('Se encontró el proyecto en Supabase, pero la contraseña de la base (SUPABASE_DB_PASSWORD) es incorrecta.');
    err.code = '28P01';
    throw err;
  }
  const inalcanzable = errores.every((e) => /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|timeout/i.test(`${e?.code} ${e?.message}`));
  throw new Error(inalcanzable
    ? 'No se pudo contactar ningún pooler de Supabase (¿sin acceso a internet o proyecto pausado?).'
    : `No se encontró el pooler del proyecto "${ref}". Revisa SUPABASE_URL o copia la URL del Session pooler en DATABASE_URL.`);
}
