/**
 * Adaptador serverless da Vercel.
 *
 * Na Vercel o projeto é publicado como site estático (frontend/public) + funções.
 * Este arquivo expõe TODO o backend Express em `/api/*` reaproveitando o
 * `server.js` (que só chama `app.listen` quando NÃO está na Vercel).
 *
 * ---------------------------------------------------------------- CORREÇÃO ---
 * Descoberto na prática: a Vercel entrega o "resto" do caminho
 * como um PARÂMETRO DE QUERY chamado "...all" — com os três pontos! Ou seja:
 *
 *   GET /api/netplay/ice          →  req.url = "/api/netplay?...all=ice"
 *   GET /api/systems/ps1/games    →  req.url = "/api/systems?...all=ps1/games"
 *   GET /api/health               →  req.url = "/api/health?...all=health"
 *
 * Sem corrigir, o Express só vê "/api/netplay" (um segmento) e não encontra as
 * rotas de VÁRIOS segmentos — /api/netplay/ice, /api/systems/:id/games,
 * /api/systems/:id/cover… — devolvendo 404, enquanto as de um segmento
 * (/api/health, /api/systems) funcionavam. Aqui reconstruímos o caminho correto
 * antes de entregar ao Express.
 */
import app from '../src/backend/server.js';

export default function handler(req, res) {
  try {
    const q = req.query || {};
    // A Vercel usa "...all" (com pontos). Mantemos "all" como fallback.
    const raw = (q['...all'] !== undefined && q['...all'] !== null) ? q['...all'] : q.all;

    if (raw !== undefined && raw !== null) {
      const rest = Array.isArray(raw) ? raw.join('/') : String(raw);

      if (rest) {
        // Remonta a query real, sem o parâmetro do catch-all.
        const params = [];
        for (const k of Object.keys(q)) {
          if (k === '...all' || k === 'all') continue;
          const v = q[k];
          const vals = Array.isArray(v) ? v : [v];
          vals.forEach((x) => params.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)));
        }
        const qs = params.length ? '?' + params.join('&') : '';

        // Junta o caminho que a Vercel manteve com o resto que veio em "...all",
        // Sem repetir segmento (o Vercel às vezes repete o 1º, às vezes não).
        const urlAtual = String(req.url || '').split('?')[0];
        const segs = urlAtual.split('/').filter(Boolean);
        for (const s of rest.split('/').filter(Boolean)) {
          if (segs[segs.length - 1] !== s) segs.push(s);
        }
        const corrigido = '/' + segs.join('/') + qs;
        if (corrigido !== req.url) req.url = corrigido;
      }
    }
  } catch {
    /* se der qualquer coisa, segue com o caminho que veio */
  }
  return app(req, res);
}
