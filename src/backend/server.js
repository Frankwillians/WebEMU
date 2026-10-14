/**
 * Servidor Principal HTTP + WebSocket Signaling
 * Serve API REST para ROMs, arquivos estáticos do frontend e WebSocket para Netplay
 */

import express from 'express';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import cors from 'cors';
import { join, resolve, sep, basename } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces, hostname } from 'os';
import { existsSync, mkdirSync, statSync, readdirSync, readFileSync } from 'fs';
import { execFile } from 'node:child_process';

/**
 * Descobre o melhor IP LAN da máquina.
 *
 * Ignora adaptadores virtuais/VPN (Hamachi, VirtualBox, VMware, Hyper-V,
 * Tailscale, ZeroTier, Docker, Bluetooth...) que aparecem antes do Wi-Fi/Ethernet
 * de verdade e fazem o usuário apontar o celular para o endereço errado.
 * Prefere faixas privadas (192.168.x, 10.x, 172.16-31.x).
 */
function getLocalIP() {
  const nets = networkInterfaces();
  const skip = /hamachi|virtualbox|vmware|hyper-?v|vethernet|loopback|bluetooth|tailscale|zerotier|wintun|wireguard|docker|vpn|tun\b|tap\b/i;
  const candidates = [];

  for (const name of Object.keys(nets)) {
    if (skip.test(name)) continue;
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // link-local
      candidates.push({ name, address: net.address });
    }
  }

  const pick =
    candidates.find(c => /^192\.168\./.test(c.address)) ||
    candidates.find(c => /^10\./.test(c.address)) ||
    candidates.find(c => /^172\.(1[6-9]|2\d|3[01])\./.test(c.address)) ||
    candidates[0];

  if (pick) return pick.address;

  // Último recurso: qualquer IPv4 não-interno
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
import config, { projectRoot } from './config.js';
import gameStorage, { GameStorage, normalizeGamesDir, isUncPath } from './storage.js';
import biosStorage, { KNOWN_BIOS } from './bios.js';
import { loadSettings, saveSettings, settingsPath } from './settings.js';
import setupSignalingServer from './signaling.js';
import {
  SYSTEMS,
  getSystem,
  defaultDirFor,
  detectRetroArch,
  findRetroCore,
  boxartRepos
} from './systems.js';
import { spawn } from 'child_process';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// ==================== CENTRAL DE EMULAÇÃO (multi-console) ====================
//
// Cada console tem a sua própria instância de GameStorage (pasta + extensões).
// O PS1 mantém a instância histórica `gameStorage` (pasta `games/`, configurável
// em runtime). O PS2 mantém a pasta `ps2games/`. Os demais usam `roms/<id>/`
// por padrão e podem ser reapontados por /api/config.
const storages = new Map();

/** Instância de GameStorage de um sistema (ou undefined) */
function storageFor(systemId) {
  return storages.get(String(systemId));
}

for (const system of SYSTEMS) {
  if (system.id === 'ps1') {
    // A pasta do PS1 vive em gameStorage (compatibilidade) e pode ser trocada.
    storages.set('ps1', gameStorage);
    continue;
  }
  const dir = system.id === 'ps2' ? config.ps2Dir : defaultDirFor(system);
  storages.set(system.id, new GameStorage({ dir, extensions: system.extensions }));
}

const ps2Storage = storages.get('ps2');

/** RetroArch (emulador nativo) detectado no PC host, se houver */
let retroarchExe = detectRetroArch();

/**
 * Troca a pasta de uma instância de GameStorage, criando-a se necessário.
 * @returns {string} caminho absoluto aplicado
 */
function setStorageDir(storage, dir) {
  const target = normalizeGamesDir(dir);
  const unc = isUncPath(target);
  // Em pasta compartilhada (UNC) nunca criamos nada: se não está acessível é
  // erro de endereço/permissão do outro PC. Validamos ANTES de aplicar, para
  // uma tentativa falha não deixar a configuração corrompida na memória.
  if (!existsSync(target)) {
    if (unc) {
      throw new Error('Pasta compartilhada inacessível. Confira o endereço (\\\\PC\\pasta) e as permissões do outro PC.');
    }
    mkdirSync(target, { recursive: true });
  }
  if (!statSync(target).isDirectory()) {
    throw new Error('O caminho informado não é uma pasta');
  }
  return storage.setGamesDir(target);
}

