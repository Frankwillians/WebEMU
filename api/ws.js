/**
 * Endpoint WebSocket para a VERCEL (netplay online).
 *
 * A Vercel não permite que a função serverless `api/[...all].js` (que exporta o
 * Express) mantenha WebSockets, mas as Vercel Functions suportam WebSocket
 * nativamente (beta público) quando o módulo exporta um `http.Server` com o
 * `WebSocketServer` do `ws` anexado.
 *
 * Este arquivo é o sinalizador das salas quando o projeto está publicado na
 * Vercel. O frontend entra nesse modo pela opção "🌐 Online (Vercel)" no painel
 * de netplay — e o link de convite já carrega `?ws=wss://…/api/ws`, então o
 * convidado conecta sozinho, em qualquer aparelho e em qualquer rede.
 *
 * Rota servida: /api/ws        (ver também o rewrite de /signaling no vercel.json)
 *
 * LIMITAÇÃO conhecida (documentada pela Vercel): as conexões novas não caem
 * necessariamente na MESMA instância da função. O lobby guarda as salas em
 * memória, então host e convidado precisam cair na mesma instância. Com poucos
 * jogadores (2 a 4) isso acontece na grande maioria das vezes; se algum dia
 * falhar, a solução Durável é usar Redis/Marketplace para o estado das salas.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { attachSignaling } from '../src/backend/signaling.js';

// Servidor HTTP mínimo: existe só para o upgrade do WebSocket e para dar uma
// resposta amigável a quem abrir /api/ws no navegador.
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    service: 'webemu-signaling',
    websocket: '/api/ws',
    hint: 'Conecte via wss:// (o frontend faz isso pelo painel "Jogar em rede").'
  }));
});

// Sem `path`: a Vercel já roteia /api/ws para esta função, então aceitamos o
// upgrade de qualquer caminho que chegue aqui.
const wss = new WebSocketServer({ server });
attachSignaling(wss);

export default server;
