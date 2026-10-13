/**
 * Adaptador serverless da Vercel.
 *
 * Na Vercel o projeto é publicado como site estático (frontend/public) + funções.
 * Este arquivo expõe TODO o backend Express em `/api/*` reaproveitando o
 * `server.js` (que só chama `app.listen` quando NÃO está na Vercel).
 *
 * O que funciona na Vercel (modo "web"):
 *   • Emulador rodando no navegador (EmulatorJS/WASM) — todos os consoles;
 *   • Capas dos jogos (/api/systems/:id/cover → libretro-thumbnails);
 *   • Rodar por ARQUIVO escolhido no aparelho (input/drag&drop);
 *   • Rodar por LINK (URL) da ROM — com ou sem proxy (/api/rom).
 *
 * O que NÃO existe em serverless (naturalmente):
 *   • Biblioteca de ROMs no disco do servidor (não há disco persistente);
 *   • Abrir o jogo no RetroArch do "PC servidor";
 *   • WebSocket/Signaling para netplay.
 */
export { default } from '../src/backend/server.js';
