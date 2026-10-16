/**
 * Catálogo de consoles/sistemas da Central de Emulação.
 *
 * Cada sistema descreve:
 *   id            identificador curto (também usado na URL: /roms/<id>/...)
 *   name/short    nome de exibição
 *   icon/color    aparência no seletor de console
 *   category      agrupamento no seletor (Nintendo, Sega, Sony, ...)
 *   defaultDir    pasta padrão das ROMs (relativa à raiz do projeto)
 *   extensions    extensões aceitas na indexação
 *   cores[]       núcleos do EmulatorJS aceitos (id = valor de EJS_core)
 *   kind          'emulatorjs' (padrão) ou 'external' (página dedicada, ex.: PS2)
 *   page          URL da página dedicada (apenas kind === 'external')
 *   web           rótulos do cartão da página dedicada: { title, hint, button }
 *   alternatives  outras formas de rodar o MESMO console (ex.: PPSSPP Web dentro
 *                 do PSP): [{ id, name, page, hint? }]. São sempre enviadas —
 *                 a página alvo existe nos dois modos de servir o site: no PC
 *                 (rota /ppsspp do Express) e no site publicado (o build sobe no
 *                 deploy por scripts/vercel-build.mjs).
 *   retroCore     nome do core do RetroArch (.dll) para rodar nativo no PC
 *   needsBios     aviso de que uma BIOS pode ser necessária
 *
 * O EmulatorJS aceita tanto o id do sistema (ex.: 'snes') quanto o id de um
 * core específico (ex.: 'bsnes') em EJS_core — ver
 * https://emulatorjs.org/docs4devs/cores
 */

import { existsSync, statSync } from 'fs';
import { dirname, resolve, join } from 'path';
import config from './config.js';

/** @typedef {{ id: string, label: string, note?: string }} Core */

