/**
 * Capa do jogo na Vercel.
 *
 * A resolução (nome + console → imagem no libretro-thumbnails, exata e depois
 * aproximada) vive em `src/backend/covers.js` e **não depende do PC que tem os
 * jogos**: é só catálogo externo. Por isso a função não é mais um proxy para o
 * backend local — ela resolve e entrega a imagem aqui mesmo.
 *
 * Uso: GET /api/cover?system=ps1&name=Final%20Fantasy%20VII
 *      GET /api/cover?system=ps1&url=https://exemplo/capa.png  (capa manual)
 */
import { sendCover } from '../src/backend/covers.js';

export default function handler(req, res) {
  return sendCover(req, res);
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 30
};
