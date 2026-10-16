/**
 * Capas dos jogos (box art).
 *
 * O nome do jogo é resolvido para uma imagem no projeto libretro-thumbnails.
 * Primeiro tentamos o casamento **exato** (HEAD em `Named_Boxarts` → `Named_Snaps`
 * → `Named_Titles`); se não achar, tentamos um casamento **aproximado** dentro do
 * console, usando o índice de arquivos de `Named_Boxarts`.
 *
 * Por que o índice: o libretro nomeia pelo padrão No-Intro/Redump ("Super Mario
 * World (USA)"), enquanto um jogo aberto por link pode vir como `Super Mario
 * World (T-Pt).zip` ou `super_mario_world`. Buscar por título (ignorando
 * região/tags e extensão) resolve bem mais casos — é o pedido de "capa de
 * acordo com o nome e o console".
 *
 * O índice é a listagem do host `thumbnails.libretro.com` (o mesmo conteúdo do
 * GitHub, porém navegável) e fica em cache na memória por 24 h. As imagens
 * também saem desse host — é ele que resolve os *symlinks* do repositório
 * (ver `THUMBS_HOST`).
 *
 * `sendCover` é a ponta HTTP: vive aqui para o **mesmo** código atender o
 * servidor local (`/api/cover`) e a função serverless da Vercel
 * (`api/cover.js`). A capa depende só de nome + console (catálogo externo),
 * então não precisa do PC que tem os jogos.
 */

import { Readable } from 'node:stream';
import { getSystem, boxartRepos } from './systems.js';
import { isBlockedProxyHost } from './proxy.js';

const COVER_FOLDERS = ['Named_Boxarts', 'Named_Snaps', 'Named_Titles'];
// As capas saem do MESMO host navegável usado no índice. O
// `raw.githubusercontent.com` não serve: boa parte do repositório é *symlink*
// (vários títulos apontam para um arquivo só) e ele entrega o **texto do link**
// ("ActRaiser (USA).png", 19 bytes) em vez da imagem — era o que deixava a capa
// quebrada. O host navegável resolve o symlink e devolve o PNG.
const THUMBS_HOST = 'https://thumbnails.libretro.com';

const INDEX_TTL = 24 * 60 * 60 * 1000; // 24h
const INDEX_MAX = 8;                    // quantos consoles ficam em memória

const coverUrlCache = new Map();   // "systemId|nome"  → URL da capa | null
const coverIndexCache = new Map(); // repo             → { at, files: string[] }

/**
 * Normaliza o nome no estilo libretro-thumbnails (sanitiza caracteres proibidos).
 * Usado no casamento exato, onde o nome do arquivo precisa bater.
 */
