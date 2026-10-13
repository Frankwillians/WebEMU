/**
 * Tipos compartilhados do Core de Emulação do PS1
 * Interface entre a thread principal e o Web Worker
 */

// ==================== CPU (MIPS R3000A) ====================

export interface CPUState {
  // Registradores de propósito geral (32 x 32-bit)
  gpr: Uint32Array;
  // Program Counter
  pc: number;
  // HI/LO (resultado de mult/div)
  hi: number;
  lo: number;
  // Coprocessor 0 (System Control) - 16 registradores
  cop0: Uint32Array;
  // Coprocessor 2 (GTE - Geometry Transformation Engine)
  cop2: Uint32Array;
  // Delay slot de branch
  branchTarget: number;
  inDelaySlot: boolean;
  // Ciclos desde último reset
  cycles: bigint;
}

// ==================== GPU ====================

export interface GPUState {
  // VRAM 1MB (1024x512 x 16-bit)
  vram: Uint16Array;
  // Registradores de display
  displayEnabled: boolean;
  displayVramX: number;
  displayVramY: number;
  displayHoriz: number;
  displayVert: number;
  horizontalResolution: number;
  verticalResolution: number;
  // Modo de vídeo
  videoMode: number;
  displayAreaColorDepth: number;
  // Ciclos da GPU
  cycles: number;
  // Estado do command buffer
  gp0Command: number;
  gp0Remaining: number;
  gp0Buffer: Uint32Array;
  gp0BufferIndex: number;
}

// ==================== SPU (Sound Processing Unit) ====================

export interface SPUState {
  // RAM de áudio 512KB
  ram: Uint8Array;
  // Registradores de controle
  control: Uint16Array;
  // Vozes (24 voices)
  voices: SPUVoiceState[];
  // Estado de transferência de RAM
  transferAddress: number;
  transferData: Uint16Array;
  transferIndex: number;
  // Buffer de saída (amostras)
  sampleBufferL: Float32Array;
  sampleBufferR: Float32Array;
}

export interface SPUVoiceState {
  active: boolean;
  pitch: number;
  startAddress: number;
  adsr: { attack: number; decay: number; sustain: number; release: number };
  volumeL: number;
  volumeR: number;
  currentAddress: number;
  adsrPhase: number;
  adsrVolume: number;
  sampleHistory: Int16Array;
}

// ==================== Bus / Sistema ====================

export interface BusState {
  // RAM principal 2MB (ou 8MB com expansão)
  ram: Uint8Array;
  // BIOS 512KB
  bios: Uint8Array;
  // Scratchpad 1KB
  scratchpad: Uint8Array;
  // Cache de controle / I/O
  memControl1: Uint32Array;
  memControl2: Uint32Array;
  // Interrupts
  iStat: number;
  iMask: number;
}

// ==================== Controles ====================

export interface ControllerState {
  // Botões digitais (bitmask)
  buttons: number;
  // Estados analógicos (se DualShock)
  analogLx: number;
  analogLy: number;
  analogRx: number;
  analogRy: number;
}

// Mapeamento de botões (bitmask do controle PS1)
export const PS1Button = {
  SELECT: 1 << 0,
  L3: 1 << 1,
  R3: 1 << 2,
  START: 1 << 3,
  UP: 1 << 4,
  RIGHT: 1 << 5,
  DOWN: 1 << 6,
  LEFT: 1 << 7,
  L2: 1 << 8,
  R2: 1 << 9,
  L1: 1 << 10,
  R1: 1 << 11,
  TRIANGLE: 1 << 12,
  CIRCLE: 1 << 13,
  CROSS: 1 << 14,
  SQUARE: 1 << 15
} as const;

// ==================== Estado completo / Save State ====================

export interface EmulatorState {
  cpu: CPUState;
  gpu: GPUState;
  spu: SPUState;
  bus: BusState;
  frame: number;
  timestamp: number;
}

// ==================== Mensagens Worker <-> Main Thread ====================

export type MainToWorkerMessage =
  | { type: 'loadROM'; payload: { rom: ArrayBuffer; fileName: string; bios?: ArrayBuffer } }
  | { type: 'loadBIOS'; payload: { bios: ArrayBuffer } }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'step'; payload: { count: number } }
  | { type: 'setInput'; payload: { player: number; buttons: number; analogLx?: number; analogLy?: number; analogRx?: number; analogRy?: number } }
  | { type: 'getState' }
  | { type: 'setState'; payload: { state: EmulatorState } }
  | { type: 'serializeState' };

export type WorkerToMainMessage =
  | { type: 'ready' }
  | { type: 'romLoaded'; payload: { fileName: string; size: number; region: string; serial: string } }
  | { type: 'biosLoaded'; payload: { size: number } }
  | { type: 'frame'; payload: { frame: number; fifo: { width: number; height: number; pixels: Uint8Array } } }
  | { type: 'state'; payload: { state: EmulatorState } }
  | { type: 'serializedState'; payload: { state: Uint8Array } }
  | { type: 'error'; payload: { message: string; stack?: string } }
  | { type: 'log'; payload: { level: 'info' | 'warn' | 'error'; message: string } }
  | { type: 'stats'; payload: { fps: number; frameTime: number; cyclesPerSecond: number } };

// ==================== API do Emulador (Main Thread) ====================

export interface EmulatorAPI {
  loadROM(rom: ArrayBuffer, fileName: string): Promise<ROMInfo>;
  loadBIOS(bios: ArrayBuffer): Promise<void>;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  step(count: number): void;
  setInput(player: number, buttons: number, analog?: { lx: number; ly: number; rx: number; ry: number }): void;
  getState(): Promise<EmulatorState>;
  setState(state: EmulatorState): Promise<void>;
  serializeState(): Promise<Uint8Array>;
  onFrame(callback: (frame: VideoFrame) => void): void;
  onError(callback: (error: Error) => void): void;
  onStats(callback: (stats: EmulatorStats) => void): void;
  destroy(): void;
}

export interface ROMInfo {
  fileName: string;
  size: number;
  region: string;
  serial: string;
}

export interface VideoFrame {
  frame: number;
  width: number;
  height: number;
  pixels: Uint8Array; // RGBA
}

export interface EmulatorStats {
  fps: number;
  frameTime: number;
  cyclesPerSecond: number;
}
