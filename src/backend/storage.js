/**
 * Módulo de Armazenamento e Indexação de Jogos
 * Escaneia recursivamente o diretório de jogos e mantém cache de metadados
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, resolve, extname, basename, relative } from 'path';
import config from './config.js';

class GameStorage {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dir]        pasta de jogos (padrão: config.gamesDir)
   * @param {string[]} [opts.extensions] extensões aceitas (padrão: config.supportedExtensions)
   */
  constructor(opts = {}) {
    this.cache = new Map();
    this.lastScan = 0;
    this.scanInterval = null;
    // Pasta de jogos (absoluta). Pode ser trocada em runtime via setGamesDir().
    this.gamesDir = opts.dir || config.gamesDir;
    this.extensions = opts.extensions || config.supportedExtensions;
  }

  /** Pasta de jogos atual (absoluta) */
  getGamesDir() {
    return this.gamesDir;
  }

  /**
   * Troca a pasta de jogos em tempo de execução.
   * @param {string} dir - caminho (absoluto ou relativo à raiz do projeto)
   * @returns {string} caminho absoluto aplicado
   */
  setGamesDir(dir) {
    if (!dir || typeof dir !== 'string') throw new Error('Caminho inválido');
    this.gamesDir = resolve(config.projectRoot, dir);
    this.cache.clear();
    this.lastScan = 0;
    return this.gamesDir;
  }

  /**
   * Escaneia o diretório de jogos recursivamente
   * @param {boolean} force - Força reescaneamento ignorando cache
   * @returns {Promise<GameInfo[]>}
   */
  async scanGames(force = false) {
    const now = Date.now();
    // Cache também vale para pastas vazias/inexistentes (evita reler o disco a
    // cada request da central de emulação, que consulta todos os consoles).
    if (!force && this.lastScan && (now - this.lastScan) < 30000) {
      return Array.from(this.cache.values());
    }

    console.log('[STORAGE] Escaneando diretório de jogos:', this.gamesDir);
    this.cache.clear();

    try {
      await this._scanDirectory(this.gamesDir, '');
      this.lastScan = now;
      console.log(`[STORAGE] Encontrados ${this.cache.size} jogos`);
    } catch (error) {
      console.error('[STORAGE] Erro ao escanear:', error.message);
    }

    return Array.from(this.cache.values());
  }

  /**
   * Escaneamento recursivo interno
   */
  async _scanDirectory(dirPath, relativePath) {
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // Diretório não acessível
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relPath = join(relativePath, entry.name);

      if (entry.isDirectory()) {
        await this._scanDirectory(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (this.extensions.includes(ext)) {
          await this._indexGame(fullPath, relPath, entry.name);
        }
      }
    }
  }

  /**
   * Indexa um único arquivo de jogo
   */
  async _indexGame(fullPath, relativePath, fileName) {
    try {
      const stats = await stat(fullPath);
      const id = this._generateId(relativePath);

      const gameInfo = {
        id,
        name: this._extractGameName(fileName, relativePath),
        fileName,
        relativePath,
        fullPath,
        extension: extname(fileName).toLowerCase(),
        size: stats.size,
        sizeFormatted: this._formatBytes(stats.size),
        modified: stats.mtime.toISOString(),
        // Metadados extras (podem ser preenchidos por parsers de CUE, etc.)
        discCount: 1,
        region: 'Unknown',
        serial: 'Unknown'
      };

      this.cache.set(id, gameInfo);
    } catch (error) {
      console.warn(`[STORAGE] Erro ao indexar ${fileName}:`, error.message);
    }
  }

  /**
   * Gera ID único baseado no caminho relativo
   */
  _generateId(relativePath) {
    // Hash simples do caminho para ID estável
    let hash = 0;
    for (let i = 0; i < relativePath.length; i++) {
      hash = ((hash << 5) - hash) + relativePath.charCodeAt(i);
      hash |= 0;
    }
    return `game_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Extrai nome legível do jogo do arquivo/caminho
   */
  _extractGameName(fileName, relativePath) {
    // Remove extensão
    let name = basename(fileName, extname(fileName));
    // Substitui underscores e hífens por espaços
    name = name.replace(/[_-]/g, ' ');
    // Remove códigos de região comuns entre parênteses
    name = name.replace(/\s*\([A-Z]{1,2}\)\s*$/, '');
    // Title case simples
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }

  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Obtém informações de um jogo pelo ID
   */
  async getGame(id) {
    if (this.cache.size === 0) await this.scanGames();
    return this.cache.get(id) || null;
  }

  /**
   * Obtém stream de leitura para o arquivo do jogo (para download/streaming)
   * Suporta Range Requests seguindo a RFC 7233 (bytes=start-end e bytes=-suffix).
   * Importante: NÃO trunca o arquivo — o range pedido é respeitado integralmente,
   * caso contrário ISOs grandes seriam baixados corrompidos/incompletos.
   */
  async getGameStream(id, range) {
    const game = await this.getGame(id);
    if (!game) return null;

    const { createReadStream } = await import('fs');
    const { stat } = await import('fs/promises');

    const stats = await stat(game.fullPath);
    const fileSize = stats.size;

    let start = 0;
    let end = fileSize - 1;
    let isPartial = false;

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      if (match) {
        const [, rawStart, rawEnd] = match;
        if (rawStart === '' && rawEnd !== '') {
          // Range por sufixo: últimos N bytes
          const suffix = parseInt(rawEnd, 10);
          start = Math.max(0, fileSize - suffix);
          end = fileSize - 1;
        } else {
          start = rawStart ? parseInt(rawStart, 10) : 0;
          end = rawEnd ? parseInt(rawEnd, 10) : fileSize - 1;
        }
        isPartial = true;
      }
    }

    // Sanitiza os limites
    start = Math.max(0, Math.min(start, Math.max(0, fileSize - 1)));
    end = Math.max(start, Math.min(end, Math.max(0, fileSize - 1)));

    const stream = createReadStream(game.fullPath, { start, end });

    return {
      stream,
      start,
      end,
      fileSize,
      isPartial,
      contentType: this._getContentType(game.extension),
      contentLength: end - start + 1
    };
  }

  _getContentType(ext) {
    const types = {
      '.bin': 'application/octet-stream',
      '.iso': 'application/octet-stream',
      '.cue': 'text/plain; charset=utf-8',
      '.img': 'application/octet-stream',
      '.mdf': 'application/octet-stream',
      '.pbp': 'application/octet-stream',
      '.chd': 'application/octet-stream',
      '.toc': 'text/plain; charset=utf-8',
      '.ccd': 'application/octet-stream',
      '.cbn': 'application/octet-stream',
      '.m3u': 'text/plain; charset=utf-8',
      '.z': 'application/octet-stream',
      '.znx': 'application/octet-stream'
    };
    return types[ext] || 'application/octet-stream';
  }

  /**
   * Inicia auto-scan periódico
   */
  startAutoScan(intervalMs = 60000) {
    if (this.scanInterval) return;
    this.scanInterval = setInterval(() => this.scanGames(true), intervalMs);
    console.log('[STORAGE] Auto-scan iniciado a cada', intervalMs / 1000, 'segundos');
  }

  stopAutoScan() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }
}

// Instância singleton para os jogos de PS1
export const gameStorage = new GameStorage();
export { GameStorage };
export default gameStorage;