export function normalizeCoverName(name) {
  return String(name)
    .replace(/\.[a-z0-9]{1,4}$/i, '')   // remove extensão, se houver
    .replace(/[&*/:`<>?\\|]/g, '_');    // caracteres trocados por "_" no libretro
}

/**
 * Chave de comparação tolerante: minúsculas, sem extensão, sem tags entre
 * parênteses/colchetes (região, revisão, idioma...) e sem pontuação.
 * `Super Mario World (USA) [T+Pt].zip` → `super mario world`.
 */
export function coverKey(name) {
  return String(name)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Região declarada entre parênteses (0=World, 1=USA, 2=Europe, 5=Japan) ou null. */
function regionOf(text) {
  const t = String(text).toLowerCase();
  if (/\(world\b/.test(t)) return 0;
  if (/\(usa\b/.test(t)) return 1;
  if (/\(europe\b/.test(t)) return 2;
  if (/\(japan\b/.test(t)) return 5;
  return null;
}

/** Peso de região para o desempate padrão (menor = preferida). */
function regionWeight(text) {
  const r = regionOf(text);
  return r === null ? 4 : r;
}

/** Escolhe `a` em vez de `b`? (score desc; região pedida; preferência padrão; menos tags). */
function preferCandidate(a, b, qRegion) {
  if (a.score !== b.score) return a.score > b.score;
  if (qRegion !== null) {
    const aHit = a.region === qRegion ? 0 : 1;
    const bHit = b.region === qRegion ? 0 : 1;
    if (aHit !== bHit) return aHit < bHit;
  }
  if (a.weight !== b.weight) return a.weight < b.weight;
  if (a.tags !== b.tags) return a.tags < b.tags;
  return a.file.length < b.file.length;
}

/**
 * Escolhe o melhor nome de arquivo do índice para o nome pedido.
 * Retorna o nome do arquivo (ex.: `Super Mario World (USA).png`) ou null.
 */
export function matchCoverFile(files, rawName) {
  const q = coverKey(rawName);
  if (!q) return null;
  const qTokens = q.split(' ').filter(Boolean);
  const qRegion = regionOf(rawName);

  let best = null;
  for (const file of files) {
    const c = coverKey(file);
    if (!c) continue;

    let score = 0;
    if (c === q) {
      score = 1000;
    } else {
      const cTokens = c.split(' ').filter(Boolean);
      const cSet = new Set(cTokens);
      let inter = 0;
      for (const t of qTokens) if (cSet.has(t)) inter++;
      if (!inter) continue;
      const jaccard = inter / new Set(qTokens.concat(cTokens)).size;
      const cobertura = inter / qTokens.length;
      if (jaccard < 0.34) continue;          // casamento fraco
      if (cobertura < 1 && jaccard < 0.5) continue;
      score = 500 * jaccard + 300 * cobertura;
    }
    if (score < 300) continue;

    const cand = {
      file,
      score,
      region: regionOf(file),
      weight: regionWeight(file),
      tags: (file.match(/\(/g) || []).length
    };
    if (!best || preferCandidate(cand, best, qRegion)) best = cand;
  }
  return best ? best.file : null;
}

/**
 * Índice dos arquivos de `Named_Boxarts` de um repositório do libretro-thumbnails.
 * Fica em cache na memória com TTL e um teto de consoles.
 */
export async function coverIndex(repo) {
  const now = Date.now();
  const hit = coverIndexCache.get(repo);
  if (hit && now - hit.at < INDEX_TTL) return hit.files;

  let files = [];
  try {
    const host = repo.replace(/_/g, ' ');
    const url = `https://thumbnails.libretro.com/${encodeURIComponent(host)}/Named_Boxarts/`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ps1emu/1.0' } });
    if (r.ok) {
      const html = await r.text();
      const re = /href="([^"]+\.png)"/gi;
      const seen = new Set();
      let m;
      while ((m = re.exec(html))) {
        let f = m[1].replace(/^.*\//, '');
        try { f = decodeURIComponent(f); } catch { /* mantém como veio */ }
        if (f && f !== '..' && !seen.has(f)) { seen.add(f); files.push(f); }
      }
    }
  } catch {
    // sem índice (rede fora, sistema sem pasta): segue sem busca aproximada
  }

  coverIndexCache.set(repo, { at: Date.now(), files });
  if (coverIndexCache.size > INDEX_MAX) {
    coverIndexCache.delete(coverIndexCache.keys().next().value);
  }
  return files;
}

/** URL de um arquivo de capa no host navegável (`repo` com `_` → espaço). */
function coverFileUrl(repo, folder, file) {
  return `${THUMBS_HOST}/${encodeURIComponent(repo.replace(/_/g, ' '))}/${folder}/${encodeURIComponent(file)}`;
}

/** Busca exata (HEAD) nos candidatos: pasta × nome sanitizado. */
async function resolveExact(repos, rawName) {
  const norm = normalizeCoverName(rawName);
  const variants = norm && norm !== rawName ? [norm, rawName] : [norm];
  for (const repo of repos) {
    for (const folder of COVER_FOLDERS) {
      for (const variant of variants) {
        if (!variant) continue;
        const url = coverFileUrl(repo, folder, `${variant}.png`);
        try {
          const r = await fetch(url, { method: 'HEAD' });
          // Só aceitamos resposta que é imagem: um 200 com HTML/texto (página
          // de erro de rede, host trocado) não pode virar "capa".
          if (r.ok && String(r.headers.get('content-type') || '').startsWith('image/')) return url;
        } catch {
          // tenta o próximo candidato
        }
      }
    }
  }
  return null;
}

