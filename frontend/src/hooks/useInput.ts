/**
 * Hook useInput - Mapeia teclado e gamepad para botões do PS1
 * Retorna o bitmask atual dos botões pressionados.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { PS1Button } from '../core/types';
import type { KeyMapping, GamepadMapping } from '../types';

// Mapeamento padrão de teclado
export const DEFAULT_KEY_MAPPING: KeyMapping = {
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  CROSS: 'x',
  CIRCLE: 'c',
  SQUARE: 's',
  TRIANGLE: 'd',
  L1: 'q',
  R1: 'e',
  L2: 'a',
  R2: 'f',
  START: 'Enter',
  SELECT: 'Shift'
};

// Mapeamento padrão de gamepad (índices do Standard Gamepad)
export const DEFAULT_GAMEPAD_MAPPING: GamepadMapping = {
  CROSS: 0,      // A / Cross
  CIRCLE: 1,     // B / Circle
  SQUARE: 2,     // X / Square
  TRIANGLE: 3,   // Y / Triangle
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15
};

const BUTTON_BITS: Record<string, number> = {
  SELECT: PS1Button.SELECT,
  START: PS1Button.START,
  UP: PS1Button.UP,
  DOWN: PS1Button.DOWN,
  LEFT: PS1Button.LEFT,
  RIGHT: PS1Button.RIGHT,
  L1: PS1Button.L1,
  R1: PS1Button.R1,
  L2: PS1Button.L2,
  R2: PS1Button.R2,
  TRIANGLE: PS1Button.TRIANGLE,
  CIRCLE: PS1Button.CIRCLE,
  CROSS: PS1Button.CROSS,
  SQUARE: PS1Button.SQUARE
};

const STORAGE_KEY_KEYBOARD = 'ps1emu.keyMapping';
const STORAGE_KEY_GAMEPAD = 'ps1emu.gamepadMapping';

export function useInput() {
  const buttonsRef = useRef(0);
  const [buttons, setButtons] = useState(0);
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadName, setGamepadName] = useState<string | null>(null);

  const keyMappingRef = useRef<KeyMapping>(loadKeyMapping());
  const gamepadMappingRef = useRef<GamepadMapping>(loadGamepadMapping());

  // Atualiza o bitmask a partir do teclado
  const pressedKeys = useRef(new Set<string>());

  useEffect(() => {
    const computeButtons = () => {
      let mask = 0;

      // Teclado
      for (const [button, key] of Object.entries(keyMappingRef.current)) {
        if (key && pressedKeys.current.has(key.toLowerCase())) {
          mask |= BUTTON_BITS[button] || 0;
        }
      }

      // Gamepad
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp || !gp.connected) continue;
        for (const [button, index] of Object.entries(gamepadMappingRef.current)) {
          if (index === null || index === undefined) continue;
          const b = gp.buttons[index];
          if (b && b.pressed) {
            mask |= BUTTON_BITS[button] || 0;
          }
        }
        // D-pad via eixos (alguns gamepads)
        if (gp.axes[0] < -0.5) mask |= PS1Button.LEFT;
        if (gp.axes[0] > 0.5) mask |= PS1Button.RIGHT;
        if (gp.axes[1] < -0.5) mask |= PS1Button.UP;
        if (gp.axes[1] > 0.5) mask |= PS1Button.DOWN;
      }

      mask &= 0xFFFF;
      if (mask !== buttonsRef.current) {
        buttonsRef.current = mask;
        setButtons(mask);
      }
    };

    const keydownHandler = (e: KeyboardEvent) => {
      pressedKeys.current.add(e.key.toLowerCase());
      // Evita scroll com setas
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      computeButtons();
    };

    const keyupHandler = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key.toLowerCase());
      computeButtons();
    };

    const gamepadConnectedHandler = (e: GamepadEvent) => {
      setGamepadConnected(true);
      setGamepadName(e.gamepad.id);
    };

    const gamepadDisconnectedHandler = () => {
      setGamepadConnected(false);
      setGamepadName(null);
    };

    // Loop de polling para gamepad (a API não tem eventos de botão)
    let rafId: number;
    const poll = () => {
      computeButtons();
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);

    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('keyup', keyupHandler);
    window.addEventListener('gamepadconnected', gamepadConnectedHandler);
    window.addEventListener('gamepaddisconnected', gamepadDisconnectedHandler);

    return () => {
      window.removeEventListener('keydown', keydownHandler);
      window.removeEventListener('keyup', keyupHandler);
      window.removeEventListener('gamepadconnected', gamepadConnectedHandler);
      window.removeEventListener('gamepaddisconnected', gamepadDisconnectedHandler);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const setKeyMapping = useCallback((mapping: KeyMapping) => {
    keyMappingRef.current = mapping;
    localStorage.setItem(STORAGE_KEY_KEYBOARD, JSON.stringify(mapping));
  }, []);

  const setGamepadMapping = useCallback((mapping: GamepadMapping) => {
    gamepadMappingRef.current = mapping;
    localStorage.setItem(STORAGE_KEY_GAMEPAD, JSON.stringify(mapping));
  }, []);

  return {
    buttons,
    gamepadConnected,
    gamepadName,
    keyMapping: keyMappingRef.current,
    gamepadMapping: gamepadMappingRef.current,
    setKeyMapping,
    setGamepadMapping
  };
}

function loadKeyMapping(): KeyMapping {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_KEYBOARD);
    if (stored) return { ...DEFAULT_KEY_MAPPING, ...JSON.parse(stored) };
  } catch { /* ignora */ }
  return { ...DEFAULT_KEY_MAPPING };
}

function loadGamepadMapping(): GamepadMapping {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_GAMEPAD);
    if (stored) return { ...DEFAULT_GAMEPAD_MAPPING, ...JSON.parse(stored) };
  } catch { /* ignora */ }
  return { ...DEFAULT_GAMEPAD_MAPPING };
}

export { PS1Button };
export default useInput;