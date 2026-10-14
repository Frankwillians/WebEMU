#!/usr/bin/env node
/**
 * Gera um certificado autoassinado em certs/ para habilitar o servidor HTTPS.
 *
 * Por que isso existe: PSP (PPSSPP) e DOS (DOSBox Pure) só têm build *threaded*
 * no EmulatorJS e exigem `SharedArrayBuffer`. O navegador só expõe
 * `SharedArrayBuffer` em um **contexto seguro** (HTTPS ou localhost) + cross-origin
 * isolation. Em HTTP na rede local (ex.: http://192.168.0.5:3000) o PSP não roda.
 *
 * Uso:  npm run cert
 *
 * Requer o OpenSSL (o Git para Windows já inclui). Se não tiver, o script
 * explica as alternativas (incluindo a flag do Chrome).
 */

import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const certsDir = resolve(root, 'certs');
mkdirSync(certsDir, { recursive: true });

const keyPath = resolve(certsDir, 'key.pem');
const certPath = resolve(certsDir, 'cert.pem');

function opensslCandidates() {
  const list = [];
  if (process.env.OPENSSL_BIN) list.push(process.env.OPENSSL_BIN);
  if (process.platform === 'win32') {
    // No Windows preferimos os OpenSSL "completos" (Git for Windows, OpenSSL-Win64)
    // ANTES do `openssl` do PATH: alguns (ex.: o de uma Anaconda) não acham o
    // openssl.cnf e falham ao gerar o certificado.
    list.push(
      'C:/Program Files/Git/usr/bin/openssl.exe',
      'C:/Program Files/Git/mingw64/bin/openssl.exe',
      'C:/Program Files (x86)/Git/usr/bin/openssl.exe',
      'C:/Program Files/OpenSSL-Win64/bin/openssl.exe',
      'C:/Program Files/OpenSSL/bin/openssl.exe'
    );
  }
  list.push('openssl');
  return list;
}

function findOpenssl() {
  const probeKey = resolve(certsDir, '.probe-key.pem');
  const probeCert = resolve(certsDir, '.probe-cert.pem');
  for (const bin of opensslCandidates()) {
    try {
      // Não basta `version`: sondamos gerando um certificado de teste, porque
      // alguns OpenSSL falham só na hora de emitir (config ausente).
      const r = spawnSync(bin, [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-subj', '/CN=ps1emu-probe', '-days', '1',
        '-keyout', probeKey, '-out', probeCert
      ], { stdio: 'ignore' });
      if (r.status === 0) {
        try { rmSync(probeKey, { force: true }); rmSync(probeCert, { force: true }); } catch { /* ok */ }
        return bin;
      }
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

function localIPs() {
  const ips = new Set(['127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const it of list || []) {
      // Node moderno expõe `address` (o antigo `IPAddress` virou undefined e o
      // certificado saía SEM o IP da LAN -> https://SEU-IP:3443 dava erro de nome).
      const ip = it.address || it.IPAddress;
      if (it.family === 'IPv4' && !it.internal && ip) ips.add(ip);
    }
  }
  return [...ips];
}

const openssl = findOpenssl();
if (!openssl) {
  console.error('\n[ERRO] OpenSSL nao encontrado.\n');
  console.error('Instale uma das opcoes:');
  console.error('  - Git for Windows (ja vem com openssl): https://git-scm.com/download/win');
  console.error('  - Ou defina OPENSSL_BIN=C:\\caminho\\para\\openssl.exe\n');
  console.error('Alternativa rapida (sem HTTPS), no celular:');
  console.error('  Abra chrome://flags/#unsafely-treat-insecure-origin-as-secure');
  console.error('  e adicione http://SEU-IP:3000  ->  Enabled -> Relaunch.\n');
  process.exit(1);
}

const ips = localIPs();
const san = ['DNS:localhost', ...ips.map((ip) => `IP:${ip}`)].join(',');

console.log('[CERT] Gerando certificado autoassinado...');
console.log('[CERT] OpenSSL:', openssl);
console.log('[CERT] Incluindo no certificado:', san);

try {
  execFileSync(
    openssl,
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '3650',
      '-subj', '/CN=ps1emu',
      '-addext', `subjectAltName=${san}`
    ],
    { stdio: 'inherit' }
  );
} catch (e) {
  console.error('\n[ERRO] Falha ao gerar o certificado:', e.message);
  console.error('Dica: verifique se o OpenSSL tem suporte a -addext (1.1.1+).');
  process.exit(1);
}

const lanIP =
  ips
    .filter((ip) => ip !== '127.0.0.1')
    .sort((a, b) => rankIP(a) - rankIP(b))[0] || 'SEU-IP';

// Prefere a rede real (192.168/10/172.16-31) e evita faixas de adaptadores de
// VM/VPN (VirtualBox 192.168.56/99, libvirt 192.168.122, Docker 172.17/10.0.2…).
function rankIP(ip) {
  if (/^(192\.168\.(56|99|122|64)\.|172\.17\.|10\.0\.2\.|10\.211\.55\.|10\.37\.129\.)/.test(ip)) return 9;
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

console.log('\n[CERT] OK! Certificado criado em:');
console.log('  ' + keyPath);
console.log('  ' + certPath);
console.log('\nReinicie o servidor (npm start) e acesse, no celular:');
console.log(`  https://${lanIP}:3443/play.html`);
console.log('\nO navegador vai avisar que o certificado nao e confiavel (autoassinado).');
console.log('Isso e esperado: toque em "Avancado" -> "Continuar". Assim a pagina vira');
console.log('um contexto seguro e o PSP/DOS passam a rodar no navegador.\n');
