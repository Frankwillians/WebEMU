/**
 * System Bus - Conecta todos os componentes do PS1
 * Mapeia o espaço de endereços de 32-bits do MIPS R3000A
 *
 * Mapa de memória do PS1:
 *   0x1F80_0000 - 0x1F80_1FFF : Scratchpad (1KB)
 *   0x1F80_1000 - 0x1F80_1FFF : Hardware Registers / I/O
 *   0x1F80_2000 - 0x1F80_2FFF : ...
 *   0x1FC0_0000 - 0x1FC7_FFFF : BIOS (512KB)
 *   0x0000_0000 - 0x001F_FFFF : RAM principal (2MB, espelhada)
 */

import type { BusState, GPUState, SPUState } from './types.js';
import { GPURasterizer } from './gpu/gpu.js';
import { SPU } from './spu/spu.js';

// Tamanhos de memória
export const RAM_SIZE = 2 * 1024 * 1024;       // 2MB
export const BIOS_SIZE = 512 * 1024;           // 512KB
export const SCRATCHPAD_SIZE = 1024;           // 1KB
export const VRAM_SIZE = 1024 * 512;           // 1MB em pixels 16-bit

// Regiões de memória
export const REGION = {
  RAM_MASK: 0x1FFFFF,
  BIOS_MASK: 0x0007FFFF,
  SCRATCHPAD_MASK: 0x000003FF,
  IO_MASK: 0x00003FFF
} as const;

/**
 * Endereços de hardware I/O relevantes
 */
export const IO_ADDR = {
  MEM_CONTROL_1: 0x1F801000,
  MEM_CONTROL_2: 0x1F801004,
  MEM_CONTROL_3: 0x1F801008,
  RAM_SIZE_REG: 0x1F801060,
  IRQ_STATUS: 0x1F801070,
  IRQ_MASK: 0x1F801074,
  GPU_GP0: 0x1F801810,
  GPU_GP1: 0x1F801814,
  SPU_BASE: 0x1F801C00,
  JOY_DATA: 0x1F801040,
  JOY_STAT: 0x1F801044,
  JOY_MODE: 0x1F801048,
  JOY_CTRL: 0x1F80104A,
  JOY_BAUD: 0x1F80104E,
  TIMER_BASE: 0x1F801100,
  CDROM_BASE: 0x1F801800,
  DMA_BASE: 0x1F801080
} as const;

/**
 * System Bus
 */
export class SystemBus {
  public state: BusState;

  // Componentes conectados
  public gpu: GPURasterizer;
  public spu: SPU;

  // Timers (3 timers do PS1)
  private timers: { counter: number; target: number; mode: number }[];

  // DMA channels
  private dmaChannels: { base: number; blockControl: number; channelControl: number }[];

  // Buffers de interrupção
  private pendingInterrupts = 0;

  constructor() {
    this.state = {
      ram: new Uint8Array(RAM_SIZE),
      bios: new Uint8Array(BIOS_SIZE),
      scratchpad: new Uint8Array(SCRATCHPAD_SIZE),
      memControl1: new Uint32Array(9),
      memControl2: new Uint32Array(9),
      iStat: 0,
      iMask: 0
    };

    this.gpu = new GPURasterizer();
    this.spu = new SPU();

    this.timers = [
      { counter: 0, target: 0, mode: 0 },
      { counter: 0, target: 0, mode: 0 },
      { counter: 0, target: 0, mode: 0 }
    ];

    this.dmaChannels = Array.from({ length: 7 }, () => ({
      base: 0,
      blockControl: 0,
      channelControl: 0
    }));
  }

  /**
   * Carrega a BIOS na memória
   */
  loadBIOS(biosData: Uint8Array): void {
    if (biosData.length > BIOS_SIZE) {
      throw new Error(`BIOS muito grande: ${biosData.length} bytes (máx ${BIOS_SIZE})`);
    }
    this.state.bios.set(biosData, 0);
  }

