/**
 * Emulador PS1 - Classe principal
 * Orquestra CPU, GPU, SPU e Bus; gerencia o loop de execução.
 */

import { SystemBus } from './bus.js';
import { CPU } from './cpu/interpreter.js';
import type {
  EmulatorState,
  ROMInfo,
  VideoFrame,
  EmulatorStats,
  ControllerState
} from './types.js';
import { PS1Button } from './types.js';

// Frequência do PS1
const CPU_CLOCK = 33_868_800;       // 33.8688 MHz
const GPU_CLOCK = 53_693_175;       // 53.693175 MHz
const FPS = 60;
const CYCLES_PER_FRAME = CPU_CLOCK / FPS; // ~564,480 ciclos por frame
const SPU_SAMPLE_RATE = 44_100;
const SAMPLES_PER_FRAME = Math.ceil(SPU_SAMPLE_RATE / FPS); // ~735

export interface EmulatorCallbacks {
  onFrame?: (frame: VideoFrame, audio: Float32Array) => void;
  onError?: (error: Error) => void;
  onStats?: (stats: EmulatorStats) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export class Emulator {
  private bus: SystemBus;
  private cpu: CPU;

  private running = false;
  private frame = 0;
  private loadedROM: ROMInfo | null = null;

  // Controles dos jogadores
  private controllers: ControllerState[] = [
    { buttons: 0, analogLx: 128, analogLy: 128, analogRx: 128, analogRy: 128 },
    { buttons: 0, analogLx: 128, analogLy: 128, analogRx: 128, analogRy: 128 }
  ];

  // Estatísticas
  private lastStatsTime = 0;
  private framesSinceStats = 0;
  private lastFrameTime = 0;

  private callbacks: EmulatorCallbacks;

  constructor(callbacks: EmulatorCallbacks = {}) {
    this.bus = new SystemBus();
    this.cpu = new CPU(this.bus);
    this.callbacks = callbacks;
  }

  // ==================== ROM / BIOS ====================

  loadBIOS(biosData: ArrayBuffer): void {
    this.bus.loadBIOS(new Uint8Array(biosData));
    this.cpu.reset();
    this.callbacks.onLog?.('info', `BIOS carregada (${biosData.byteLength} bytes)`);
  }

  loadROM(romData: ArrayBuffer, fileName: string): ROMInfo {
    const data = new Uint8Array(romData);
    this.bus.loadROM(data);

    // Tenta detectar região/serial
    const { region, serial } = this.detectGameInfo(data);

    this.loadedROM = {
      fileName,
      size: data.length,
      region,
      serial
    };

    this.callbacks.onLog?.('info', `ROM carregada: ${fileName} (${region})`);
    return this.loadedROM;
  }

  private detectGameInfo(data: Uint8Array): { region: string; serial: string } {
    // Procura pelo identificador de região/serial típico
    // String de serial ex: "SCUS_94163" ou "SLUS_00594"
    const textDecoder = new TextDecoder('ascii');
    const sample = textDecoder.decode(data.subarray(0, Math.min(data.length, 1024 * 1024)));

    // Regex para serial no formato XXXX_NNNNN
    const serialMatch = sample.match(/([A-Z]{4})[_-]([0-9]{5})/);
    let serial = 'Unknown';
    let region = 'Unknown';

    if (serialMatch) {
      serial = `${serialMatch[1]}_${serialMatch[2]}`;
      // Detecta região pelo prefixo
      const prefix = serialMatch[1].substring(0, 2);
      switch (prefix) {
        case 'SC': case 'SL': case 'SP':
          region = serialMatch[1][1] === 'S' ? 'USA' : 'USA';
          break;
        default:
          region = 'Unknown';
      }
      // Prefixos comuns por região
      if (/^S(C|L)(US|PS|PM)/.test(serialMatch[1])) region = 'USA';
      else if (/^S(C|L)(ES|ED|PS)/.test(serialMatch[1])) region = 'Europe';
      else if (/^S(C|L)(PS|PM)/.test(serialMatch[1])) region = 'Japan';
    }

    return { region, serial };
  }

  // ==================== Controle de execução ====================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.callbacks.onLog?.('info', 'Emulação iniciada');
  }