export const SYSTEMS = [
  // ---------------------------------------------------------------- Sony
  {
    id: 'ps1',
    name: 'PlayStation 1',
    short: 'PS1',
    icon: '🎮',
    color: '#3b82f6',
    category: 'Sony',
    defaultDir: 'games',
    extensions: ['.bin', '.iso', '.cue', '.img', '.mdf', '.pbp', '.chd', '.toc', '.cbn', '.m3u', '.ccd', '.z', '.znx'],
    cores: [
      { id: 'psx', label: 'PCSX-ReARMed', note: 'Recomendado. Leve e rápido; BIOS opcional.' },
      { id: 'mednafen_psx_hw', label: 'Beetle PSX (HW)', note: 'Mais preciso (3D/2D difíceis). Exige BIOS e é mais pesado.' }
    ],
    needsBios: true,
    retroCore: 'pcsx_rearmed_libretro.dll'
  },
  {
    id: 'ps2',
    name: 'PlayStation 2',
    short: 'PS2',
    icon: '🕹️',
    color: '#6366f1',
    category: 'Sony',
    defaultDir: 'ps2games',
    extensions: ['.iso', '.chd', '.cso', '.isz', '.bin', '.elf', '.img', '.mds'],
    kind: 'external',
    page: '/ps2/',
    web: {
      title: 'Emulador de PS2 (Play! .js)',
      hint: 'No navegador, o PS2 usa o <strong>Play! .js</strong> (experimental) em uma página própria. Lá você também pode escolher um ISO do seu aparelho.',
      button: '▶ Abrir o emulador de PS2'
    },
    note: 'No navegador usa o Play! .js (experimental e pesado). Rode no PC servidor com o PCSX2 para ir rápido.',
    cores: [],
    retroCore: 'pcsx2_libretro.dll'
  },
  {
    id: 'psp',
    name: 'PlayStation Portable',
    short: 'PSP',
    icon: '🎮',
    color: '#0ea5e9',
    category: 'Sony',
    defaultDir: 'roms/psp',
    extensions: ['.iso', '.cso', '.pbp', '.elf'],
    cores: [{ id: 'psp', label: 'PPSSPP', note: 'Precisa de firmware/arquivos auxiliares para alguns jogos.' }],
    retroCore: 'ppsspp_libretro.dll',
    // Alternativas: o PPSSPP Web aparece como linha "PPSSPP Web (WASM)" dentro da
    // visão do PSP. É página própria (top-level), então o ISO é escolhido dentro
    // do PPSSPP — não a partir da biblioteca. A linha é sempre listada: a página
    // /ppsspp/ existe nos dois modos (Express local e o build que sobe no deploy).
    alternatives: [
      {
        id: 'ppsspp-web',
        name: 'PPSSPP Web (WASM)',
        page: '/ppsspp/',
        hint: 'Outro emulador de PSP em WebAssembly. Abre em página própria: o ISO é escolhido dentro dele. Sem netplay.'
      }
    ]
  },

  // ------------------------------------------------------------ Nintendo
  {
    id: 'snes',
    name: 'Super Nintendo',
    short: 'SNES',
    icon: '🎮',
    color: '#8b5cf6',
    category: 'Nintendo',
    defaultDir: 'roms/snes',
    extensions: ['.sfc', '.smc', '.fig', '.swc', '.bs', '.st', '.zip', '.7z'],
    cores: [
      { id: 'snes', label: 'Snes9x', note: 'Padrão. Rápido e compatível.' }
    ],
    retroCore: 'snes9x_libretro.dll'
  },
  {
    id: 'nes',
    name: 'NES / Famicom',
    short: 'NES',
    icon: '👾',
    color: '#ef4444',
    category: 'Nintendo',
    defaultDir: 'roms/nes',
    extensions: ['.nes', '.fds', '.unf', '.unif', '.zip', '.7z'],
    cores: [
      { id: 'nes', label: 'FCEUmm', note: 'Padrão.' },
      { id: 'nestopia', label: 'Nestopia', note: 'Alternativa com boa precisão.' }
    ],
    retroCore: 'fceumm_libretro.dll'
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    short: 'N64',
    icon: '🎮',
    color: '#22c55e',
    category: 'Nintendo',
    defaultDir: 'roms/n64',
    extensions: ['.z64', '.n64', '.v64', '.zip'],
    cores: [
      { id: 'n64', label: 'Mupen64Plus-Next', note: 'Padrão.' },
      { id: 'parallel_n64', label: 'ParaLLEl N64', note: 'Pode ser mais rápido em alguns PCs.' }
    ],
    retroCore: 'mupen64plus_next_libretro.dll'
  },
  {
    id: 'gb',
    name: 'Game Boy / Color',
    short: 'GB',
    icon: '🟩',
    color: '#84cc16',
    category: 'Nintendo',
    defaultDir: 'roms/gb',
    extensions: ['.gb', '.gbc', '.dmg', '.zip'],
    cores: [{ id: 'gb', label: 'Gambatte', note: 'Game Boy e Game Boy Color.' }],
    retroCore: 'gambatte_libretro.dll'
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    short: 'GBA',
    icon: '🟪',
    color: '#a855f7',
    category: 'Nintendo',
    defaultDir: 'roms/gba',
    extensions: ['.gba', '.agb', '.zip'],
    cores: [{ id: 'gba', label: 'mGBA', note: 'Padrão.' }],
    retroCore: 'mgba_libretro.dll'
  },
  {
    id: 'nds',
    name: 'Nintendo DS',
    short: 'NDS',
    icon: '🎛️',
    color: '#f43f5e',
    category: 'Nintendo',
    defaultDir: 'roms/nds',
    extensions: ['.nds', '.zip'],
    cores: [
      { id: 'nds', label: 'melonDS', note: 'Padrão.' },
      { id: 'desmume2015', label: 'DeSmuME 2015', note: 'Alternativa.' }
    ],
    retroCore: 'melonds_libretro.dll'
  },
  {
    id: 'vb',
    name: 'Virtual Boy',
    short: 'VB',
    icon: '🟥',
    color: '#dc2626',
    category: 'Nintendo',
    defaultDir: 'roms/vb',
    extensions: ['.vb', '.vboy', '.zip'],
    cores: [{ id: 'vb', label: 'Beetle VB' }],
    retroCore: 'mednafen_vb_libretro.dll'
  },

  // ---------------------------------------------------------------- Sega
  {
    id: 'segaMD',
    name: 'Mega Drive / Genesis',
    short: 'GEN',
    icon: '🎮',
    color: '#2563eb',
    category: 'Sega',
    defaultDir: 'roms/megadrive',
    extensions: ['.md', '.gen', '.smd', '.bin', '.zip'],
    cores: [
      { id: 'segaMD', label: 'Genesis Plus GX', note: 'Padrão.' },
      { id: 'picodrive', label: 'PicoDrive', note: 'Alternativa (também roda 32X).' }
    ],
    retroCore: 'genesis_plus_gx_libretro.dll'
  },
  {
    id: 'segaMS',
    name: 'Master System',
    short: 'SMS',
    icon: '🎮',
    color: '#1d4ed8',
    category: 'Sega',
    defaultDir: 'roms/mastersystem',
    extensions: ['.sms', '.zip'],
    cores: [{ id: 'segaMS', label: 'Genesis Plus GX' }],
    retroCore: 'genesis_plus_gx_libretro.dll'
  },
  {
    id: 'segaGG',
    name: 'Game Gear',
    short: 'GG',
    icon: '🎮',
    color: '#1e40af',
    category: 'Sega',
    defaultDir: 'roms/gamegear',
    extensions: ['.gg', '.zip'],
    cores: [{ id: 'segaGG', label: 'Genesis Plus GX' }],
    retroCore: 'genesis_plus_gx_libretro.dll'
  },
  {
    id: 'segaCD',
    name: 'Sega CD',
    short: 'CD',
    icon: '💿',
    color: '#1e3a8a',
    category: 'Sega',
    defaultDir: 'roms/segacd',
    extensions: ['.cue', '.bin', '.chd', '.iso', '.m3u'],
    cores: [{ id: 'segaCD', label: 'Genesis Plus GX' }],
    retroCore: 'genesis_plus_gx_libretro.dll'
  },
  {
    id: 'sega32x',
    name: 'Sega 32X',
    short: '32X',
    icon: '💿',
    color: '#312e81',
    category: 'Sega',
    defaultDir: 'roms/32x',
    extensions: ['.32x', '.bin'],
    cores: [{ id: 'sega32x', label: 'PicoDrive' }],
    retroCore: 'picodrive_libretro.dll'
  },
  {
    id: 'segaSaturn',
    name: 'Sega Saturn',
    short: 'SAT',
    icon: '💿',
    color: '#4338ca',
    category: 'Sega',
    defaultDir: 'roms/saturn',
    extensions: ['.cue', '.bin', '.chd', '.iso', '.m3u'],
    cores: [{ id: 'segaSaturn', label: 'Yabause', note: 'Compatibilidade limitada; exige BIOS.' }],
    needsBios: true,
    retroCore: 'yabause_libretro.dll'
  },

  // --------------------------------------------------------------- Atari
  {
    id: 'atari2600',
    name: 'Atari 2600',
    short: '2600',
    icon: '🕹️',
    color: '#f59e0b',
    category: 'Atari',
    defaultDir: 'roms/atari2600',
    extensions: ['.a26', '.bin', '.zip'],
    cores: [{ id: 'atari2600', label: 'Stella 2014' }],
    retroCore: 'stella2014_libretro.dll'
  },
  {
    id: 'atari7800',
    name: 'Atari 7800',
    short: '7800',
    icon: '🕹️',
    color: '#d97706',
    category: 'Atari',
    defaultDir: 'roms/atari7800',
    extensions: ['.a78', '.bin', '.zip'],
    cores: [{ id: 'atari7800', label: 'ProSystem' }],
    retroCore: 'prosystem_libretro.dll'
  },
  {
    id: 'lynx',
    name: 'Atari Lynx',
    short: 'LYNX',
    icon: '🕹️',
    color: '#b45309',
    category: 'Atari',
    defaultDir: 'roms/lynx',
    extensions: ['.lnx', '.zip'],
    cores: [{ id: 'lynx', label: 'Handy' }],
    retroCore: 'handy_libretro.dll'
  },
  {
    id: 'jaguar',
    name: 'Atari Jaguar',
    short: 'JAG',
    icon: '🐆',
    color: '#78350f',
    category: 'Atari',
    defaultDir: 'roms/jaguar',
    extensions: ['.j64', '.jag', '.rom', '.zip'],
    cores: [{ id: 'jaguar', label: 'Virtual Jaguar', note: 'Exige BIOS do Jaguar.' }],
    needsBios: true,
    retroCore: 'virtualjaguar_libretro.dll'
  },

  // --------------------------------------------------------------- Outros
  {
    id: 'arcade',
    name: 'Arcade',
    short: 'ARC',
    icon: '👾',
    color: '#e11d48',
    category: 'Outros',
    defaultDir: 'roms/arcade',
    extensions: ['.zip', '.7z'],
    cores: [
      { id: 'arcade', label: 'FBNeo', note: 'Padrão para arcade.' },
      { id: 'mame2003_plus', label: 'MAME 2003 Plus', note: 'Base MAME.' }
    ],
    retroCore: 'fbneo_libretro.dll'
  },
  {
    id: 'pce',
    name: 'PC Engine / TG-16',
    short: 'PCE',
    icon: '🎮',
    color: '#ea580c',
    category: 'Outros',
    defaultDir: 'roms/pce',
    extensions: ['.pce', '.sgx', '.cue', '.bin', '.chd', '.zip'],
    cores: [{ id: 'pce', label: 'Beetle PCE' }],
    retroCore: 'mednafen_pce_libretro.dll'
  },
  {
    id: 'ngp',
    name: 'Neo Geo Pocket',
    short: 'NGP',
    icon: '🎮',
    color: '#16a34a',
    category: 'Outros',
    defaultDir: 'roms/ngp',
    extensions: ['.ngp', '.ngc', '.zip'],
    cores: [{ id: 'ngp', label: 'Beetle NeoPop' }],
    retroCore: 'mednafen_ngp_libretro.dll'
  },
  {
    id: 'ws',
    name: 'WonderSwan',
    short: 'WS',
    icon: '🎮',
    color: '#65a30d',
    category: 'Outros',
    defaultDir: 'roms/wonderswan',
    extensions: ['.ws', '.wsc', '.zip'],
    cores: [{ id: 'ws', label: 'Beetle WonderSwan' }],
    retroCore: 'mednafen_wswan_libretro.dll'
  },
  {
    id: '3do',
    name: '3DO',
    short: '3DO',
    icon: '💿',
    color: '#7c3aed',
    category: 'Outros',
    defaultDir: 'roms/3do',
    extensions: ['.iso', '.cue', '.chd', '.bin'],
    cores: [{ id: '3do', label: 'Opera', note: 'Exige BIOS do 3DO.' }],
    needsBios: true,
    retroCore: 'opera_libretro.dll'
  },
  {
    id: 'pcfx',
    name: 'PC-FX',
    short: 'PCFX',
    icon: '💿',
    color: '#7c3aed',
    category: 'Outros',
    defaultDir: 'roms/pcfx',
    extensions: ['.cue', '.bin', '.chd', '.iso', '.m3u'],
    cores: [{ id: 'pcfx', label: 'Beetle PC-FX', note: 'Exige BIOS.' }],
    needsBios: true,
    retroCore: 'mednafen_pcfx_libretro.dll'
  },
  {
    id: 'c64',
    name: 'Commodore 64',
    short: 'C64',
    icon: '⌨️',
    color: '#0891b2',
    category: 'Outros',
    defaultDir: 'roms/c64',
    extensions: ['.d64', '.t64', '.prg', '.crt', '.tap', '.zip'],
    cores: [{ id: 'c64', label: 'VICE x64' }],
    retroCore: 'vice_x64_libretro.dll'
  },
  {
    id: 'dos',
    name: 'DOS',
    short: 'DOS',
    icon: '💾',
    color: '#475569',
    category: 'Outros',
    defaultDir: 'roms/dos',
    extensions: ['.zip', '.7z', '.dosz'],
    cores: [{ id: 'dos', label: 'DOSBox Pure' }],
    retroCore: 'dosbox_pure_libretro.dll'
  },
  {
    id: 'amiga',
    name: 'Amiga',
    short: 'AMG',
    icon: '🖥️',
    color: '#7c3aed',
    category: 'Outros',
    defaultDir: 'roms/amiga',
    extensions: ['.adf', '.adz', '.dms', '.ipf', '.hdf', '.zip'],
    cores: [{ id: 'amiga', label: 'PUAE', note: 'Exige kickstart ROM.' }],
    needsBios: true,
    retroCore: 'puae_libretro.dll'
  }
];