  /**
   * Carrega uma ROM de jogo na RAM
   * Nota: No PS1 os jogos são executados do CD-ROM, mas para o MVP
   * carregamos o executável direto na RAM.
   */
  loadROM(romData: Uint8Array): void {
    // Um ISO completo contém o setor de boot; extraímos o PS-EXE.
    // Para o MVP, tratamos o arquivo como um binário carregável.
    const exe = this.parsePSXExecutable(romData);
    if (exe) {
      this.state.ram.set(exe.data, exe.loadAddress & REGION.RAM_MASK);
    } else {
      // Fallback: carrega direto a partir do offset 0x800
      this.state.ram.set(romData.subarray(0, Math.min(romData.length, RAM_SIZE)));
    }
  }

  /**
   * Tenta parsear um arquivo executável PS-X EXE
   * Formato: magic "PS-X EXE" em 0x800 (offset 2048 no arquivo)
   */
  private parsePSXExecutable(data: Uint8Array): { loadAddress: number; data: Uint8Array } | null {
    const magic = 'PS-X EXE';
    // Procura o magic em offsets comuns (0x800 para PS-X EXE)
    const searchOffsets = [0x800, 0x0000];
    for (const offset of searchOffsets) {
      if (offset + 8 > data.length) continue;
      let matches = true;
      for (let i = 0; i < 8; i++) {
        if (data[offset + i] !== magic.charCodeAt(i)) { matches = false; break; }
      }
      if (matches) {
        // Header PS-X EXE:
        // 0x10: PC inicial (u32)
        // 0x18: Endereço de carga em RAM (u32)
        // 0x1C: Tamanho do arquivo (u32)
        const loadAddress = this.readU32LE(data, offset + 0x18);
        const fileSize = this.readU32LE(data, offset + 0x1C);
        const actualSize = Math.min(fileSize, data.length - (offset + 0x800));
        const payload = data.subarray(offset + 0x800, offset + 0x800 + actualSize);
        return { loadAddress, data: payload };
      }
    }
    return null;
  }

  private readU32LE(data: Uint8Array, offset: number): number {
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  }

  // ==================== Leitura de memória ====================

  /**
   * Lê 8 bits do barramento
   */
  read8(address: number): number {
    address >>>= 0;
    const region = address >>> 24;

    // RAM principal (0x00000000 - 0x001FFFFF), espelhada
    if (address < 0x00800000) {
      return this.state.ram[address & REGION.RAM_MASK];
    }
    // Scratchpad
    if (address >= 0x1F800000 && address < 0x1F800400) {
      return this.state.scratchpad[address & REGION.SCRATCHPAD_MASK];
    }
    // I/O
    if (address >= 0x1F801000 && address < 0x1F802000) {
      return this.ioRead8(address);
    }
    // BIOS
    if (address >= 0x1FC00000 && address < 0x1FC80000) {
      return this.state.bios[address & REGION.BIOS_MASK];
    }
    // Regiões não mapeadas
    return 0;
  }

  /**
   * Lê 16 bits (little-endian)
   */
  read16(address: number): number {
    address >>>= 0;
    if (address < 0x00800000) {
      const idx = address & REGION.RAM_MASK;
      return this.state.ram[idx] | (this.state.ram[idx + 1] << 8);
    }
    if (address >= 0x1F800000 && address < 0x1F800400) {
      const idx = address & REGION.SCRATCHPAD_MASK;
      return this.state.scratchpad[idx] | (this.state.scratchpad[idx + 1] << 8);
    }
    if (address >= 0x1F801000 && address < 0x1F802000) {
      return this.ioRead16(address);
    }
    if (address >= 0x1FC00000 && address < 0x1FC80000) {
      const idx = address & REGION.BIOS_MASK;
      return this.state.bios[idx] | (this.state.bios[idx + 1] << 8);
    }
    return 0;
  }

