/**
 * API pública do Core de Emulação (executa na thread principal)
 * Envolve o Web Worker e expõe uma interface Promise-based limpa.
 */

import type {
  EmulatorAPI,
  ROMInfo,
  VideoFrame,
  EmulatorStats,
  EmulatorState,
  MainToWorkerMessage,
  WorkerToMainMessage
} from './types.js';

export class EmulatorClient implements EmulatorAPI {
  private worker: Worker;
  private ready: boolean;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  private frameCallbacks: ((frame: VideoFrame, audio: Float32Array | null) => void)[] = [];
  private errorCallbacks: ((error: Error) => void)[] = [];
  private statsCallbacks: ((stats: EmulatorStats) => void)[] = [];
  private logCallbacks: ((level: string, message: string) => void)[] = [];

  private pendingStateRequests: ((state: EmulatorState) => void)[] = [];
  private pendingSerialize: ((bytes: Uint8Array) => void)[] = [];
  private pendingROMLoad: ((info: ROMInfo) => void)[] = [];

  constructor() {
    // Cria o worker a partir do módulo (Vite lida com o bundling)
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module'
    });

    this.ready = false;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    this.worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleMessage(event.data);
    };

    this.worker.onerror = (error) => {
      this.emitError(new Error(`Erro no worker: ${error.message}`));
    };
  }

  private handleMessage(message: WorkerToMainMessage): void {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.readyResolve();
        break;

      case 'romLoaded': {
        const cb = this.pendingROMLoad.shift();
        cb?.(message.payload);
        break;
      }

      case 'frame': {
        const frameNumber = message.payload.frame;
        const { fifo } = message.payload;
        const audio = (message.payload as any).audio || null;
        const videoFrame: VideoFrame = {
          frame: frameNumber,
          width: fifo.width,
          height: fifo.height,
          pixels: fifo.pixels
        };
        for (const cb of this.frameCallbacks) cb(videoFrame, audio);
        break;
      }

      case 'state': {
        const cb = this.pendingStateRequests.shift();
        cb?.(message.payload.state);
        break;
      }

      case 'serializedState': {
        const cb = this.pendingSerialize.shift();
        cb?.(message.payload.state);
        break;
      }

      case 'stats':
        for (const cb of this.statsCallbacks) cb(message.payload);
        break;

      case 'error':
        this.emitError(new Error(message.payload.message));
        break;

      case 'log':
        for (const cb of this.logCallbacks) cb(message.payload.level, message.payload.message);
        break;

      case 'biosLoaded':
        // Opcional: callback
        break;
    }
  }

  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) cb(error);
  }

  private post(message: MainToWorkerMessage, transfer?: Transferable[]): void {
    this.worker.postMessage(message, transfer || []);
  }

  // ==================== API pública ====================

  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  async loadROM(rom: ArrayBuffer, fileName: string): Promise<ROMInfo> {
    await this.readyPromise;
    return new Promise((resolve) => {
      this.pendingROMLoad.push(resolve);
      this.post({ type: 'loadROM', payload: { rom, fileName } }, [rom]);
    });
  }

  async loadBIOS(bios: ArrayBuffer): Promise<void> {
    await this.readyPromise;
    this.post({ type: 'loadBIOS', payload: { bios } }, [bios]);
  }

  start(): void {
    this.post({ type: 'start' });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  resume(): void {
    this.post({ type: 'resume' });
  }

  reset(): void {
    this.post({ type: 'reset' });
  }

  step(count: number): void {
    this.post({ type: 'step', payload: { count } });
  }

  setInput(player: number, buttons: number, analog?: { lx: number; ly: number; rx: number; ry: number }): void {
    this.post({
      type: 'setInput',
      payload: {
        player,
        buttons,
        analogLx: analog?.lx,
        analogLy: analog?.ly,
        analogRx: analog?.rx,
        analogRy: analog?.ry
      }
    });
  }

  async getState(): Promise<EmulatorState> {
    await this.readyPromise;
    return new Promise((resolve) => {
      this.pendingStateRequests.push(resolve);
      this.post({ type: 'getState' });
    });
  }

  async setState(state: EmulatorState): Promise<void> {
    await this.readyPromise;
    // Clona arrays para evitar problemas de transferência
    this.post({ type: 'setState', payload: { state } });
  }

  async serializeState(): Promise<Uint8Array> {
    await this.readyPromise;
    return new Promise((resolve) => {
      this.pendingSerialize.push(resolve);
      this.post({ type: 'serializeState' });
    });
  }

  async deserializeState(bytes: Uint8Array): Promise<void> {
    // Reusa getState/setState via serialização
    const json = new TextDecoder().decode(bytes);
    const state = JSON.parse(json, (_key, value) => {
      if (value && value.__type === 'Uint8Array') return new Uint8Array(value.data);
      if (value && value.__type === 'Uint16Array') return new Uint16Array(value.data);
      if (value && value.__type === 'Uint32Array') return new Uint32Array(value.data);
      if (value && value.__type === 'Float32Array') return new Float32Array(value.data);
      if (value && value.__type === 'BigInt') return BigInt(value.data);
      return value;
    }) as EmulatorState;
    await this.setState(state);
  }

  onFrame(callback: (frame: VideoFrame, audio: Float32Array | null) => void): void {
    this.frameCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  onStats(callback: (stats: EmulatorStats) => void): void {
    this.statsCallbacks.push(callback);
  }

  onLog(callback: (level: string, message: string) => void): void {
    this.logCallbacks.push(callback);
  }

  destroy(): void {
    this.worker.terminate();
  }
}

/**
 * Factory: cria uma nova instância do cliente do emulador
 */
export function createEmulator(): EmulatorClient {
  return new EmulatorClient();
}

export * from './types.js';
export { Emulator } from './emulator.js';
export { SystemBus } from './bus.js';
export { CPU } from './cpu/interpreter.js';
export { GPURasterizer } from './gpu/gpu.js';
export { SPU } from './spu/spu.js';