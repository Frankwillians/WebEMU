/**
 * Web Worker do Emulador PS1
 *
 * Roda o loop de emulação fora da thread principal para manter a UI fluida.
 * Comunica-se via postMessage com a thread principal.
 */

import { Emulator } from './emulator.js';
import type { MainToWorkerMessage, WorkerToMainMessage, EmulatorState } from './types.js';

const emulator = new Emulator({
  onFrame: (frame, audio) => {
    // Transfere os buffers (zero-copy) para a thread principal
    const message: WorkerToMainMessage = {
      type: 'frame',
      payload: {
        frame: frame.frame,
        fifo: {
          width: frame.width,
          height: frame.height,
          pixels: frame.pixels
        }
      }
    };

    const transfer: Transferable[] = [frame.pixels.buffer];
    if (audio && audio.length > 0) {
      (message.payload as any).audio = audio;
      transfer.push(audio.buffer);
    }

    (self as any).postMessage(message, transfer);
  },
  onStats: (stats) => {
    self.postMessage({ type: 'stats', payload: stats } as WorkerToMainMessage);
  },
  onError: (error) => {
    self.postMessage({ type: 'error', payload: { message: error.message, stack: error.stack } } as WorkerToMainMessage);
  },
  onLog: (level, message) => {
    self.postMessage({ type: 'log', payload: { level, message } } as WorkerToMainMessage);
  }
});

let animationFrameHandle: number | null = null;

/**
 * Loop de execução usando requestAnimationFrame-style scheduling.
 * Em workers, usamos setTimeout/setInterval ou o rAF do worker (quando disponível).
 */
function scheduleFrame(): void {
  // Usa um timer com drift correction para mirar 60 FPS
  animationFrameHandle = self.setTimeout(() => {
    if (!emulator.isRunning()) {
      animationFrameHandle = null;
      return;
    }
    tick();
    scheduleFrame();
  }, 1000 / 60);
}

function tick(): void {
  try {
    emulator.runFrame();
  } catch (error: any) {
    self.postMessage({
      type: 'error',
      payload: { message: error.message, stack: error.stack }
    } as WorkerToMainMessage);
    emulator.pause();
  }
}

// ==================== Handlers de mensagem ====================

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'loadROM': {
        const { rom, fileName, bios } = message.payload;
        if (bios) emulator.loadBIOS(bios);
        const info = emulator.loadROM(rom, fileName);
        self.postMessage({ type: 'romLoaded', payload: info } as WorkerToMainMessage);
        break;
      }

      case 'loadBIOS': {
        emulator.loadBIOS(message.payload.bios);
        self.postMessage({
          type: 'biosLoaded',
          payload: { size: message.payload.bios.byteLength }
        } as WorkerToMainMessage);
        break;
      }

      case 'start': {
        emulator.start();
        if (animationFrameHandle === null) scheduleFrame();
        break;
      }

      case 'pause': {
        emulator.pause();
        if (animationFrameHandle !== null) {
          self.clearTimeout(animationFrameHandle);
          animationFrameHandle = null;
        }
        break;
      }

      case 'resume': {
        emulator.resume();
        if (animationFrameHandle === null) scheduleFrame();
        break;
      }

      case 'reset': {
        emulator.reset();
        break;
      }

      case 'step': {
        emulator.step(message.payload.count);
        break;
      }

      case 'setInput': {
        const { player, buttons, analogLx, analogLy, analogRx, analogRy } = message.payload;
        const analog = (analogLx !== undefined) ? {
          lx: analogLx!, ly: analogLy!, rx: analogRx!, ry: analogRy!
        } : undefined;
        emulator.setInput(player, buttons, analog);
        break;
      }

      case 'getState': {
        const state = emulator.getState();
        self.postMessage({ type: 'state', payload: { state } } as WorkerToMainMessage);
        break;
      }

      case 'setState': {
        emulator.setState(message.payload.state as EmulatorState);
        break;
      }

      case 'serializeState': {
        const bytes = emulator.serializeState();
        (self as any).postMessage(
          { type: 'serializedState', payload: { state: bytes } } as WorkerToMainMessage,
          [bytes.buffer]
        );        break;
      }

      default:
        self.postMessage({
          type: 'log',
          payload: { level: 'warn', message: `Comando desconhecido: ${(message as any).type}` }
        } as WorkerToMainMessage);
    }
  } catch (error: any) {
    self.postMessage({
      type: 'error',
      payload: { message: error.message, stack: error.stack }
    } as WorkerToMainMessage);
  }
};

// Sinaliza que o worker está pronto
self.postMessage({ type: 'ready' } as WorkerToMainMessage);