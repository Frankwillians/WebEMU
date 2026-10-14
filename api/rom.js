/**
 * Proxy de ROMs para Vercel (serverless function).
 *
 * Problema: Frontend no Vercel (HTTPS) não pode buscar ROMs do backend local (HTTP)
 * devido a Mixed Content. Esta função roda no servidor da Vercel (HTTPS) e faz o
 * fetch para o backend local, retornando o arquivo para o frontend.
 *
 * Uso: GET /api/rom?url=http://192.168.1.5:3999/roms/ps1/game.iso
 *
 * Headers necessários:
 * - Cross-Origin-Resource-Policy: cross-origin (para COEP require-corp)
 * - Access-Control-Allow-Origin: * (CORS)
 * - Range support (para seeking em ISOs grandes)
 */

export default async function handler(req, res) {
  // Vercel passa query params em req.query
  const target = (req.query && req.query.url) ? String(req.query.url).trim() : '';

  if (!target) {
    return res.status(400).json({ error: 'Parâmetro "url" ausente' });
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: 'URL inválida' });
  }

  // Só permite http/https (sem file:, data:, etc.)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Somente URLs http(s) são permitidas' });
  }

  // Bloqueia hosts privados perigosos (loopback, link-local, etc.) exceto se for
  // explicitamente um IP de rede local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const hostname = parsed.hostname;
  const isLocalIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (!isLocalIP && !isLocalhost) {
    // Permite qualquer host público (ex.: GitHub releases, archive.org) mas avisa
    console.log('[PROXY] Fetching public URL:', target);
  }

  // Headers para o fetch upstream
  const headers = { 'User-Agent': 'webemu-proxy/1.0' };
  if (req.headers.range) headers.Range = req.headers.range;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const upstream = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status === 404 ? 404 : 502)
        .json({ error: 'Origem respondeu HTTP ' + upstream.status });
    }

    // Status: 200 ou 206 (Partial Content)
    res.status(upstream.status);

    // Repassa headers essenciais
    const passHeaders = [
      'content-type', 'content-length', 'content-range', 'accept-ranges',
      'last-modified', 'etag', 'cache-control'
    ];
    for (const h of passHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    // Fallback content-type
    if (!res.getHeader('content-type')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }

    // Headers CORS/CORP para funcionar no EmulatorJS sob COEP require-corp
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    if (upstream.body) {
      // Node 18+ tem Readable.fromWeb
      const { Readable } = await import('stream');
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout ao buscar a ROM (60s)' });
    }
    console.error('[PROXY] Erro:', e);
    return res.status(502).json({ error: 'Falha ao buscar a ROM: ' + e.message });
  }
}

// OPTIONS para preflight CORS
export async function options(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
}

export const config = {
  // Aumenta o limite de body (não usado aqui, mas bom ter)
  api: { bodyParser: false },
  // Timeout maior para ISOs grandes (Vercel Hobby = 60s, Pro = 300s)
  maxDuration: 60
};