/**
 * Resolve a URL da capa para o(s) repositório(s) de um console.
 * Exato primeiro; aproximado (no console) depois. Devolve a URL ou null.
 */
export async function resolveCoverUrl(repos, rawName) {
  const exact = await resolveExact(repos, rawName);
  if (exact) return exact;

  // Na função serverless não há memória entre chamadas nem tempo para indexar o
  // catálogo (milhares de nomes): a busca aproximada ficaria pendurada até o
  // limite da função e voltaria vazia. Lá vale só o casamento exato, que é rápido.
  if (process.env.VERCEL) return null;

  for (const repo of repos) {
    const files = await coverIndex(repo);
    const file = matchCoverFile(files, rawName);
    if (file) return coverFileUrl(repo, 'Named_Boxarts', file);
  }
  return null;
}

/** Envia uma imagem de capa já buscada, com cache e cabeçalhos amigáveis ao COEP. */
function streamCover(img, res) {
  res.setHeader('Cache-Control', 'public, max-age=1209600, immutable'); // 14 dias
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', img.headers.get('content-type') || 'image/png');
  // Content-Length NÃO vem do upstream: o corpo pode chegar descomprimido
  // (gzip) e um tamanho errado derruba a imagem no navegador
  // (ERR_CONTENT_LENGTH_MISMATCH) e desalinha a conexão HTTP. Sem ele, o Node
  // fecha a resposta em chunks.
  Readable.fromWeb(img.body).pipe(res);
}

/** Busca (e valida) a imagem de uma URL de capa manual. */
async function fetchManualCover(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isBlockedProxyHost(url.hostname)) return null;
  try {
    const r = await fetch(url.href, { headers: { 'User-Agent': 'ps1emu/1.0' }, redirect: 'follow' });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

/**
 * Capa de um jogo, por nome (exata + aproximada) ou por URL manual:
 *
 *   GET /api/cover?system=snes&name=Super%20Mario%20World
 *   GET /api/cover?system=snes&url=https://exemplo/capa.png
 *
 * Serve tanto o Express (`app.get('/api/cover', sendCover)`) quanto a função
 * serverless da Vercel (`api/cover.js`).
 */
export async function sendCover(req, res) {
  const q = req.query || {};
  const system = getSystem(String(q.system || '').trim());
  if (!system) { res.statusCode = 404; return res.end(); }

  const manual = String(q.url || '').trim();
  if (manual) {
    const img = await fetchManualCover(manual);
    if (!img || !img.body) { res.statusCode = 404; return res.end(); }
    return streamCover(img, res);
  }

  const name = String(q.name || '').trim();
  if (!name) { res.statusCode = 400; return res.end(); }

  const repos = boxartRepos(system.id);
  if (!repos.length) { res.statusCode = 404; return res.end(); }

  let url;
  if (hasCachedCoverUrl(system.id, name)) {
    url = getCachedCoverUrl(system.id, name);
  } else {
    url = await resolveCoverUrl(repos, name);
    setCachedCoverUrl(system.id, name, url);
  }
  if (!url) { res.statusCode = 404; return res.end(); }

  try {
    const img = await fetch(url);
    if (!img.ok || !img.body) { res.statusCode = 502; return res.end(); }
    streamCover(img, res);
  } catch (error) {
    console.error('[COVER] Erro ao buscar capa:', error.message);
    if (!res.headersSent) { res.statusCode = 502; res.end(); }
  }
}

/** Cache do de-para nome→URL (evita refazer HEAD/busca a cada request). */
export function getCachedCoverUrl(systemId, name) {
  return coverUrlCache.get(systemId + '|' + String(name).toLowerCase());
}

export function setCachedCoverUrl(systemId, name, url) {
  coverUrlCache.set(systemId + '|' + String(name).toLowerCase(), url);
}

export function hasCachedCoverUrl(systemId, name) {
  return coverUrlCache.has(systemId + '|' + String(name).toLowerCase());
}

/** Limpa os caches (usado em testes). */
export function clearCoverCaches() {
  coverUrlCache.clear();
  coverIndexCache.clear();
}
