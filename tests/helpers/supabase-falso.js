// Servidor mínimo que imita la API de Supabase Storage, para probar el driver sin internet.
import http from 'node:http';

export function iniciarSupabaseFalso({ clave = 'sb_secret_prueba', puerto = 0 } = {}) {
  const buckets = new Map();
  const objetos = new Map();
  const servidor = http.createServer(async (req, res) => {
    const partes = [];
    for await (const p of req) partes.push(p);
    const cuerpo = Buffer.concat(partes);
    const url = new URL(req.url, 'http://x');
    const r = url.pathname.replace(/^\/storage\/v1/, '');
    const json = (status, d) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const esPublico = r.startsWith('/object/public/');
    if (!esPublico && req.headers.apikey !== clave) return json(401, { error: 'Unauthorized' });
    if (clave.startsWith('eyJ') && !esPublico && req.headers.authorization !== `Bearer ${clave}`) return json(401, { error: 'Invalid JWT' });
    let m;
    if (req.method === 'GET' && (m = r.match(/^\/bucket\/([^/]+)$/))) {
      return buckets.has(m[1]) ? json(200, buckets.get(m[1])) : json(400, { statusCode: '404', error: 'Bucket not found' });
    }
    if (req.method === 'POST' && r === '/bucket') {
      const b = JSON.parse(cuerpo.toString());
      if (buckets.has(b.id)) return json(409, { error: 'Duplicate' });
      buckets.set(b.id, b);
      return json(200, { name: b.id });
    }
    if (esPublico) {
      return json(400, { error: 'not public' });
    }
    if (req.method === 'POST' && (m = r.match(/^\/object\/([^/]+)\/(.+)$/))) {
      if (!buckets.has(m[1])) return json(404, { error: 'Bucket not found' });
      const k = `${m[1]}/${m[2]}`;
      if (objetos.has(k)) return json(409, { error: 'Duplicate' });
      objetos.set(k, { cuerpo, tipo: req.headers['content-type'] });
      return json(200, { Key: k });
    }
    if (req.method === 'GET' && (m = r.match(/^\/object\/authenticated\/([^/]+)\/(.+)$/))) {
      const o = objetos.get(`${m[1]}/${m[2]}`);
      if (!o) return json(400, { statusCode: '404', error: 'not_found' });
      res.writeHead(200, { 'Content-Type': o.tipo });
      return res.end(o.cuerpo);
    }
    if (req.method === 'DELETE' && (m = r.match(/^\/object\/([^/]+)$/))) {
      for (const p of JSON.parse(cuerpo.toString()).prefixes) objetos.delete(`${m[1]}/${p}`);
      return json(200, []);
    }
    json(404, { error: 'ruta no simulada' });
  });
  return new Promise((resolve) => servidor.listen(puerto, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${servidor.address().port}`, clave, buckets, objetos, cerrar: () => servidor.close(),
  })));
}

// Uso directo: node tests/helpers/supabase-falso.js 54321
if (process.argv[1]?.endsWith('supabase-falso.js')) {
  iniciarSupabaseFalso({ puerto: Number(process.argv[2] || 54321) }).then((s) => console.log(`Supabase Storage falso en ${s.url} (clave ${s.clave})`));
}