/**
 * Capas dos jogos: repositórios do projeto libretro-thumbnails (GitHub).
 * Cada sistema aponta para um ou mais repositórios onde procurar a capa,
 * seguindo a mesma convenção de nomes das ROMs (No-Intro/Redump).
 *   https://raw.githubusercontent.com/libretro-thumbnails/<repo>/master/<pasta>/<nome>.png
 * A pasta é tentada em ordem: Named_Boxarts → Named_Snaps → Named_Titles.
 */
export const BOXART = {
  ps1: ['Sony_-_PlayStation'],
  ps2: ['Sony_-_PlayStation_2'],
  psp: ['Sony_-_PlayStation_Portable'],
  snes: ['Nintendo_-_Super_Nintendo_Entertainment_System'],
  nes: ['Nintendo_-_Nintendo_Entertainment_System'],
  n64: ['Nintendo_-_Nintendo_64'],
  gb: ['Nintendo_-_Game_Boy_Color', 'Nintendo_-_Game_Boy'],
  gba: ['Nintendo_-_Game_Boy_Advance'],
  nds: ['Nintendo_-_Nintendo_DS'],
  vb: ['Nintendo_-_Virtual_Boy'],
  segaMD: ['Sega_-_Mega_Drive_-_Genesis'],
  segaMS: ['Sega_-_Master_System_-_Mark_III'],
  segaGG: ['Sega_-_Game_Gear'],
  segaCD: ['Sega_-_Mega-CD_-_Sega_CD'],
  sega32x: ['Sega_-_32X'],
  segaSaturn: ['Sega_-_Saturn'],
  atari2600: ['Atari_-_2600'],
  atari7800: ['Atari_-_7800'],
  lynx: ['Atari_-_Lynx'],
  jaguar: ['Atari_-_Jaguar'],
  arcade: ['MAME'],
  pce: ['NEC_-_PC_Engine_-_TurboGrafx_16', 'NEC_-_PC_Engine_CD_-_TurboGrafx-CD'],
  ngp: ['SNK_-_Neo_Geo_Pocket'],
  ws: ['Bandai_-_WonderSwan'],
  '3do': ['The_3DO_Company_-_3DO'],
  pcfx: ['NEC_-_PC-FX'],
  amiga: ['Commodore_-_Amiga']
};

