/**
 * Módulo de BIOS
 *
 * Gerencia as BIOS de PlayStation 1 usadas pelos cores do EmulatorJS
 * (PCSX-ReARMed / Beetle PSX). As BIOS são armazenadas na pasta `bios/`
 * e servidas via HTTP, garantindo que o arquivo chegue ao browser com o
 * nome correto (o core só reconhece nomes como scph5501.bin).
 *
 * Endpoints expostos (registrados em server.js):
 *   GET    /api/bios           -> lista BIOS disponíveis
 *   POST   /api/bios/upload    -> envia uma BIOS (corpo binário bruto)
 *   DELETE /api/bios/:name     -> remove uma BIOS
 *   GET    /bios/<arquivo>     -> serve o arquivo estático
 */

import { readdir, stat, mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import { existsSync, createReadStream } from 'fs';
import config, { resolvedBiosDir } from './config.js';

/**
 * Nomes de BIOS conhecidos e suas regiões.
 * O EmulatorJS/PCSX-ReARMed procura exatamente por estes nomes.
 */
export const KNOWN_BIOS = {
  'scph5500.bin': 'JP',
  'scph5501.bin': 'US',
  'scph5502.bin': 'EU',
  'scph1000.bin': 'JP',
  'scph1001.bin': 'US',
  'scph7000.bin': 'JP',
  'scph7001.bin': 'US',
  'scph7003.bin': 'EU',
  'scph7502.bin': 'EU',
  'ps1_rom.bin': 'Desconhecida'
};

/** Extensões aceitas para BIOS */
const BIOS_EXT = /\.(bin|rom)$/i;

/** Nome de arquivo seguro: apenas letras, números, ponto, hífen e underscore */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

class BiosStorage {
  constructor() {
    this.dir = resolvedBiosDir;
  }

  /** Garante que a pasta de BIOS existe */
  async ensureDir() {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
      console.log('[BIOS] Pasta criada:', this.dir);
    }
  }

  /** Verifica se um nome de arquivo é válido/seguro */
  isValidName(name) {
    return (
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 64 &&
      SAFE_NAME.test(name) &&
      BIOS_EXT.test(name)
    );
  }

  /**
   * Valida o nome, retornando null se inválido.
   * Rejeita separadores de caminho e "..", evitando qualquer escrita fora
   * da pasta de BIOS.
   */
  sanitizeName(name) {
    if (!name) return null;
    const clean = String(name).trim();
    if (clean.includes('/') || clean.includes('\\') || clean.includes('..')) return null;
    return this.isValidName(clean) ? clean : null;
  }

  /** Lista as BIOS armazenadas (com tamanho e md5) */
  async list() {
    await this.ensureDir();
    let entries = [];
    try {
      entries = await readdir(this.dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const result = [];
    for (const entry of entries) {
      if (!entry.isFile() || !BIOS_EXT.test(entry.name)) continue;
      const fullPath = join(this.dir, entry.name);
      try {
        const stats = await stat(fullPath);
        result.push({
          name: entry.name,
          region: KNOWN_BIOS[entry.name.toLowerCase()] || 'Desconhecida',
          size: stats.size,
          sizeFormatted: this._formatBytes(stats.size),
          modified: stats.mtime.toISOString(),
          known: Boolean(KNOWN_BIOS[entry.name.toLowerCase()]),
          url: `/bios/${encodeURIComponent(entry.name)}`
        });
      } catch {
        // ignora arquivos ilegíveis
      }
    }

    // Ordena por nome
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** Salva uma BIOS a partir de um Buffer */
  async save(rawName, buffer) {
    const name = this.sanitizeName(rawName);
    if (!name) {
      throw new Error('Nome de BIOS inválido. Use algo como scph5501.bin');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Arquivo de BIOS vazio');
    }
    if (buffer.length > config.maxBiosSize) {
      throw new Error(`BIOS muito grande (máx ${this._formatBytes(config.maxBiosSize)})`);
    }

    await this.ensureDir();
    const fullPath = join(this.dir, name);
    await writeFile(fullPath, buffer);

    const md5 = createHash('md5').update(buffer).digest('hex');
    console.log(`[BIOS] Salva: ${name} (${this._formatBytes(buffer.length)}, md5 ${md5})`);

    return {
      name,
      region: KNOWN_BIOS[name.toLowerCase()] || 'Desconhecida',
      size: buffer.length,
      sizeFormatted: this._formatBytes(buffer.length),
      md5,
      known: Boolean(KNOWN_BIOS[name.toLowerCase()]),
      url: `/bios/${encodeURIComponent(name)}`
    };
  }

  /** Remove uma BIOS pelo nome */
  async remove(rawName) {
    const name = this.sanitizeName(rawName);
    if (!name) throw new Error('Nome de BIOS inválido');
    const fullPath = join(this.dir, name);
    await unlink(fullPath);
    console.log('[BIOS] Removida:', name);
    return { name };
  }

  /** Caminho absoluto de uma BIOS válida (ou null) */
  getPath(rawName) {
    const name = this.sanitizeName(rawName);
    if (!name) return null;
    const fullPath = join(this.dir, name);
    return existsSync(fullPath) ? fullPath : null;
  }

  /** Stream de leitura de uma BIOS */
  createStream(rawName) {
    const fullPath = this.getPath(rawName);
    if (!fullPath) return null;
    return createReadStream(fullPath);
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const biosStorage = new BiosStorage();
export default biosStorage;
