/**
 * Adaptador serverless da Vercel.
 *
 * Na Vercel o projeto é publicado como site estático (frontend/public) + funções.
 * Este arquivo reaproveita o `server.js` (que só chama `app.listen` quando NÃO
 * está na Vercel) para expor o backend em `/api/*`.
 *
 * ---------------------------------------------------------------- CORREÇÃO ---
 * Quando a Vercel entrega o "resto" do caminho como PARÂMETRO DE QUERY chamado
 * "...all" — com os três pontos! — o Express só vê o primeiro segmento e não
 * encontra as rotas de VÁRIOS segmentos (`/api/systems/:id/games`, …):
 *
 *   GET /api/systems/ps1/games    →  req.url = "/api/systems?...all=ps1/games"
 *
 * Este adaptador remonta o caminho antes de entregar ao Express.
 *
 * **Importante:** verificado em produção, hoje a Vercel **não** entrega rotas de
 * vários segmentos a esta função — ela responde `NOT_FOUND` por conta própria.
 * Não conte com elas no site publicado: cada recurso que o site precisa tem
 * função própria de um segmento (ex.: a capa é `api/cover.js`).
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