/** Repositórios de capas de um sistema (ou lista vazia) */
export function boxartRepos(systemId) {
  return BOXART[systemId] ? BOXART[systemId].slice() : [];
}

const BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]));

/** Retorna a definição de um sistema (ou null) */
export function getSystem(id) {
  return BY_ID.get(String(id)) || null;
}

/** Lista de sistemas (cópia rasa) */
export function listSystems() {
  return SYSTEMS.slice();
}

/** Pasta padrão (absoluta) de um sistema */
export function defaultDirFor(system) {
  const rel = system.defaultDir || `roms/${system.id}`;
  return resolve(config.projectRoot, rel);
}

/** Extensões aceitas para upload/local de um sistema */
export function extensionsFor(system) {
  return system.extensions.slice();
}

/**
 * Nomes de pasta aceitos por sistema na SEPARAÇÃO AUTOMÁTICA de uma pasta raiz.
 * Ex.: uma pasta `GAMES/` com subpastas `PS1/`, `SNES/`, `Mega Drive/` vira a
 * pasta de cada console. O `id`, o `short` e o `name` do sistema já valem por
 * conta própria; aqui ficam só os apelidos extras (abreviações e nomes comuns).
 * A comparação ignora acentos, maiúsculas e símbolos (ver normalizeFolderName).
 */
