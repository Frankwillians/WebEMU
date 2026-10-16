/**
 * Build da Vercel.
 *
 * A Vercel espera por padrão a saída estática em `public/` na raiz do projeto.
 * Como a nossa página já é 100% estática e vive em `frontend/public`, este
 * script apenas **copia** essa pasta para `public/` na hora do deploy.
 *
 * Além dela, sobe o **PPSSPP Web** em `public/ppsspp/`: a alternativa
 * "PPSSPP Web (WASM)" do PSP tem que existir também no site publicado (não só no
 * PC). O build é de terceiros (root-hunter/ppsspp-web, GPL-2.0-or-later) e NÃO é
 * versionado — se a pasta local existir copiamos, senão o próprio script de
 * espelhamento baixa direto para a saída.
 *
 * Assim o deploy funciona independentemente do "Output Directory" configurado
 * no painel da Vercel (o padrão dela é justamente `public`).
 */
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'frontend', 'public');
const dest = resolve(root, 'public');

if (!existsSync(src)) {
  console.error('[vercel-build] Pasta de origem não encontrada:', src);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log('[vercel-build] Copiado frontend/public -> public (saida estatica pronta)');

// ---------------------------------------------------------------- PPSSPP Web
const ppssppLocal = resolve(root, 'ppsspp-web');
const ppssppOut = resolve(dest, 'ppsspp');
let ppssppOk = false;

if (existsSync(resolve(ppssppLocal, 'index.html'))) {
  await cp(ppssppLocal, ppssppOut, { recursive: true });
  ppssppOk = existsSync(resolve(ppssppOut, 'index.html'));
  console.log('[vercel-build] Copiado ppsspp-web -> public/ppsspp');
} else {
  execFileSync(process.execPath, [resolve(root, 'scripts', 'fetch-ppsspp-web.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, PPSSPP_DIR: 'public/ppsspp' }
  });
  ppssppOk = existsSync(resolve(ppssppOut, 'index.html'));
  console.log('[vercel-build] Espelhado o PPSSPP Web -> public/ppsspp');
}

if (!ppssppOk) {
  // Falhar aqui é de propósito: sem o build, o botão do PSP levaria a um 404 no
  // site publicado — melhor o deploy parar e ficar claro o motivo.
  console.error('[vercel-build] public/ppsspp ficou vazio: o PPSSPP Web não subiu');
  process.exit(1);
}