/** Monta a URL pública (/roms ou /ps2roms) para um jogo indexado */
function buildGameUrl(prefix, relativePath) {
  return prefix + String(relativePath).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

/** URL pública de um jogo da central: /roms/<systemId>/<caminho> */
function systemGameUrl(systemId, relativePath) {
  return buildGameUrl(`/roms/${systemId}/`, relativePath);
}

/** Serializa um jogo indexado para a API (sem caminhos absolutos) */
function serializeGame(systemId, g) {
  return {
    id: g.id,
    system: systemId,
    name: g.name,
    fileName: g.fileName,
    extension: g.extension,
    size: g.size,
    sizeFormatted: g.sizeFormatted,
    modified: g.modified,
    url: systemGameUrl(systemId, g.relativePath)
  };
}

/**
 * Metadados públicos de um sistema (usados pelo seletor de consoles).
 * Inclui contagem de jogos e modos de execução disponíveis.
 */
async function describeSystem(system) {
  const storage = storageFor(system.id);
  if (storage) await storage.scanGames();

  const cores = system.cores || [];
  const modes = ['web'];
  const nativeCore = findRetroCore(system, retroarchExe);
  if (nativeCore) modes.push('host');

  return {
    id: system.id,
    name: system.name,
    short: system.short,
    icon: system.icon,
    color: system.color,
    category: system.category || 'Outros',
    kind: system.kind || 'emulatorjs',
    page: system.page || null,
    note: system.note || null,
    needsBios: Boolean(system.needsBios),
    extensions: system.extensions,
    cores,
    defaultCore: cores.length ? cores[0].id : null,
    modes,
    native: Boolean(nativeCore),
    dir: storage ? storage.getGamesDir() : null,
    count: storage ? storage.cache.size : 0
  };
}

/**
 * Resumo leve dos consoles (sem tocar no disco) — usado pelo /api/health e
 * pela descoberta na rede, que precisam de uma resposta rápida.
 */
function systemsSummary() {
  return SYSTEMS.map((system) => {
    const storage = storageFor(system.id);
    return {
      id: system.id,
      name: system.name,
      short: system.short,
      icon: system.icon,
      color: system.color || null,
      category: system.category || 'Outros',
      kind: system.kind || 'emulatorjs',
      count: storage ? storage.cache.size : 0
    };
  });
}

/** Nome amigável desta instância (aparece na lista de servidores) */
function serverName() {
  try {
    return `WebEMU · ${hostname()}`;
  } catch {
    return 'WebEMU';
  }
}

// ==================== NETPLAY: ICE (STUN/TURN) ====================
// Configuração dos servidores ICE usados pelo WebRTC do netplay.
// STUN sozinho resolve a maioria das redes locais, mas pela internet (NAT
// simétrico / CGNAT de operadora) é preciso um TURN para retransmitir o vídeo.
// Por padrão usamos um TURN público gratuito (Open Relay, da Metered); dá para
// trocar pelos seus próprios dados via variáveis de ambiente:
//   TURN_URLS="turn:meu.turn:3478,turns:meu.turn:5349"
//   TURN_USERNAME="usuario"  TURN_CREDENTIAL="senha"
const STUN_DEFAULT = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

function iceServers() {
  const urls = String(process.env.TURN_URLS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length) {
    return [
      ...STUN_DEFAULT,
      { urls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' }
    ];
  }
  return [
    ...STUN_DEFAULT,
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ];
}

const app = express();
const httpServer = createServer(app);

// Middlewares
app.use(cors({
  origin: config.corsOrigin,
  // Necessário para que o EmulatorJS consiga ler tamanho/range dos arquivos
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging de requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (config.logLevel === 'debug' || res.statusCode >= 400) {
      console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Token de acesso (opcional): protege a API quando ACCESS_TOKEN está definido.
// Ficam abertos apenas /api/health e /api/netplay/ice (para a página se identificar).
app.use((req, res, next) => {
  if (!ACCESS_TOKEN) return next();
  const p = req.path || '';
  if (!p.startsWith('/api/')) return next();
  if (p === '/api/health' || p === '/api/netplay/ice') return next();

  const fromQuery = (req.query && req.query.token) || '';
  const fromHeader = req.get('x-webemu-token') || '';
  const auth = req.get('authorization') || '';
  const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';

  if (fromQuery === ACCESS_TOKEN || fromHeader === ACCESS_TOKEN || bearer === ACCESS_TOKEN) {
    return next();
  }
  return res.status(401).json({ error: 'Acesso restrito: informe o token (?token=...).' });
});

// ==================== API REST ====================

// Health check — também serve de "cartão de visita" para a descoberta na rede.
app.get('/api/health', (req, res) => {
  const lanIP = getLocalIP();
  const summary = systemsSummary();
  // Sinalizador online (Vercel): o endpoint /api/ws existe no projeto, então o
  // netplay funciona mesmo em serverless. Pode ser desligado com NETPLAY_WS=0.
  const netplayWsEnabled = !process.env.VERCEL || process.env.NETPLAY_WS !== '0';
  const wsUrl = process.env.VERCEL
    ? (() => {
        const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
        return host ? `wss://${host}/api/ws` : null;
      })()
    : null;
  res.json({
    status: 'ok',
    service: 'webemu',
    name: serverName(),
    version: VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    gamesIndexed: summary.reduce((sum, s) => sum + s.count, 0),
    systems: summary,
    netplay: netplayWsEnabled,
    ws: wsUrl,
    publicUrl: PUBLIC_URL || null,
    lanIP,
    lanUrl: `http://${lanIP}:${config.httpPort}`
  });
});

// Servidores ICE (STUN/TURN) que o netplay usa para atravessar a NAT.
app.get('/api/netplay/ice', (req, res) => {
  res.json({ iceServers: iceServers() });
});

// Diagnóstico: mostra EXATAMENTE o caminho/parâmetros que chegaram ao Express
// e o que a última requisição (mesmo que 404) entregou ao adaptador serverless.
// Usado para depurar o roteamento da Vercel.
app.get('/api/debug', (req, res) => {
  res.json({
    reqUrl: req.url,
    originalUrl: req.originalUrl,
    params: req.params,
    query: req.query,
    lastReqSeen: globalThis.__webemuLastReq || null,
    vercel: {
      VERCEL_URL: process.env.VERCEL_URL || null,
      VERCEL_ENV: process.env.VERCEL_ENV || null,
      isVercel: !!process.env.VERCEL
    }
  });
});

// ==================== DESCOBERTA DE SERVIDORES NA REDE ====================
//
// Varre as sub-redes locais (/24) procurando outras instâncias do WebEMU
// escutando em HTTP/HTTPS, para o jogador se conectar ao servidor de outro
// PC/celular da mesma rede (com os jogos que ele tem).
//
// A resposta traz, para cada servidor encontrado, o resumo dos consoles e a
// contagem de jogos — assim o jogador vê "quem tem o quê" antes de conectar.

const VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// URL pública deste servidor (ex.: o endereço do túnel Cloudflare/ngrok).
// Quando definida, é usada nos links de convite do netplay e mostrada na UI,
// para que o convidado entre mesmo que o host esteja vendo em localhost.
// Ex.: PUBLIC_URL="https://abcd.trycloudflare.com"
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// Token de acesso opcional. Quando definido, protege a API (exceto /api/health
// e /api/netplay/ice) e o WebSocket de sinalização — recomendado ao expor o
// servidor na internet por um túnel. Ex.: ACCESS_TOKEN="minha-senha"
const ACCESS_TOKEN = String(process.env.ACCESS_TOKEN || '');

/** Lista os prefixos /24 das interfaces IPv4 privadas reais (ignora VPN virtuais) */
function localSubnets() {
  const nets = networkInterfaces();
  const skip = /hamachi|virtualbox|vmware|hyper-?v|vethernet|loopback|bluetooth|tailscale|zerotier|wintun|wireguard|docker|vpn|tun\b|tap\b/i;
  const subnets = new Set();

  for (const name of Object.keys(nets)) {
    if (skip.test(name)) continue;
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue;
      const mask = net.netmask ? net.netmask.split('.').map(Number) : [255, 255, 255, 0];
      // Só varremos máscaras /24 ou maiores (cabem 254 hosts) para não explodir.
      if (mask[0] !== 255 || mask[1] !== 255 || mask[2] !== 255) continue;
      const parts = net.address.split('.');
      subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  return Array.from(subnets);
}

/** Consulta /api/health de um host com timeout curto */
async function probeHealth(ip, port, scheme, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${scheme}://${ip}:${port}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.status !== 'ok') return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/discover', async (req, res) => {
  const started = Date.now();
  const timeout = Math.min(2000, Math.max(150, parseInt(req.query.timeout || '450', 10) || 450));
  const subnets = localSubnets();
  const selfIP = getLocalIP();

  // Portas para sondar: HTTP sempre; HTTPS se houver certificado configurado.
  const ports = [{ port: config.httpPort, scheme: 'http' }];
  if (httpsServer) ports.push({ port: config.httpsPort, scheme: 'https' });
  // Também sonda portas alternativas comuns, para achar instâncias que não
  // estejam rodando na porta padrão deste projeto.
  for (const p of [80, 3000, 3443, 8080, 8000]) {
    if (p !== config.httpPort && p !== config.httpsPort) ports.push({ port: p, scheme: 'http' });
  }

  const targets = [];
  for (const base of subnets) {
    for (let host = 1; host <= 254; host++) targets.push(`${base}.${host}`);
  }

  const found = new Map(); // url -> servidor
  let cursor = 0;
  let selfFound = false;

  // IPs desta própria máquina (para não listá-la várias vezes quando há mais
  // de uma interface — ex.: Wi-Fi + adaptador virtual).
  const localIPs = new Set();
  const allNets = networkInterfaces();
  for (const name of Object.keys(allNets)) {
    for (const net of allNets[name] || []) {
      if (net.family === 'IPv4') localIPs.add(net.address);
    }
  }

  async function worker() {
    while (cursor < targets.length) {
      const ip = targets[cursor++];
      // O próprio host responde rápido; deixa para o fim se for muito lento.
      for (const p of ports) {
        const url = `${p.scheme}://${ip}:${p.port}`;
        if (found.has(url)) continue;
        if (localIPs.has(ip) && selfFound) continue;
        const health = await probeHealth(ip, p.port, p.scheme, timeout);
        if (!health) continue;
        if (localIPs.has(ip)) selfFound = true;
        const systems = Array.isArray(health.systems) ? health.systems : [];
        found.set(url, {
          url,
          ip,
          port: p.port,
          https: p.scheme === 'https',
          name: health.name || 'WebEMU',
          version: health.version || null,
          games: systems.reduce((sum, s) => sum + (Number(s.count) || 0), 0),
          systems: systems.map((s) => ({
            id: s.id,
            name: s.name,
            short: s.short,
            icon: s.icon,
            count: Number(s.count) || 0
          })),
          netplay: Boolean(health.netplay),
          self: ip === selfIP && p.port === config.httpPort
        });
      }
    }
  }

  const CONCURRENCY = 64;
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const servers = Array.from(found.values()).sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    if (b.games !== a.games) return b.games - a.games;
    return a.ip.localeCompare(b.ip, undefined, { numeric: true });
  });

  res.json({
    status: 'ok',
    name: serverName(),
    self: `http://${selfIP}:${config.httpPort}`,
    networks: subnets.map((s) => `${s}.0/24`),
    scanned: targets.length,
    durationMs: Date.now() - started,
    servers
  });
});


// ==================== PASTAS COMPARTILHADAS NA REDE (SMB) ====================
//
// Acha as PASTAS COMPARTILHADAS da rede local (o clássico "compartilhamento" do
// Windows) para o jogador indexar os jogos direto de outro PC, sem copiar nada.
// Cada item traz o caminho UNC (\\PC\pasta) e se está acessível.
//
// No Windows usa `net view` (lista de máquinas) e `net view \\PC` (lista de
// compartilhamentos). Em Linux/macOS tenta `smbclient` se estiver instalado.

/** Executa um comando e devolve o stdout (string vazia se falhar). */
function runCmd(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

/** `net view` → lista de computadores (linhas que começam com \\) */
function parseNetViewComputers(out) {
  const pcs = [];
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('\\\\')) continue;
    const m = line.match(/^\\\\([^\s\\]+)\s*(.*)$/);
    if (m) pcs.push({ name: m[1], comment: (m[2] || '').trim() });
  }
  return pcs;
}

/** `net view \\PC` → lista de compartilhamentos de disco */
function parseNetViewShares(out) {
  const shares = [];
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.trim();
    // "Jogos        Disco   Meus jogos de PS1"
    const m = line.match(/^([^\s]+)\s+(Disco|Disk)\b\s*(.*)$/i);
    if (!m) continue;
    if (m[1].endsWith('$')) continue; // compartilhamentos administrativos (C$, ADMIN$)
    shares.push({ name: m[1], comment: (m[3] || '').trim() });
  }
  return shares;
}

/** Dá para ler a pasta? (UNC pode exigir usuário/senha do outro PC) */
function pastaAcessivel(dir) {
  try { readdirSync(dir); return true; } catch { return false; }
}

app.get('/api/shares', async (req, res) => {
  const started = Date.now();
  const shares = [];
  const avisos = [];

  try {
    if (process.platform === 'win32') {
      const eu = (hostname() || '').toUpperCase();
      const pcs = parseNetViewComputers(await runCmd('net', ['view']));

      if (!pcs.length) {
        avisos.push('A "descoberta de rede" do Windows pode estar desligada. Ligue em: Painel de Controle → Central de Rede e Compartilhamento → Alterar configurações de compartilhamento avançadas → ativar "Descoberta de rede" e "Compartilhamento de arquivo e impressora" (perfil privado).');
      }

      const outros = pcs.filter(p => p.name.toUpperCase() !== eu);
      // Limita a 15 PCs para não demorar demais.
      for (const pc of outros.slice(0, 15)) {
        const lista = parseNetViewShares(await runCmd('net', ['view', '\\\\' + pc.name]));
        for (const sh of lista) {
          const unc = '\\\\' + pc.name + '\\' + sh.name;
          shares.push({
            path: unc,
            pc: pc.name,
            share: sh.name,
            comment: sh.comment,
            accessible: pastaAcessivel(unc)
          });
        }
      }
    } else {
      // Linux/macOS: smbclient -L (se existir) — melhor esforço.
      const out = await runCmd('smbclient', ['-L', '-N', '127.0.0.1'], 6000);
      if (out) {
        for (const raw of out.split(/\r?\n/)) {
          const m = raw.match(/^\s*(\S+)\s+Disk/i);
          if (!m || m[1].endsWith('$')) continue;
          shares.push({ path: 'smb://127.0.0.1/' + m[1], pc: '127.0.0.1', share: m[1], comment: '', accessible: false });
        }
      } else {
        avisos.push('A busca completa de pastas compartilhadas funciona no Windows. No Linux/macOS instale o "smbclient".');
      }
    }
  } catch (e) {
    avisos.push('Falha ao procurar pastas: ' + e.message);
  }

  // As que dão para ler vêm primeiro.
  shares.sort((a, b) => (a.accessible === b.accessible) ? 0 : (a.accessible ? -1 : 1));

  res.json({
    status: 'ok',
    shares,
    count: shares.length,
    accessible: shares.filter(s => s.accessible).length,
    avisos,
    durationMs: Date.now() - started
  });
});

// Lista todos os jogos indexados
app.get('/api/games', async (req, res) => {
  try {
    const games = await gameStorage.scanGames();
    // Retorna versão simplificada para lista
    const gameList = games.map(g => ({
      id: g.id,
      name: g.name,
      fileName: g.fileName,
      size: g.size,
      sizeFormatted: g.sizeFormatted,
      extension: g.extension,
      modified: g.modified,
      // URL direta e estável (servida a partir de /roms). Preserva o nome do
      // arquivo, o que permite ao EmulatorJS resolver .cue -> .bin corretamente.
      url: buildGameUrl('/roms/', g.relativePath)
    }));
    res.json({ games: gameList, count: gameList.length });
  } catch (error) {
    console.error('[API] Erro ao listar jogos:', error);
    res.status(500).json({ error: 'Falha ao listar jogos' });
  }
});

// Metadados de um jogo específico
app.get('/api/games/:id', async (req, res) => {
  try {
    const game = await gameStorage.getGame(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Jogo não encontrado' });
    }
    res.json(game);
  } catch (error) {
    console.error('[API] Erro ao buscar jogo:', error);
    res.status(500).json({ error: 'Falha ao buscar jogo' });
  }
});

// Stream/download do arquivo ISO/ROM (com suporte a Range Requests)
app.get('/api/games/:id/download', async (req, res) => {
  try {
    const game = await gameStorage.getGame(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Jogo não encontrado' });
    }

    const range = req.headers.range;
    const streamData = await gameStorage.getGameStream(req.params.id, range);

    if (!streamData) {
      return res.status(500).json({ error: 'Falha ao criar stream' });
    }

    const { stream, start, end, fileSize, contentType, contentLength, isPartial } = streamData;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `inline; filename="${game.fileName}"`);

    if (isPartial) {
      res.status(206); // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    } else {
      res.status(200);
    }

    stream.pipe(res);

    stream.on('error', (err) => {
      console.error('[STREAM] Erro no stream:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro no stream' });
      }
    });

  } catch (error) {
    console.error('[API] Erro no download:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Falha no download' });
    }
  }
});