const FOLDER_ALIASES = {
  ps1: ['psx', 'playstation', 'playstation1', 'psone'],
  ps2: ['playstation2'],
  psp: ['playstationportable'],
  snes: ['supernintendo', 'superfamicom', 'snes'],
  nes: ['nintendoentertainmentsystem', 'famicom', 'nintendo'],
  n64: ['nintendo64'],
  gb: ['gameboy', 'gameboycolor', 'gameboyclassic', 'gbc'],
  gba: ['gameboyadvance'],
  nds: ['nintendods', 'ds'],
  vb: ['virtualboy'],
  segaMD: ['megadrive', 'genesis', 'segamegadrive', 'segagenesis', 'md'],
  segaMS: ['mastersystem', 'segamastersystem'],
  segaGG: ['gamegear', 'segagamegear'],
  segaCD: ['megacd', 'segacd'],
  sega32x: ['32x'],
  segaSaturn: ['saturn'],
  atari2600: ['2600'],
  atari7800: ['7800'],
  lynx: ['atarilynx'],
  jaguar: ['atarijaguar'],
  arcade: ['mame', 'fbneo', 'fba'],
  pce: ['pcengine', 'turbografx', 'turbografx16', 'tg16'],
  ngp: ['neogeopocket'],
  ws: ['wonderswan', 'wonderswancolor'],
  '3do': ['the3do'],
  pcfx: [],
  c64: ['commodore64'],
  dos: ['dosbox'],
  amiga: ['commodoreamiga']
};

