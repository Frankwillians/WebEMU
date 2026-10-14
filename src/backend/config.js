/**
 * Configuração centralizada do Backend
 *
 * Caminhos são resolvidos a partir da RAIZ DO PROJETO (não do diretório de
 * trabalho), então funciona igual rodando `npm start` na raiz ou
 * `node src/backend/server.js` de qualquer lugar.
 *
 * Variáveis de ambiente:
 *   HTTP_PORT   (padrão 3000)
 *   GAMES_DIR   (padrão <raiz>/games)  — pasta com as ROMs/ISOs
 *   BIOS_DIR    (padrão <raiz>/bios)   — pasta com as BIOS
 *   CORS_ORIGIN (padrão *)
 *   LOG_LEVEL   (padrão info)
 */

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Raiz do projeto (…/ps1emu) */
export const projectRoot = resolve(__dirname, '../..');

/** Converte um caminho (relativo à raiz do projeto) em absoluto */
function abs(p) {
  return resolve(projectRoot, p);
}

export const config = {
  /** Raiz do projeto */
  projectRoot,

  // Porta do servidor HTTP (API REST + arquivos estáticos)
  httpPort: parseInt(process.env.HTTP_PORT || '3000', 10),

  // Porta do servidor HTTPS (opcional). Só sobe se existir um certificado em
  // certs/ (veja scripts/make-cert.mjs). É necessário para PSP e DOS, que
  // dependem de SharedArrayBuffer — disponível apenas em contexto seguro
  // (HTTPS ou localhost) + cross-origin isolation.
  httpsPort: parseInt(process.env.HTTPS_PORT || '3443', 10),

  // Diretório das ROMs/ISOs do PS1 (absoluto).
  // Pode ser trocado em tempo de execução pela API (/api/config).
  gamesDir: abs(process.env.GAMES_DIR || 'games'),

  // Diretório das BIOS de PS1 (absoluto)
  biosDir: abs(process.env.BIOS_DIR || 'bios'),

  // Diretório das ROMs/ISOs de PS2 (emulador experimental Play! .js).
  // Separado de gamesDir para não misturar jogos de PS1 e PS2.
  ps2Dir: abs(process.env.PS2_DIR || 'ps2games'),

  // Raiz das pastas dos demais consoles da central (ex.: roms/snes, roms/nes).
  // Cada sistema pode sobrescrever a sua pasta por /api/config.
  systemsRoot: abs(process.env.SYSTEMS_ROOT || 'roms'),

  // Builds recompilados (PS2/PSP) gerados pelos projetos psp/ps2-web-recomp.
  // Estrutura: recomp/<ps2|psp>/<jogo>/  (arquivos estáticos da página)
  //            recomp/psp/disc/            (disco extraído p/ PSP, servido em /disc)
  recompDir: abs(process.env.RECOMP_DIR || 'recomp'),
  pspDiscDir: abs(process.env.PSP_DISC_DIR || 'recomp/psp/disc'),

  // Caminho do RetroArch (emulador nativo) para o modo "rodar no PC servidor".
  // Se vazio, o backend tenta achar automaticamente em locais comuns.
  retroarchPath: process.env.RETROARCH_PATH || '',

  // Extensões de arquivo suportadas (inclui formatos do EmulatorJS/PCSX-ReARMed)
  supportedExtensions: [
    '.bin', '.iso', '.cue', '.img', '.mdf', '.pbp',
    '.chd', '.toc', '.cbn', '.m3u', '.ccd', '.z', '.znx'
  ],

  // Extensões aceitas na pasta de PS2 (Play! .js)
  ps2Extensions: ['.iso', '.chd', '.cso', '.isz', '.bin', '.elf', '.img', '.mds'],

  // Tamanho máximo aceito para upload de BIOS (4 MB é mais que suficiente)
  maxBiosSize: 4 * 1024 * 1024,

  // Configurações de streaming
  streamChunkSize: 64 * 1024,

  // CORS origins permitidos (adicione seu IP local para acesso na rede)
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Log level
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Aviso se a pasta de jogos não existir
if (!existsSync(config.gamesDir)) {
  console.warn(`[CONFIG] Diretório de jogos não encontrado: ${config.gamesDir}`);
  console.warn('[CONFIG] Crie a pasta ou defina GAMES_DIR no .env');
}

export const resolvedBiosDir = config.biosDir;

export default config;