// Re-scan manual do diretório de jogos
app.post('/api/games/rescan', async (req, res) => {
  try {
    const games = await gameStorage.scanGames(true);
    res.json({ games: games.length, message: 'Reescaneamento concluído' });
  } catch (error) {
    console.error('[API] Erro no rescan:', error);
    res.status(500).json({ error: 'Falha no reescaneamento' });
  }
});

// ==================== BIOS ====================

// Lista BIOS disponíveis
app.get('/api/bios', async (req, res) => {
  try {
    const bios = await biosStorage.list();
    res.json({ bios, count: bios.length, known: Object.keys(KNOWN_BIOS) });
  } catch (error) {
    // Na Vercel (serverless, sem disco) não há pasta de BIOS: responde vazio em
    // vez de estourar 500 e sujar o console de quem está só usando a central.
    if (process.env.VERCEL) {
      return res.json({ bios: [], count: 0, known: Object.keys(KNOWN_BIOS), storage: 'indisponível (serverless)' });
    }
    console.error('[API] Erro ao listar BIOS:', error);
    res.status(500).json({ error: 'Falha ao listar BIOS' });
  }
});

// Upload de BIOS (corpo binário bruto). Nome via ?name=scph5501.bin
app.post(
  '/api/bios/upload',
  express.raw({ type: '*/*', limit: config.maxBiosSize + 1024 }),
  async (req, res) => {
    try {
      const name = req.query.name || req.headers['x-bios-name'];
      const saved = await biosStorage.save(name, req.body);
      res.json({ ok: true, ...saved });
    } catch (error) {
      console.error('[API] Erro no upload de BIOS:', error.message);
      res.status(400).json({ error: error.message });
    }
  }
);