  pause(): void {
    this.running = false;
    this.callbacks.onLog?.('info', 'Emulação pausada');
  }

  resume(): void {
    this.running = true;
    this.callbacks.onLog?.('info', 'Emulação retomada');
  }

  reset(): void {
    this.cpu.reset();
    this.bus.reset();
    this.frame = 0;
    this.callbacks.onLog?.('info', 'Emulador resetado');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ==================== Loop de emulação ====================

  /**
   * Executa um frame completo de emulação.
   * Retorna a imagem renderizada (ou null se o display estiver desligado).
   */
  runFrame(): VideoFrame | null {
    const frameStart = performance.now();

    // 1. Executa ciclos de CPU para um frame
    let cyclesExecuted = 0;
    while (cyclesExecuted < CYCLES_PER_FRAME) {
      // Verifica interrupções
      this.cpu.checkInterrupts();

      // Executa instrução
      const cycles = this.cpu.step();
      cyclesExecuted += cycles;

      // Avança timers
      this.bus.tick(cycles);

      // Segurança: evita loop infinito em caso de PC inválido
      if (cyclesExecuted > CYCLES_PER_FRAME * 4) break;
    }

    // 2. Renderiza frame da GPU
    let videoFrame: VideoFrame | null = null;
    if (this.bus.gpu.displayEnabled || this.frame < 2) {
      const width = 320;
      const height = 240;
      const pixels = this.bus.gpu.renderFrame(width, height);
      videoFrame = { frame: this.frame, width, height, pixels };
    }

    // 3. Gera amostras de áudio
    const audio = this.bus.spu.generateSamples(SAMPLES_PER_FRAME);

    this.frame++;

    // 4. Estatísticas
    this.lastFrameTime = performance.now() - frameStart;
    this.framesSinceStats++;
    const now = performance.now();
    if (now - this.lastStatsTime >= 1000) {
      const fps = (this.framesSinceStats * 1000) / (now - this.lastStatsTime);
      this.callbacks.onStats?.({
        fps: Math.round(fps * 10) / 10,
        frameTime: Math.round(this.lastFrameTime * 100) / 100,
        cyclesPerSecond: Number(this.cpu.state.cycles)
      });
      this.framesSinceStats = 0;
      this.lastStatsTime = now;
    }

    return videoFrame;
  }

  /**
   * Executa um número específico de ciclos (para step() manual)
   */
  step(instructionCount: number): void {
    for (let i = 0; i < instructionCount; i++) {
      this.cpu.checkInterrupts();
      this.cpu.step();
    }
  }

  // ==================== Controles ====================

  setInput(player: number, buttons: number, analog?: { lx: number; ly: number; rx: number; ry: number }): void {
    if (player < 0 || player >= this.controllers.length) return;
    const ctrl = this.controllers[player];
    ctrl.buttons = buttons & 0xFFFF;
    if (analog) {
      ctrl.analogLx = analog.lx;
      ctrl.analogLy = analog.ly;
      ctrl.analogRx = analog.rx;
      ctrl.analogRy = analog.ry;
    }
    // Propaga para o bus (protocolo de joystick)
    this.bus['pendingInterrupts'] = this.bus['pendingInterrupts']; // no-op mantém referência
  }

  getController(player: number): ControllerState | null {
    return this.controllers[player] || null;
  }

  // ==================== Save States ====================

  getState(): EmulatorState {
    return {
      cpu: this.cpu.serialize(),
      gpu: {
        vram: this.bus.gpu.vram.slice(),
        displayEnabled: this.bus.gpu.displayEnabled,
        displayVramX: this.bus.gpu.displayVramX,
        displayVramY: this.bus.gpu.displayVramY,
        displayHoriz: this.bus.gpu.displayHoriz,
        displayVert: this.bus.gpu.displayVert,
        horizontalResolution: this.bus.gpu.horizontalResolution,
        verticalResolution: this.bus.gpu.verticalResolution,
        videoMode: this.bus.gpu.videoMode,
        displayAreaColorDepth: this.bus.gpu.displayAreaColorDepth,
        cycles: this.bus.gpu.cycles,
        gp0Command: 0,
        gp0Remaining: 0,
        gp0Buffer: new Uint32Array(16),
        gp0BufferIndex: 0
      },
      spu: {
        ram: this.bus.spu.ram.slice(),
        control: new Uint16Array(0),
        voices: [],
        transferAddress: 0,
        transferData: new Uint16Array(0),
        transferIndex: 0,
        sampleBufferL: new Float32Array(0),
        sampleBufferR: new Float32Array(0)
      },
      bus: {
        ram: this.bus.state.ram.slice(),
        bios: this.bus.state.bios.slice(),
        scratchpad: this.bus.state.scratchpad.slice(),
        memControl1: this.bus.state.memControl1.slice(),
        memControl2: this.bus.state.memControl2.slice(),
        iStat: this.bus.state.iStat,
        iMask: this.bus.state.iMask
      },
      frame: this.frame,
      timestamp: Date.now()
    };
  }

  setState(state: EmulatorState): void {
    this.cpu.deserialize(state.cpu);
    this.bus.gpu.vram.set(state.gpu.vram);
    this.bus.gpu.displayEnabled = state.gpu.displayEnabled;
    this.bus.gpu.displayVramX = state.gpu.displayVramX;
    this.bus.gpu.displayVramY = state.gpu.displayVramY;
    this.bus.gpu.horizontalResolution = state.gpu.horizontalResolution;
    this.bus.gpu.verticalResolution = state.gpu.verticalResolution;
    this.bus.spu.ram.set(state.spu.ram);
    this.bus.state.ram.set(state.bus.ram);
    this.bus.state.bios.set(state.bus.bios);
    this.bus.state.scratchpad.set(state.bus.scratchpad);
    this.bus.state.iStat = state.bus.iStat;
    this.bus.state.iMask = state.bus.iMask;
    this.frame = state.frame;
  }

  /**
   * Serializa o estado para envio via rede (formato binário compacto)
   */
  serializeState(): Uint8Array {
    const state = this.getState();
    // Em produção usaríamos um formato binário eficiente + compressão.
    // Aqui usamos JSON -> bytes para simplicidade.
    const json = JSON.stringify(state, (key, value) => {
      if (value instanceof Uint8Array) return { __type: 'Uint8Array', data: Array.from(value) };
      if (value instanceof Uint16Array) return { __type: 'Uint16Array', data: Array.from(value) };
      if (value instanceof Uint32Array) return { __type: 'Uint32Array', data: Array.from(value) };
      if (value instanceof Float32Array) return { __type: 'Float32Array', data: Array.from(value) };
      if (typeof value === 'bigint') return { __type: 'BigInt', data: value.toString() };
      return value;
    });
    return new TextEncoder().encode(json);
  }

  /**
   * Restaura estado a partir de bytes serializados
   */
  deserializeState(bytes: Uint8Array): void {
    const json = new TextDecoder().decode(bytes);
    const state = JSON.parse(json, (key, value) => {
      if (value && value.__type === 'Uint8Array') return new Uint8Array(value.data);
      if (value && value.__type === 'Uint16Array') return new Uint16Array(value.data);
      if (value && value.__type === 'Uint32Array') return new Uint32Array(value.data);
      if (value && value.__type === 'Float32Array') return new Float32Array(value.data);
      if (value && value.__type === 'BigInt') return BigInt(value.data);
      return value;
    }) as EmulatorState;
    this.setState(state);
  }

  getFrameCount(): number {
    return this.frame;
  }

  getROMInfo(): ROMInfo | null {
    return this.loadedROM;
  }

  /** Acesso ao barramento (usado por depuradores) */
  getBus(): SystemBus {
    return this.bus;
  }

  /** Acesso à CPU */
  getCPU(): CPU {
    return this.cpu;
  }
}

export { PS1Button };
export default Emulator;