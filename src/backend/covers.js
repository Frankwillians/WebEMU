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
 * GitHub, porém navegável) e fica em cache na memória por 24 h.
 */

const COVER_FOLDERS = ['Named_Boxarts', 'Named_Snaps', 'Named_Titles'];
const COVER_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails';
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

/** Busca exata (HEAD) nos candidatos: pasta × nome sanitizado. */
async function resolveExact(repos, rawName) {
  const norm = normalizeCoverName(rawName);
  const variants = norm && norm !== rawName ? [norm, rawName] : [norm];
  for (const repo of repos) {
    for (const folder of COVER_FOLDERS) {
      for (const variant of variants) {
        if (!variant) continue;
        const url = `${COVER_BASE}/${repo}/master/${folder}/${encodeURIComponent(variant)}.png`;
        try {
          const r = await fetch(url, { method: 'HEAD' });
          if (r.ok) return url;
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

  for (const repo of repos) {
    const files = await coverIndex(repo);
    const file = matchCoverFile(files, rawName);
    if (file) return `${COVER_BASE}/${repo}/master/Named_Boxarts/${encodeURIComponent(file)}`;
  }
  return null;
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