/** Chave normalizada de um nome de pasta (sem acento, minúscula, só [a-z0-9]). */
export function normalizeFolderName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Índice nome-de-pasta → id de sistema (o primeiro cadastro vence, para que um
// apelido genérico nunca sobreponha o id/short exato de outro console).
const FOLDER_INDEX = (() => {
  const index = new Map();
  for (const system of SYSTEMS) {
    const names = [system.id, system.short, system.name, ...(FOLDER_ALIASES[system.id] || [])];
    for (const n of names) {
      const key = normalizeFolderName(n);
      if (key && !index.has(key)) index.set(key, system.id);
    }
  }
  return index;
})();

/**
 * Descobre a qual console pertence o nome de uma pasta (ex.: "PS1" → 'ps1',
 * "Mega Drive" → 'segaMD'). Retorna null se não reconhecer.
 * @param {string} name
 * @returns {string|null}
 */
export function systemForFolderName(name) {
  return FOLDER_INDEX.get(normalizeFolderName(name)) || null;
}

/**
 * Localiza o RetroArch no PC host (para o modo "rodar no PC servidor").
 * Ordem: variável de ambiente RETROARCH_PATH, config, locais comuns.
 * @returns {string|null} caminho absoluto do retroarch.exe
 */
export function detectRetroArch() {
  const candidates = [
    process.env.RETROARCH_PATH,
    config.retroarchPath,
    'D:\\EMUVR\\RetroArch\\retroarch.exe',
    'C:\\RetroArch-Win64\\retroarch.exe',
    'C:\\RetroArch\\retroarch.exe',
    process.env.APPDATA ? join(process.env.APPDATA, 'RetroArch', 'retroarch.exe') : null,
    process.env.HOME ? join(process.env.HOME, 'RetroArch', 'retroarch.exe') : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const p = resolve(candidate);
      if (existsSync(p)) {
        if (statSync(p).isDirectory()) {
          const exe = join(p, 'retroarch.exe');
          if (existsSync(exe)) return exe;
        } else {
          return p;
        }
      }
    } catch {
      // ignora candidatos inválidos
    }
  }
  return null;
}

/** Pasta de cores do RetroArch (ao lado do executável) */
export function retroCoresDir(retroarchExe) {
  if (!retroarchExe) return null;
  const dir = join(dirname(retroarchExe), 'cores');
  return existsSync(dir) ? dir : null;
}

/**
 * Verifica se há um core nativo instalado para o sistema.
 * @returns {string|null} caminho absoluto do .dll, ou null
 */
export function findRetroCore(system, retroarchExe = detectRetroArch()) {
  if (!system || !system.retroCore || !retroarchExe) return null;
  const coresDir = retroCoresDir(retroarchExe);
  if (!coresDir) return null;
  const full = join(coresDir, system.retroCore);
  return existsSync(full) ? full : null;
}

export default { SYSTEMS, getSystem, listSystems, detectRetroArch, findRetroCore, boxartRepos };