// Remove uma BIOS
app.delete('/api/bios/:name', async (req, res) => {
  try {
    const removed = await biosStorage.remove(req.params.name);
    res.json({ ok: true, ...removed });
  } catch (error) {
    console.error('[API] Erro ao remover BIOS:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// Serve os arquivos de BIOS
app.use('/bios', express.static(resolve(config.biosDir), {
  etag: true,
  index: false,
  setHeaders: (res) => res.setHeader('Accept-Ranges', 'bytes')
}));

// ==================== CONFIGURAÇÕES ====================

// Retorna as configurações atuais (pastas, BIOS, IP da rede...)
app.get('/api/config', (req, res) => {
  const lanIP = getLocalIP();
  const dirs = {};
  for (const [id, storage] of storages) dirs[id] = storage.getGamesDir();
  res.json({
    gamesDir: gameStorage.getGamesDir(),
    ps2Dir: ps2Storage.getGamesDir(),
    dirs,
    biosDir: config.biosDir,
    httpPort: config.httpPort,
    lanIP,
    lanUrl: `http://${lanIP}:${config.httpPort}`,
    settingsFile: settingsPath,
    gamesIndexed: gameStorage.cache.size,
    ps2Indexed: ps2Storage.cache.size,
    retroarch: retroarchExe || null
  });
});

// Troca a pasta de jogos. Aceita:
//   { "system": "snes", "dir": "D:\\roms\\snes" }   (central multi-console)
//   { "dirs": { "snes": "...", "nes": "..." } }
//   { "gamesDir": "..." } / { "ps2Dir": "..." }      (compatibilidade)
// Persistido em ps1emu.config.json.
app.post('/api/config', async (req, res) => {
  try {
    const body = req.body || {};
    const requested = [];

    if (body.system && body.dir) {
      requested.push([body.system, body.dir]);
    }
    if (body.dirs && typeof body.dirs === 'object') {
      for (const [id, dir] of Object.entries(body.dirs)) requested.push([id, dir]);
    }
    if (body.gamesDir) requested.push(['ps1', body.gamesDir]);
    if (body.ps2Dir) requested.push(['ps2', body.ps2Dir]);

    if (!requested.length) {
      return res.status(400).json({
        error: 'Informe "system"+"dir", "dirs", "gamesDir" ou "ps2Dir"'
      });
    }

    const patch = { dirs: { ...(loadSettings().dirs || {}) } };
    const result = { ok: true, dirs: {} };
    const msgs = [];

    for (const [systemId, dir] of requested) {
      const system = getSystem(systemId);
      const storage = storageFor(systemId);
      if (!system || !storage) {
        return res.status(400).json({ error: `Console desconhecido: ${systemId}` });
      }
      const target = setStorageDir(storage, dir);
      patch.dirs[systemId] = target;
      const games = await storage.scanGames(true);
      result.dirs[systemId] = target;
      result[`${systemId}Dir`] = target;
      result[`${systemId}Indexed`] = games.length;
      msgs.push(`${system.short}: ${games.length} jogo(s)`);
    }

    saveSettings(patch);
    result.message = `Pasta atualizada. ${msgs.join(' · ')}.`;
    res.json(result);
  } catch (error) {
    console.error('[API] Erro ao alterar configuração:', error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== PS2 (experimental — Play! .js) ====================

// Lista os jogos de PS2 indexados
app.get('/api/ps2/games', async (req, res) => {
  try {
    const games = await ps2Storage.scanGames();
    const list = games.map(g => ({
      id: g.id,
      name: g.name,
      fileName: g.fileName,
      size: g.size,
      sizeFormatted: g.sizeFormatted,
      extension: g.extension,
      modified: g.modified,
      url: buildGameUrl('/ps2roms/', g.relativePath)
    }));
    res.json({ games: list, count: list.length, dir: ps2Storage.getGamesDir() });
  } catch (error) {
    console.error('[API] Erro ao listar jogos PS2:', error);
    res.status(500).json({ error: 'Falha ao listar jogos PS2' });
  }
});

// Reindexa a pasta de PS2
app.post('/api/ps2/rescan', async (req, res) => {
  try {
    const games = await ps2Storage.scanGames(true);
    res.json({ ok: true, count: games.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CENTRAL DE EMULAÇÃO (multi-console) ====================

// Lista os consoles com contagem de jogos e modos de execução
app.get('/api/systems', async (req, res) => {
  try {
    const systems = [];
    for (const system of SYSTEMS) {
      systems.push(await describeSystem(system));
    }
    res.json({
      systems,
      count: systems.length,
      totalGames: systems.reduce((acc, s) => acc + s.count, 0),
      retroarch: retroarchExe || null,
      native: Boolean(retroarchExe)
    });
  } catch (error) {
    console.error('[API] Erro ao listar sistemas:', error);
    res.status(500).json({ error: 'Falha ao listar sistemas' });
  }
});

// Lista os jogos de um console
app.get('/api/systems/:id/games', async (req, res) => {
  const system = getSystem(req.params.id);
  if (!system) return res.status(404).json({ error: 'Console não encontrado' });
  const storage = storageFor(system.id);
  try {
    const games = await storage.scanGames();
    res.json({
      system: system.id,
      dir: storage.getGamesDir(),
      games: games.map((g) => serializeGame(system.id, g)),
      count: games.length
    });
  } catch (error) {
    console.error('[API] Erro ao listar jogos do sistema:', error);
    res.status(500).json({ error: 'Falha ao listar jogos' });
  }
});

// Reindexa a pasta de um sistema
app.post('/api/systems/:id/rescan', async (req, res) => {
  const system = getSystem(req.params.id);
  const storage = storageFor(req.params.id);
  if (!system || !storage) return res.status(404).json({ error: 'Sistema não encontrado' });
  try {
    const games = await storage.scanGames(true);
    res.json({ ok: true, count: games.length, dir: storage.getGamesDir() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Abre um jogo no emulador NATIVO (RetroArch) do PC servidor.
// É o modo "usar o poder do dispositivo": roda no PC, não no navegador.
app.post('/api/systems/:id/launch', async (req, res) => {
  const system = getSystem(req.params.id);
  if (!system) return res.status(404).json({ error: 'Console não encontrado' });

  // Re-detecta o RetroArch (pode ter sido instalado depois do boot)
  if (!retroarchExe) retroarchExe = detectRetroArch();
  if (!retroarchExe) {
    return res.status(400).json({
      error: 'RetroArch não encontrado no PC servidor. Defina RETROARCH_PATH ou instale o RetroArch.'
    });
  }

  const core = findRetroCore(system, retroarchExe);
  if (!core) {
    return res.status(400).json({
      error: `Sem core nativo para ${system.name} (procure por "${system.retroCore}" em RetroArch/cores).`
    });
  }

  const storage = storageFor(system.id);
  const gameId = req.body && req.body.gameId;
  if (!gameId) return res.status(400).json({ error: 'Informe "gameId"' });

  const game = await storage.getGame(gameId);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });

  try {
    const child = spawn(retroarchExe, ['-L', core, game.fullPath], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    console.log(`[NATIVE] Abrindo ${game.name} em ${system.short} (${core})`);
    res.json({ ok: true, message: `Abrindo ${game.name} no PC servidor…`, core });
  } catch (error) {
    console.error('[NATIVE] Erro ao abrir RetroArch:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CAPAS DOS JOGOS (box art) ====================
// Busca a capa no projeto libretro-thumbnails (GitHub) e faz proxy da imagem.
// Assim as capas aparecem no navegador mesmo quando o aparelho não acessa o
// GitHub diretamente. O "de-para" nome→URL fica em cache na memória.

const COVER_FOLDERS = ['Named_Boxarts', 'Named_Snaps', 'Named_Titles'];
const COVER_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails';
const coverUrlCache = new Map(); // "systemId|nome" → URL da capa | null

/** Normaliza o nome no estilo libretro-thumbnails (sanitiza caracteres proibidos). */
function normalizeCoverName(name) {
  return String(name)
    .replace(/\.[a-z0-9]{1,4}$/i, '')   // remove extensão, se houver
    .replace(/[&*/:`<>?\\|]/g, '_');    // caracteres trocados por "_" no libretro
}

/** Testa (HEAD) os candidatos e devolve a URL da primeira capa existente, ou null. */
async function resolveCoverUrl(repos, rawName) {
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
          // ignora e tenta o próximo candidato
        }
      }
    }
  }
  return null;
}

// Capa de um jogo (proxy com cache). Ex.: /api/systems/snes/cover?name=Super%20Mario%20World%20(USA)
app.get('/api/systems/:id/cover', async (req, res) => {
  const system = getSystem(req.params.id);
  if (!system) return res.status(404).end();
  const repos = boxartRepos(system.id);
  if (!repos.length) return res.status(404).end();

  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).end();

  const key = system.id + '|' + name.toLowerCase();
  let url;
  if (coverUrlCache.has(key)) {
    url = coverUrlCache.get(key);
  } else {
    url = await resolveCoverUrl(repos, name);
    coverUrlCache.set(key, url);
  }
  if (!url) return res.status(404).end();

  res.setHeader('Cache-Control', 'public, max-age=1209600'); // 14 dias
  try {
    const img = await fetch(url);
    if (!img.ok || !img.body) return res.status(502).end();
    res.setHeader('Content-Type', img.headers.get('content-type') || 'image/png');
    const len = img.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    Readable.fromWeb(img.body).pipe(res);
  } catch (error) {
    console.error('[COVER] Erro ao buscar capa:', error.message);
    if (!res.headersSent) res.status(502).end();
  }
});

// ==================== PROXY DE ROM (jogar por link) ====================
// Baixa um arquivo remoto e entrega à página, contornando bloqueios de CORS.
// Suporta Range (retomada/seek). Bloqueia loopback/link-local (SSRF).
function isBlockedProxyHost(host) {
  if (!host) return true;
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^127\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // inclui 169.254.169.254 (metadata)
  if (/^::ffff:127\./.test(h)) return true;
  return false;
}

app.get('/api/rom', async (req, res) => {
  const target = String(req.query.url || '').trim();
  if (!target) return res.status(400).json({ error: 'Parâmetro url ausente' });

  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).json({ error: 'URL inválida' }); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Somente http(s)' });
  }
  if (isBlockedProxyHost(parsed.hostname)) {
    return res.status(403).json({ error: 'Host não permitido pelo proxy' });
  }

  const headers = { 'User-Agent': 'ps1emu/1.0' };
  if (req.headers.range) headers.Range = req.headers.range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(parsed.href, { headers, redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Origem respondeu HTTP ' + upstream.status });
    }
    res.status(upstream.status === 206 ? 206 : 200);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    // Necessário quando a página roda em outra origem (site no Vercel + backend
    // local) e para o EmulatorJS conseguir embutir/ler sob COEP require-corp.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
    else res.end();
  } catch (error) {
    clearTimeout(timer);
    console.error('[ROM] Proxy falhou:', error.message);
    if (!res.headersSent) res.status(502).json({ error: 'Falha ao baixar: ' + error.message });
    else res.end();
  }
});

// ==================== ROMS (arquivos estáticos para o EmulatorJS) ====================
// Servir a pasta de jogos preservando nomes permite ao core resolver
// referências internas de .cue/.m3u (ex.: "jogo.bin") corretamente.
//
// Handler dinâmico: sempre lê a pasta atual (…getGamesDir()), que pode ser
// trocada em runtime via POST /api/config. Serve PS1 (/roms) e PS2 (/ps2roms).
function makeRomHandler(storage) {
  return (req, res) => {
    const base = storage.getGamesDir();
    const rel = decodeURIComponent(req.params[0] || '');
    const fullPath = resolve(base, rel);

    // Proteção contra path traversal (…/../../windows)
    if (fullPath !== base && !fullPath.startsWith(base + sep)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // ?download=1 → força o download do arquivo (para abrir em um emulador
    // nativo no próprio aparelho, ex.: celular com AetherSX2/RetroArch).
    const opts = {};
    if (req.query && req.query.download) {
      opts.headers = {
        'Content-Disposition': `attachment; filename="${basename(fullPath)}"`
      };
    }

    res.sendFile(fullPath, opts, (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode || 404).end();
      }
    });
  };
}

// Central de emulação: /roms/<systemId>/<caminho> (PS1, SNES, NES, ...)
app.get('/roms/:systemId/*', (req, res) => {
  const system = getSystem(req.params.systemId);
  const storage = system && storageFor(system.id);
  if (!storage) return res.status(404).json({ error: 'Console não encontrado' });
  return makeRomHandler(storage)(req, res);
});

// Rotas herdadas (compatibilidade): PS1 em /roms/*, PS2 em /ps2roms/*
app.get('/roms/*', makeRomHandler(gameStorage));
app.get('/ps2roms/*', makeRomHandler(ps2Storage));

// ==================== ARQUIVOS ESTÁTICOS (FRONTEND) ====================

// Em produção, serve build do Vite (frontend/dist ou dist na raiz)
const frontendDist = resolve(__dirname, '../../frontend/dist');
const rootDist = resolve(__dirname, '../../dist');
const staticDir = existsSync(rootDist) ? rootDist : frontendDist;

// Página de jogo (EmulatorJS). Fonte em frontend/public/play.html; servida
// explicitamente para funcionar mesmo sem build do Vite.
//
// Cross-origin isolation (COOP/COEP): habilita SharedArrayBuffer e, com ele, o
// modo *threads* do EmulatorJS — que o núcleo de PSP (PPSSPP) EXIGE (sem isso
// o PSP nem inicia: "This core requires threads"). O CDN do EmulatorJS envia
// `Cross-Origin-Resource-Policy: cross-origin`, então é compatível com
// COEP `require-corp`; as demais coisas da página são same-origin (capas via
// proxy, ROMs, BIOS), que ficam liberadas por padrão.
const playFilePath = resolve(__dirname, '../../frontend/public/play.html');
app.get(['/', '/play', '/play.html'], (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (existsSync(playFilePath)) {
    return res.sendFile(playFilePath);
  }
  res.status(404).send('play.html não encontrado em frontend/public/');
});

// Emulador de PS2 (Play! .js, experimental). Servido de frontend/public/ps2.
//
// IMPORTANTE: o build do Play! usa threads + SharedArrayBuffer, o que exige
// que a página seja "cross-origin isolated". Por isso enviamos COOP/COEP (e
// CORP) aqui — e por isso /ps2 deve ser aberta como página própria (top-level),
// não dentro de um iframe.
const ps2Dir = resolve(__dirname, '../../frontend/public/ps2');
app.use('/ps2', (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}, express.static(ps2Dir, { index: 'index.html', etag: true }));
app.get(['/ps2', '/ps2/'], (req, res) => {
  res.sendFile(join(ps2Dir, 'index.html'));
});

// ==================== BUILDS RECOMPILADOS (PS2/PSP → WebAssembly) ====================
// Os projetos snuri00/ps2-web-recomp e snuri00/psp-web-recomp geram, POR JOGO,
// um site estático em WebAssembly (não é um emulador genérico). Coloque o
// resultado em:
//   recomp/ps2/<jogo>/   → ps2web.html + ps2web.js/.wasm/.data (+ disc.iso)
//   recomp/psp/<jogo>/   -> index.html + index.js/.wasm/.data
//   recomp/psp/disc/     → disco extraído do jogo PSP (servido em /disc)
//
// Essas páginas usam threads + SharedArrayBuffer, então exigem cross-origin
// isolation (COOP/COEP) e Range requests — igual ao /ps2. Por isso abrem como
// página própria (top-level), não dentro de iframe.

function recompBuildDir(kind, game) {
  if (!/^[a-zA-Z0-9._-]+$/.test(String(game || ''))) return null;
  return resolve(config.recompDir, kind, game);
}

/** Página de entrada do build (PS2 usa ps2web.html; PSP usa index.html). */
function recompEntry(dir) {
  return ['ps2web.html', 'pspweb.html', 'index.html']
    .find((f) => existsSync(join(dir, f))) || null;
}

/** Um build de verdade tem, no mínimo, um arquivo .wasm na raiz. */
function hasWasmBuild(dir) {
  try {
    return readdirSync(dir).some((f) => f.toLowerCase().endsWith('.wasm'));
  } catch {
    return false;
  }
}

/** Lista os builds recompilados disponíveis (recomp/<kind>/<jogo>/). */
function listRecomps(kind) {
  const root = resolve(config.recompDir, kind);
  if (!existsSync(root)) return [];
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const page = recompEntry(dir);
    if (!page || !hasWasmBuild(dir)) continue; // ignora pastas sem build real
    out.push({
      kind,
      id: entry.name,
      title: entry.name.replace(/[-_]+/g, ' '),
      entry: page,
      hasDisc: existsSync(join(dir, 'disc.iso')) || existsSync(join(dir, 'disc')),
      url: `/recomp/${kind}/${entry.name}/${page}`
    });
  }
  return out;
}

app.get('/api/recomp', (req, res) => {
  const kind = req.query.kind;
  const list = [];
  if (!kind || kind === 'ps2') list.push(...listRecomps('ps2'));
  if (!kind || kind === 'psp') list.push(...listRecomps('psp'));
  res.json({ builds: list, count: list.length, dir: config.recompDir });
});

// Cabeçalhos de cross-origin isolation (obrigatórios p/ SharedArrayBuffer).
function recompHeaders(req, res, next) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

// Serve os arquivos de um build: /recomp/<ps2|psp>/<jogo>/<arquivo...>
// A raiz abre a página de entrada. Tudo com COOP/COEP e suporte a Range
// (necessário para o streaming do disco e dos .wasm/.data grandes).
app.use('/recomp', recompHeaders, (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const parts = req.path.replace(/^\/+/, '').split('/').map(decodeURIComponent);
  const kind = parts[0];
  const game = parts[1];
  if (kind !== 'ps2' && kind !== 'psp') return res.status(404).end();
  const dir = recompBuildDir(kind, game);
  if (!dir || !existsSync(dir)) return res.status(404).end();

  let rest = parts.slice(2).join('/');
  if (!rest) rest = recompEntry(dir); // a raiz abre a página de entrada
  if (!rest) return res.status(404).end();

  const filePath = resolve(dir, rest);
  // Segurança: nunca sair da pasta do build.
  if (filePath !== dir && !filePath.startsWith(dir + sep)) return res.status(404).end();
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return res.status(404).end();

  res.sendFile(filePath, { acceptRanges: true, cacheControl: false });
});

// Disco extraído do PSP (o build do PSP lê os dados em /disc/...).
app.use('/disc', recompHeaders, express.static(config.pspDiscDir, {
  etag: true,
  index: false,
  setHeaders: (r) => r.setHeader('Accept-Ranges', 'bytes')
}));

app.use(express.static(staticDir, {
  maxAge: '1h',
  etag: true
}));

// SPA fallback - serve index.html para rotas não-API
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/signaling') ||
    req.path.startsWith('/bios/') ||
    req.path.startsWith('/roms/') ||
    req.path.startsWith('/ps2roms/') ||
    req.path.startsWith('/recomp/') ||
    req.path === '/recomp' ||
    req.path.startsWith('/disc/') ||
    req.path === '/disc' ||
    req.path === '/ps2' ||
    req.path.startsWith('/ps2/')
  ) {
    return next();
  }
  res.sendFile(join(staticDir, 'index.html'), (err) => {
    if (err) {
      // Em desenvolvimento, o frontend é servido pelo Vite dev server
      if (process.env.NODE_ENV !== 'production') {
        res.status(404).send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h1>PS1 Emulator - Backend Running</h1>
            <p>Frontend deve ser acessado via <code>npm run dev:frontend</code> (porta 5173)</p>
            <h2>API Endpoints:</h2>
            <ul>
              <li><a href="/api/health">GET /api/health</a></li>
              <li><a href="/api/games">GET /api/games</a></li>
            </ul>
            <h2>WebSocket Signaling:</h2>
            <p>ws://localhost:${config.httpPort}/signaling</p>
          </body></html>
        `);
      } else {
        next(err);
      }
    }
  });
});

// ==================== WEBSOCKET SIGNALING ====================
// WebSocket não existe em funções serverless (Vercel), então só monta o
// signaling quando rodando como servidor de verdade.
if (!process.env.VERCEL) setupSignalingServer(httpServer);

// ==================== HTTPS (opcional, p/ PSP e DOS) ====================
// PSP (PPSSPP) e DOS (DOSBox Pure) só têm build *threaded* no EmulatorJS e,
// portanto, exigem SharedArrayBuffer — que o navegador libera apenas em
// contexto SEGURO (HTTPS ou localhost) + cross-origin isolation.
// Se existir um certificado em certs/ (veja `npm run cert`), subimos também um
// servidor HTTPS. Sem certificado, continua só HTTP (todos os outros consoles
// funcionam normalmente; PSP/DOS só rodariam em localhost).
function loadTlsOptions() {
  const keyPath = resolve(projectRoot, process.env.HTTPS_KEY || 'certs/key.pem');
  const certPath = resolve(projectRoot, process.env.HTTPS_CERT || 'certs/cert.pem');
  const pfxPath = resolve(projectRoot, process.env.HTTPS_PFX || 'certs/ps1emu.pfx');
  try {
    if (existsSync(keyPath) && existsSync(certPath)) {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    }
    if (existsSync(pfxPath)) {
      return { pfx: readFileSync(pfxPath), passphrase: process.env.HTTPS_PFX_PASSPHRASE || 'ps1emu' };
    }
  } catch (e) {
    console.warn('[HTTPS] Falha ao ler o certificado:', e.message);
  }
  return null;
}

let httpsServer = null;
const tlsOptions = loadTlsOptions();
if (tlsOptions) {
  httpsServer = createHttpsServer(tlsOptions, app);
  setupSignalingServer(httpsServer);
}

// ==================== INICIALIZAÇÃO ====================

async function start() {
  // Garante a pasta de BIOS
  await biosStorage.ensureDir();

  // Aplica as pastas salvas anteriormente (compatível com o formato antigo)
  const saved = loadSettings();
  const savedDirs = { ...(saved.dirs || {}) };
  if (typeof saved.gamesDir === 'string') savedDirs.ps1 = saved.gamesDir;
  if (typeof saved.ps2Dir === 'string') savedDirs.ps2 = saved.ps2Dir;

  for (const [id, dir] of Object.entries(savedDirs)) {
    const storage = storageFor(id);
    if (!storage || typeof dir !== 'string') continue;
    try {
      storage.setGamesDir(dir);
      console.log(`[SETTINGS] Pasta de ${id}:`, storage.getGamesDir());
    } catch (e) {
      console.warn(`[SETTINGS] Pasta de ${id} inválida:`, e.message);
    }
  }

  // Detecta o RetroArch nativo (modo "rodar no PC servidor")
  retroarchExe = detectRetroArch();
  if (retroarchExe) {
    console.log('[NATIVE] RetroArch detectado:', retroarchExe);
  } else {
    console.log('[NATIVE] RetroArch não encontrado (modo nativo indisponível).');
  }

  // Escaneia jogos de todos os consoles e liga o auto-scan
  for (const [id, storage] of storages) {
    const games = await storage.scanGames();
    console.log(`[STORAGE] ${id}: ${games.length} jogo(s)`);
    storage.startAutoScan(120000);
  }

  // Inicia servidor HTTP
  httpServer.listen(config.httpPort, '0.0.0.0', () => {
    const host = getLocalIP();
    const activeSystems = [...storages.values()].filter(s => s.cache.size > 0).length;
    console.log(`
╔══════════════════════════════════════════════════════════╗
║      CENTRAL DE EMULAÇÃO - BACKEND RUNNING               ║
╠══════════════════════════════════════════════════════════╣
║  Local:     http://localhost:${config.httpPort}                     ║
║  Rede LAN:  http://${host}:${config.httpPort}                ║
║  Signaling: ws://${host}:${config.httpPort}/signaling         ║
║  Consoles:  ${String(SYSTEMS.length)} indexados (${storages.size} pastas)          ║
║                                                           ║
║  Jogar:     http://${host}:${config.httpPort}/play.html
║                                                           ║
║  Endpoints:                                               ║
║    GET  /api/systems          - Lista consoles + jogos    ║
║    GET  /api/systems/:id/games- Jogos de um console       ║
║    POST /api/systems/:id/launch- Abre no RetroArch (PC)   ║
║    POST /api/config           - Troca pasta de jogos      ║
║    GET  /roms/<id>/...        - Arquivos de ROM (Range)   ║
║    GET  /api/bios             - Lista BIOS                ║
║    WS   /signaling            - Sinalização WebRTC        ║
╚══════════════════════════════════════════════════════════╝
    `);

    if (httpsServer) {
      console.log(`[HTTPS] Seguro: https://localhost:${config.httpsPort}  |  https://${host}:${config.httpsPort}   (necessário p/ PSP/DOS no celular)\n`);
    } else {
      console.log('[HTTPS] Sem certificado em certs/. Rode `npm run cert` para habilitar HTTPS (PSP e DOS exigem contexto seguro).\n');
    }
  });

  // Inicia servidor HTTPS (se houver certificado em certs/)
  if (httpsServer) {
    httpsServer.listen(config.httpsPort, '0.0.0.0', () => {
      console.log(`[HTTPS] Servidor seguro ouvindo em 0.0.0.0:${config.httpsPort}`);
    });
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Encerrando...');
  for (const storage of storages.values()) storage.stopAutoScan();
  if (httpsServer) {
    try { httpsServer.close(); } catch { /* ignore */ }
  }
  httpServer.close(() => {
    console.log('[SERVER] Encerrado com sucesso');
    process.exit(0);
  });
});

// Na Vercel a função é importada (não executamos listen/HTTPS).
if (!process.env.VERCEL) {
  start().catch(console.error);
}

export default app;