  /**
   * Lê 32 bits (little-endian)
   */
  read32(address: number): number {
    address >>>= 0;
    if (address < 0x00800000) {
      const idx = address & REGION.RAM_MASK & ~3;
      const ram = this.state.ram;
      return (ram[idx] | (ram[idx + 1] << 8) | (ram[idx + 2] << 16) | (ram[idx + 3] << 24)) >>> 0;
    }
    if (address >= 0x1F800000 && address < 0x1F800400) {
      const idx = address & REGION.SCRATCHPAD_MASK & ~3;
      const s = this.state.scratchpad;
      return (s[idx] | (s[idx + 1] << 8) | (s[idx + 2] << 16) | (s[idx + 3] << 24)) >>> 0;
    }
    if (address >= 0x1F801000 && address < 0x1F802000) {
      return this.ioRead32(address);
    }
    if (address >= 0x1FC00000 && address < 0x1FC80000) {
      const idx = address & REGION.BIOS_MASK & ~3;
      const b = this.state.bios;
      return (b[idx] | (b[idx + 1] << 8) | (b[idx + 2] << 16) | (b[idx + 3] << 24)) >>> 0;
    }
    return 0;
  }

  // ==================== Escrita de memória ====================

  write8(address: number, value: number): void {
    address >>>= 0;
    value &= 0xFF;
    if (address < 0x00800000) {
      this.state.ram[address & REGION.RAM_MASK] = value;
      return;
    }
    if (address >= 0x1F800000 && address < 0x1F800400) {
      this.state.scratchpad[address & REGION.SCRATCHPAD_MASK] = value;
      return;
    }
    if (address >= 0x1F801000 && address < 0x1F802000) {
      this.ioWrite8(address, value);
      return;
    }
  }

  write16(address: number, value: number): void {
    address >>>= 0;
    value &= 0xFFFF;
    if (address < 0x00800000) {
      const idx = address & REGION.RAM_MASK;
      this.state.ram[idx] = value & 0xFF;
      this.state.ram[idx + 1] = (value >> 8) & 0xFF;
      return;
    }
    if (address >= 0x1F800000 && address < 0x1F800400) {
      const idx = address & REGION.SCRATCHPAD_MASK;
      this.state.scratchpad[idx] = value & 0xFF;
      this.state.scratchpad[idx + 1] = (value >> 8) & 0xFF;
      return;
    }
    if (address >= 0x1F801000 && address < 0x1F802000) {
      this.ioWrite16(address, value);
      return;
    }
  }

  write32(address: number, value: number): void {
    address >>>= 0;
    value >>>= 0;
    if (address < 0x00800000) {
      const idx = address & REGION.RAM_MASK & ~3;
      const ram = this.state.ram;
      ram[idx] = value & 0xFF;
      ram[idx + 1] = (value >> 8) & 0xFF;
      ram[idx + 2] = (value >> 16) & 0xFF;
      ram[idx + 3] = (value >> 24) & 0xFF;
      return;
    }
    if (address >= 0x1F800000 && address < 0x1F800400) {
      const idx = address & REGION.SCRATCHPAD_MASK & ~3;
      const s = this.state.scratchpad;
      s[idx] = value & 0xFF;
      s[idx + 1] = (value >> 8) & 0xFF;
      s[idx + 2] = (value >> 16) & 0xFF;
      s[idx + 3] = (value >> 24) & 0xFF;
      return;
    }
    if (address >= 0x1F801000 && address < 0x1F802000) {
      this.ioWrite32(address, value);
      return;
    }
  }

  // ==================== I/O ====================

  private ioRead8(address: number): number {
    switch (address) {
      case IO_ADDR.JOY_DATA:
        return 0xFF; // Sem controle conectado no MVP
      default:
        return 0;
    }
  }

  private ioRead16(address: number): number {
    // GPU status (GPUSTAT)
    if (address === 0x1F801814) {
      return this.gpu.getStatus() & 0xFFFF;
    }
    // IRQ status
    if (address === IO_ADDR.IRQ_STATUS) {
      return this.state.iStat;
    }
    if (address === IO_ADDR.IRQ_MASK) {
      return this.state.iMask;
    }
    return 0;
  }

