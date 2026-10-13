/**
 * Build da Vercel.
 *
 * A Vercel espera por padrão a saída estática em `public/` na raiz do projeto.
 * Como a nossa página já é 100% estática e vive em `frontend/public`, este
 * script apenas **copia** essa pasta para `public/` na hora do deploy.
 *
 * Assim o deploy funciona independentemente do "Output Directory" configurado
 * no painel da Vercel (o padrão dela é justamente `public`).
 */
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
