/**
 * Proxy de capas (box art) para Vercel.
 *
 * O backend local resolve a URL no libretro-thumbnails (GitHub) e serve a imagem.
 * No Vercel, fazemos proxy para evitar Mixed Content (HTTPS frontend → HTTP backend).
 *
 * Uso: GET /api/cover?system=ps1&name=Final%20Fantasy%20VII
 */

export default async function handler(req, res) {
  const system = (req.query && req.query.system) ? String(req.query.system).trim() : '';
  const name = (req.query && req.query.name) ? String(req.query.name).trim() : '';

  if (!system || !name) {
    return res.status(400).json({ error: 'Parâmetros "system" e "name" obrigatórios' });
  }

  const apiBase = process.env.LOCAL_API_BASE || 'http://192.168.1.5:3999';
  const target = `${apiBase}/api/systems/${encodeURIComponent(system)}/cover?name=${encodeURIComponent(name)}`;

  try {
    const img = await fetch(target, {
      headers: { 'User-Agent': 'webemu-cover-proxy/1.0' },
      redirect: 'follow'
    });

    if (!img.ok || !img.body) {
      return res.status(img.status || 502).end();
    }

    res.status(200);
    const ct = img.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const len = img.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    // Cache longo (capas não mudam)
    res.setHeader('Cache-Control', 'public, max-age=1209600, immutable');

    // CORS/CORP para COEP
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { Readable } = await import('stream');
    Readable.fromWeb(img.body).pipe(res);
  } catch (e) {
    console.error('[COVER PROXY] Erro:', e);
    return res.status(502).end();
  }
}

export async function options(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 30
};