  private ioRead32(address: number): number {
    if (address === 0x1F801810) {
      return this.gpu.readGPUREAD();
    }
    if (address === 0x1F801814) {
      return this.gpu.getStatus();
    }
    if (address === IO_ADDR.IRQ_STATUS) {
      return this.state.iStat;
    }
    if (address === IO_ADDR.IRQ_MASK) {
      return this.state.iMask;
    }
    return 0;
  }

  private ioWrite8(address: number, value: number): void {
    // Joystick / Controles
    if (address === IO_ADDR.JOY_DATA) {
      // TODO: implementar protocolo de joystick
      return;
    }
  }

  private ioWrite16(address: number, value: number): void {
    // Timers
    if (address >= 0x1F801100 && address < 0x1F801130) {
      const timerIdx = ((address - 0x1F801100) / 0x10) | 0;
      const reg = (address - 0x1F801100) % 0x10;
      if (timerIdx < 3) {
        if (reg === 0) this.timers[timerIdx].counter = value;
        else if (reg === 4) this.timers[timerIdx].target = value;
        else if (reg === 8) this.timers[timerIdx].mode = value;
      }
      return;
    }
    // IRQ mask
    if (address === IO_ADDR.IRQ_MASK) {
      this.state.iMask = value;
      return;
    }
    // IRQ status (acknowledge)
    if (address === IO_ADDR.IRQ_STATUS) {
      this.state.iStat &= value;
      return;
    }
    // SPU
    if (address >= 0x1F801C00 && address < 0x1F802000) {
      this.spu.writeRegister(address, value);
      return;
    }
  }

  private ioWrite32(address: number, value: number): void {
    // GPU GP0 (render command)
    if (address === 0x1F801810) {
      this.gpu.writeGP0(value);
      return;
    }
    // GPU GP1 (control command)
    if (address === 0x1F801814) {
      this.gpu.writeGP1(value);
      return;
    }
    // Memory control
    if (address >= 0x1F801000 && address < 0x1F801024) {
      const idx = (address - 0x1F801000) >> 2;
      this.state.memControl1[idx] = value;
      return;
    }
    if (address >= IO_ADDR.IRQ_STATUS && address <= 0x1F801074) {
      if (address === IO_ADDR.IRQ_STATUS) {
        this.state.iStat &= value;
      } else {
        this.state.iMask = value & 0xFFFF;
      }
      return;
    }
    // DMA
    if (address >= 0x1F801080 && address < 0x1F801100) {
      const channel = ((address - 0x1F801080) / 0x10) | 0;
      const reg = (address - 0x1F801080) % 0x10;
      if (channel < 7) {
        if (reg === 0) this.dmaChannels[channel].base = value;
        else if (reg === 4) this.dmaChannels[channel].blockControl = value;
        else if (reg === 8) this.dmaChannels[channel].channelControl = value;
      }
      return;
    }
  }

  /**
   * Solicita uma interrupção
   */
  requestInterrupt(irq: number): void {
    this.pendingInterrupts |= irq;
    this.state.iStat |= irq;
  }

  /**
   * Retorna se há interrupção pendente não mascarada
   */
  hasPendingInterrupt(): boolean {
    return (this.state.iStat & this.state.iMask) !== 0;
  }

  /**
   * Reseta o barramento
   */
  reset(): void {
    this.state.ram.fill(0);
    this.state.scratchpad.fill(0);
    this.pendingInterrupts = 0;
    this.state.iStat = 0;
    this.state.iMask = 0;
    this.gpu.reset();
    this.spu.reset();
  }

  /**
   * Avança os timers e componentes de tempo
   */
  tick(cycles: number): void {
    // Timers contam a cada ciclo (simplificado)
    for (const timer of this.timers) {
      timer.counter = (timer.counter + cycles) & 0xFFFF;
    }
  }
}

export default SystemBus;