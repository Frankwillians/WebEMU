/**
 * Adaptador serverless da Vercel.
 *
 * Na Vercel o projeto é publicado como site estático (frontend/public) + funções.
 * Este arquivo expõe TODO o backend Express em `/api/*` reaproveitando o
 * `server.js` (que só chama `app.listen` quando NÃO está na Vercel).
 *
 * IMPORTANTE (correção): em alguns roteamentos a Vercel entrega o caminho
 * "incompleto" em `req.url` (por exemplo apenas o primeiro segmento). Com isso o
 * Express não encontra as rotas de VÁRIOS segmentos — `/api/netplay/ice`,
 * `/api/systems/:id/games`, `/api/systems/:id/cover`… — e devolve 404, enquanto
 * `/api/health` (um segmento) funciona. Os parâmetros do catch-all chegam em
 * `req.query.all`; com eles reconstruímos o caminho correto antes de chamar o
 * Express. Funciona nos dois casos: se o caminho já estiver certo, não muda nada.
 */
import app from '../src/backend/server.js';

export default function handler(req, res) {
  try {
    const all = req.query && req.query.all;
    if (Array.isArray(all) && all.length) {
      const rest = all.map((s) => decodeURIComponent(String(s))).join('/');
      const url = String(req.url || '');
      const qi = url.indexOf('?');
      const qs = qi >= 0 ? url.slice(qi) : '';
      const corrigido = '/api/' + rest + qs;
      if (corrigido !== req.url) req.url = corrigido;
    }
  } catch {
    /* se der qualquer coisa, segue com o caminho que veio */
  }
  return app(req, res);
}
