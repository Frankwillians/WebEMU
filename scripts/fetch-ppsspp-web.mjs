/**
 * Baixa o build JÁ PUBLICADO do PPSSPP Web (root-hunter/ppsspp-web) para a pasta
 * local `ppsspp-web/` — fora do git, como `recomp/`. Essa pasta alimenta o
 * console "PSP (PPSSPP Web)" em `/ppsspp/`.
 *
 * Por que baixar em vez de compilar: o motor é o PPSSPP compilado para
 * WebAssembly (Emscripten) — um build pesado que exige o SDK do Emscripten e
 * ~300 MB de fonte. O projeto publica o resultado pronto; espelhamos esse
 * resultado para servir na NOSSA origem, com COOP/COEP (threads/áudio), o que
 * a hospedagem do GitHub Pages não oferece.
 *
 * Uso:
 *   node scripts/fetch-ppsspp-web.mjs
 *
 * Variáveis:
 *   PPSSPP_WEB_URL  base do artefato (padrão: o GitHub Pages do projeto)
 *   PPSSPP_DIR      pasta de destino (padrão: <raiz>/ppsspp-web)
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const BASE = (process.env.PPSSPP_WEB_URL || 'https://root-hunter.github.io/ppsspp-web/').replace(/\/?$/, '/');
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(PROJECT_ROOT, process.env.PPSSPP_DIR || 'ppsspp-web');
const CONCURRENCY = 8;

/** Arquivos obrigatórios do motor (a ausência deles invalida o build). */
const ENGINE_FILES = [
  'index.html',
  'assets-manifest.txt',
  'build-wasm/PPSSPPSDL.js',
  'build-wasm/PPSSPPSDL.wasm',
  'build-wasm/PPSSPPSDL.data'
];

/** Descobre os arquivos a baixar a partir do índice e do manifesto. */
async function collect() {
  const wanted = new Set();

  const fetchText = async (rel) => {
    const r = await fetch(BASE + rel, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
    return r.text();
  };

  const index = await fetchText('index.html');
  wanted.add('index.html');
  // Bundles com hash do shell Angular (main-*.js / styles-*.css).
  for (const m of index.matchAll(/["']([\w\-.]+\.(?:js|css))["']/g)) wanted.add(m[1]);

  // Manifesto dos assets do PPSSPP (fica em build-wasm/assets/).
  const manifest = await fetchText('assets-manifest.txt');
  wanted.add('assets-manifest.txt');
  for (const line of manifest.split(/\r?\n/)) {
    const name = line.trim();
    if (name) wanted.add('build-wasm/assets/' + name);
  }

  // Runtime + PWA + motor.
  for (const f of ['ppsspp-runtime.js', 'sw.js', 'manifest.webmanifest', ...ENGINE_FILES]) wanted.add(f);

  // Ícones/screenshots do PWA.
  try {
    const pwa = JSON.parse(await fetchText('manifest.webmanifest'));
    for (const item of [...(pwa.icons || []), ...(pwa.screenshots || [])]) {
      if (item && item.src) wanted.add(item.src);
    }
  } catch {
    // webmanifest é opcional
  }

  return [...wanted];
}

/** Baixa um arquivo para OUT/rel (preservando a estrutura de pastas). */
async function download(rel, stats) {
  const res = await fetch(BASE + rel, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = join(OUT, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  stats.bytes += buf.length;
  stats.done += 1;
  process.stdout.write(`\r  ${stats.done}/${stats.total} arquivos · ${(stats.bytes / 1048576).toFixed(1)} MB`);
}

/** Executa `task` sobre `items` com no máximo `limit` em paralelo. */
async function pool(items, limit, task) {
  const failures = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await task(item);
      } catch (e) {
        failures.push(`${item} — ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

async function main() {
  console.log(`PPSSPP Web → ${OUT}`);
  console.log(`Fonte: ${BASE}\n`);

  const files = await collect();
  console.log(`Baixando ${files.length} arquivos…`);

  const stats = { done: 0, total: files.length, bytes: 0 };
  const failures = await pool(files, CONCURRENCY, (rel) => download(rel, stats));
  process.stdout.write('\n');

  if (failures.length) {
    console.error(`\n⚠️  ${failures.length} arquivo(s) falharam:`);
    for (const f of failures.slice(0, 20)) console.error('   - ' + f);
  }

  const engineOk = ENGINE_FILES.every((f) => !failures.some((x) => x.startsWith(f + ' ')));
  if (!engineOk) {
    console.error('\n❌ O motor (PPSSPPSDL.js/.wasm/.data) não foi baixado por completo.');
    process.exit(1);
  }

  console.log(`\n✅ Pronto: ${stats.done}/${stats.total} arquivos · ${(stats.bytes / 1048576).toFixed(1)} MB`);
  console.log('   Reinicie o servidor: o botão "PPSSPP Web (WASM)" passa a aparecer no PSP.');
  console.log('   Abra em: http://localhost:3000/ppsspp/');
}

main().catch((e) => {
  console.error('\n❌ Falha ao baixar o PPSSPP Web:', e.message);
  process.exit(1);
});
