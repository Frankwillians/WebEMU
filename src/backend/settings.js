/**
 * Configurações persistentes do usuário.
 *
 * Diferente do `.env` (que é estático), aqui ficam os ajustes feitos pela
 * interface — por exemplo a pasta de jogos escolhida em `/play.html`.
 * São gravados em `ps1emu.config.json` na raiz do projeto.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { projectRoot } from './config.js';

export const settingsPath = resolve(projectRoot, 'ps1emu.config.json');

/**
 * Lê as configurações salvas (ou objeto vazio).
 * @returns {Record<string, any>}
 */
export function loadSettings() {
  try {
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (err) {
    console.warn('[SETTINGS] Falha ao ler configurações:', err.message);
  }
  return {};
}

/**
 * Mescla e salva configurações.
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>} configurações resultantes
 */
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[SETTINGS] Falha ao salvar configurações:', err.message);
  }
  return next;
}

export default { loadSettings, saveSettings, settingsPath };
