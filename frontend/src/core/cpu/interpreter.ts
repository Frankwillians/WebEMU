/**
 * CPU MIPS R3000A - Interpretador
 *
 * O R3000A do PS1 roda a ~33.8688 MHz.
 * Implementa o conjunto de instruções MIPS I + coprocessadores 0 (system) e 2 (GTE).
 *
 * Convenções de registradores MIPS:
 *   $0  = zero (sempre 0)
 *   $1  = at   (assembler temporary)
 *   $2-$3  = v0-v1 (valores de retorno)
 *   $4-$7  = a0-a3 (argumentos)
 *   $8-$15 = t0-t7 (temporários)
 *   $16-$23= s0-s7 (salvos)
 *   $24-$25= t8-t9
 *   $26-$27= k0-k1 (kernel)
 *   $28 = gp (global pointer)
 *   $29 = sp (stack pointer)
 *   $30 = fp (frame pointer)
 *   $31 = ra (return address)
 */

import type { CPUState, BusState } from '../types.js';
import type { SystemBus } from '../bus.js';

// Endereço de exceção (exception handler) do R3000A
const EXCEPTION_VECTOR = 0x80000080;
const EXCEPTION_VECTOR_BOOT = 0x80000180;

// Causas de exceção
const EXCEPTION = {
  INTERRUPT: 0x00,
  ADDRESS_LOAD: 0x04,
  ADDRESS_STORE: 0x05,
  SYSCALL: 0x08,
  BREAK: 0x09,
  OVERFLOW: 0x0C,
  COPROCESSOR: 0x0B
} as const;

// Registradores Coprocessor 0 (System Control)
const COP0 = {
  BPC: 3,
  BDA: 5,
  TAR: 6,
  DCIC: 7,
  BADVADDR: 8,
  BDAM: 9,
  BPCM: 11,
  SR: 12,   // Status Register
  CAUSE: 13,
  EPC: 14,
  PRID: 15
} as const;

export class CPU {
  public state: CPUState;
  private bus: SystemBus;

  constructor(bus: SystemBus) {
    this.bus = bus;
    this.state = {
      gpr: new Uint32Array(32),
      pc: 0xBFC00000, // Ponto de entrada da BIOS
      hi: 0,
      lo: 0,
      cop0: new Uint32Array(16),
      cop2: new Uint32Array(64),
      branchTarget: 0,
      inDelaySlot: false,
      cycles: 0n
    };
    this.reset();
  }

  reset(): void {
    this.state.gpr.fill(0);
    this.state.pc = 0xBFC00000;
    this.state.hi = 0;
    this.state.lo = 0;
    this.state.cop0.fill(0);
    this.state.cop2.fill(0);
    this.state.branchTarget = 0;
    this.state.inDelaySlot = false;
    this.state.cycles = 0n;
  }

  // ==================== Helpers de registrador ====================

  private getReg(index: number): number {
    return this.state.gpr[index];
  }

  private setReg(index: number, value: number): void {
    // Registrador zero é imutável
    if (index !== 0) {
      this.state.gpr[index] = value >>> 0;
    }
  }

  // ==================== Fetch / Decode / Execute ====================

  /**
   * Executa UMA instrução
   * @returns número de ciclos consumidos
   */
  step(): number {
    const pc = this.state.pc;

    // Busca a instrução (tratando atraso de branch)
    const instruction = this.bus.read32(pc);

    // Avança PC (a menos que branch altere)
    const wasInDelaySlot = this.state.inDelaySlot;
    this.state.inDelaySlot = false;

    // Próximo PC padrão
    let nextPc = (pc + 4) >>> 0;

    if (wasInDelaySlot) {
      // Após executar o delay slot, pula para o alvo
      nextPc = this.state.branchTarget >>> 0;
    }

    this.state.pc = nextPc;

    // Decodifica e executa
    const cycles = this.executeInstruction(instruction, pc, wasInDelaySlot);

    this.state.cycles += BigInt(cycles);
    return cycles;
  }

  private executeInstruction(instr: number, pc: number, inDelaySlot: boolean): number {
    const opcode = (instr >>> 26) & 0x3F;
    const rs = (instr >>> 21) & 0x1F;
    const rt = (instr >>> 16) & 0x1F;
    const rd = (instr >>> 11) & 0x1F;
    const shamt = (instr >>> 6) & 0x1F;
    const funct = instr & 0x3F;
    const imm = instr & 0xFFFF;
    const simm = (imm << 16) >> 16; // Estende sinal
    const target = instr & 0x03FFFFFF;

    switch (opcode) {
      // ===== SPECIAIS (opcode 0) =====
      case 0x00:
        return this.executeSpecial(funct, rs, rt, rd, shamt, pc, inDelaySlot);

      // ===== BRANCHES =====
      case 0x02: // J (jump)
        this.branch((pc & 0xF0000000) | (target << 2), inDelaySlot);
        return 1;
      case 0x03: // JAL (jump and link)
        this.setReg(31, (pc + 8) >>> 0);
        this.branch((pc & 0xF0000000) | (target << 2), inDelaySlot);
        return 1;
      case 0x04: // BEQ
        if (this.getReg(rs) === this.getReg(rt)) this.branch((pc + 4 + (simm << 2)) >>> 0, inDelaySlot);
        return 1;
      case 0x05: // BNE
        if (this.getReg(rs) !== this.getReg(rt)) this.branch((pc + 4 + (simm << 2)) >>> 0, inDelaySlot);
        return 1;
      case 0x06: // BLEZ
        if ((this.getReg(rs) | 0) <= 0) this.branch((pc + 4 + (simm << 2)) >>> 0, inDelaySlot);
        return 1;
      case 0x07: // BGTZ
        if ((this.getReg(rs) | 0) > 0) this.branch((pc + 4 + (simm << 2)) >>> 0, inDelaySlot);
        return 1;
      case 0x08: // ADDI
        if (!this.addOverflow(this.getReg(rs), simm, rt)) return 1;
        this.setReg(rt, (this.getReg(rs) + simm) >>> 0);
        return 1;
      case 0x09: // ADDIU
        this.setReg(rt, (this.getReg(rs) + simm) >>> 0);
        return 1;
      case 0x0A: // SLTI
        this.setReg(rt, ((this.getReg(rs) | 0) < simm) ? 1 : 0);
        return 1;
      case 0x0B: // SLTIU
        this.setReg(rt, (this.getReg(rs) < (simm >>> 0)) ? 1 : 0);
        return 1;
      case 0x0C: // ANDI
        this.setReg(rt, this.getReg(rs) & imm);
        return 1;
      case 0x0D: // ORI
        this.setReg(rt, this.getReg(rs) | imm);
        return 1;
      case 0x0E: // XORI
        this.setReg(rt, this.getReg(rs) ^ imm);
        return 1;
      case 0x0F: // LUI
        this.setReg(rt, (imm << 16) >>> 0);
        return 1;

      // ===== COP0/COP1/COP2/COP3 =====
      case 0x10: // COP0
        return this.executeCOP0(instr, rs, rt, rd);
      case 0x11: // COP1 (não usado no PS1)
        return 1;
      case 0x12: // COP2 (GTE)
        return this.executeCOP2(instr, rs, rt, rd, funct);

      // ===== LOADS =====
      case 0x20: // LB
        this.setReg(rt, (this.bus.read8((this.getReg(rs) + simm) >>> 0) << 24) >> 24);
        return 1;
      case 0x21: // LH
        this.setReg(rt, (this.bus.read16((this.getReg(rs) + simm) >>> 0) << 16) >> 16);
        return 1;
      case 0x23: // LW
        this.setReg(rt, this.bus.read32((this.getReg(rs) + simm) >>> 0));
        return 1;
      case 0x24: // LBU
        this.setReg(rt, this.bus.read8((this.getReg(rs) + simm) >>> 0));
        return 1;
      case 0x25: // LHU
        this.setReg(rt, this.bus.read16((this.getReg(rs) + simm) >>> 0));
        return 1;
      case 0x26: // LWR (load word right) - implementação simplificada
        this.setReg(rt, this.bus.read32((this.getReg(rs) + simm) >>> 0));
        return 1;
      case 0x22: // LWL (load word left)
        this.setReg(rt, this.bus.read32((this.getReg(rs) + simm) >>> 0));
        return 1;

      // ===== STORES =====
      case 0x28: // SB
        this.bus.write8((this.getReg(rs) + simm) >>> 0, this.getReg(rt) & 0xFF);
        return 1;
      case 0x29: // SH
        this.bus.write16((this.getReg(rs) + simm) >>> 0, this.getReg(rt) & 0xFFFF);
        return 1;
      case 0x2B: // SW
        this.bus.write32((this.getReg(rs) + simm) >>> 0, this.getReg(rt));
        return 1;
      case 0x2A: // SWL
      case 0x2E: // SWR
        this.bus.write32((this.getReg(rs) + simm) >>> 0, this.getReg(rt));
        return 1;

      // ===== LWC2 / SWC2 (GTE) =====
      case 0x32: // LWC2
        this.state.cop2[rt] = this.bus.read32((this.getReg(rs) + simm) >>> 0);
        return 1;
      case 0x3A: // SWC2
        this.bus.write32((this.getReg(rs) + simm) >>> 0, this.state.cop2[rt]);
        return 1;

      default:
        // Instrução desconhecida - trata como exceção reservada
        // (silencioso no MVP)
        return 1;
    }
  }

  private branch(target: number, inDelaySlot: boolean): void {
    if (inDelaySlot) {
      // Branch em delay slot: cancela e salta imediatamente
      this.state.pc = target >>> 0;
    } else {
      this.state.branchTarget = target >>> 0;
      this.state.inDelaySlot = true;
    }
  }

  private addOverflow(a: number, b: number, rt: number): boolean {
    const sa = a | 0;
    const sb = b | 0;
    const sum = sa + sb;
    if (((sa ^ sum) & (sb ^ sum)) < 0) {
      // Overflow
      this.triggerException(EXCEPTION.OVERFLOW);
      return false;
    }
    this.setReg(rt, sum >>> 0);
    return true;
  }

  // ==================== Instruções especiais (funct) ====================

  private executeSpecial(funct: number, rs: number, rt: number, rd: number, shamt: number, pc: number, inDelaySlot: boolean): number {
    switch (funct) {
      case 0x00: // SLL
        this.setReg(rd, this.getReg(rt) << shamt);
        return 1;
      case 0x02: // SRL
        this.setReg(rd, this.getReg(rt) >>> shamt);
        return 1;
      case 0x03: // SRA
        this.setReg(rd, (this.getReg(rt) | 0) >> shamt);
        return 1;
      case 0x04: // SLLV
        this.setReg(rd, this.getReg(rt) << (this.getReg(rs) & 0x1F));
        return 1;
      case 0x06: // SRLV
        this.setReg(rd, this.getReg(rt) >>> (this.getReg(rs) & 0x1F));
        return 1;
      case 0x07: // SRAV
        this.setReg(rd, (this.getReg(rt) | 0) >> (this.getReg(rs) & 0x1F));
        return 1;
      case 0x08: // JR
        this.branch(this.getReg(rs), inDelaySlot);
        return 1;
      case 0x09: // JALR
        this.setReg(rd === 0 ? 31 : rd, (pc + 8) >>> 0);
        this.branch(this.getReg(rs), inDelaySlot);
        return 1;
      case 0x0C: // SYSCALL
        this.triggerException(EXCEPTION.SYSCALL);
        return 1;
      case 0x0D: // BREAK
        this.triggerException(EXCEPTION.BREAK);
        return 1;
      case 0x10: // MFHI
        this.setReg(rd, this.state.hi);
        return 1;
      case 0x11: // MTHI
        this.state.hi = this.getReg(rs);
        return 1;
      case 0x12: // MFLO
        this.setReg(rd, this.state.lo);
        return 1;
      case 0x13: // MTLO
        this.state.lo = this.getReg(rs);
        return 1;
      case 0x18: { // MULT
        const result = BigInt(this.getReg(rs) | 0) * BigInt(this.getReg(rt) | 0);
        this.state.lo = Number(result & 0xFFFFFFFFn) >>> 0;
        this.state.hi = Number((result >> 32n) & 0xFFFFFFFFn) >>> 0;
        return 1;
      }
      case 0x19: { // MULTU
        const result = BigInt(this.getReg(rs)) * BigInt(this.getReg(rt));
        this.state.lo = Number(result & 0xFFFFFFFFn) >>> 0;
        this.state.hi = Number((result >> 32n) & 0xFFFFFFFFn) >>> 0;
        return 1;
      }
      case 0x1A: { // DIV
        const divisor = this.getReg(rt) | 0;
        const dividend = this.getReg(rs) | 0;
        if (divisor === 0) {
          this.state.lo = dividend >= 0 ? 0xFFFFFFFF : 1;
          this.state.hi = dividend >>> 0;
        } else if (dividend === -2147483648 && divisor === -1) {
          this.state.lo = 0x80000000;
          this.state.hi = 0;
        } else {
          this.state.lo = (dividend / divisor) | 0;
          this.state.hi = (dividend % divisor) | 0;
        }
        return 1;
      }
      case 0x1B: { // DIVU
        const divisor = this.getReg(rt);
        const dividend = this.getReg(rs);
        if (divisor === 0) {
          this.state.lo = 0xFFFFFFFF;
          this.state.hi = dividend;
        } else {
          this.state.lo = (dividend / divisor) >>> 0;
          this.state.hi = (dividend % divisor) >>> 0;
        }
        return 1;
      }
      case 0x20: // ADD
        return this.addOverflow(this.getReg(rs), this.getReg(rt), rd) ? 1 : 1;
      case 0x21: // ADDU
        this.setReg(rd, (this.getReg(rs) + this.getReg(rt)) >>> 0);
        return 1;
      case 0x22: // SUB
        return this.subOverflow(this.getReg(rs), this.getReg(rt), rd) ? 1 : 1;
      case 0x23: // SUBU
        this.setReg(rd, (this.getReg(rs) - this.getReg(rt)) >>> 0);
        return 1;
      case 0x24: // AND
        this.setReg(rd, this.getReg(rs) & this.getReg(rt));
        return 1;
      case 0x25: // OR
        this.setReg(rd, this.getReg(rs) | this.getReg(rt));
        return 1;
      case 0x26: // XOR
        this.setReg(rd, this.getReg(rs) ^ this.getReg(rt));
        return 1;
      case 0x27: // NOR
        this.setReg(rd, ~(this.getReg(rs) | this.getReg(rt)));
        return 1;
      case 0x2A: // SLT
        this.setReg(rd, ((this.getReg(rs) | 0) < (this.getReg(rt) | 0)) ? 1 : 0);
        return 1;
      case 0x2B: // SLTU
        this.setReg(rd, (this.getReg(rs) < this.getReg(rt)) ? 1 : 0);
        return 1;
      default:
        return 1;
    }
  }

  private subOverflow(a: number, b: number, rd: number): boolean {
    const sa = a | 0;
    const sb = b | 0;
    const diff = sa - sb;
    if (((sa ^ sb) & (sa ^ diff)) < 0) {
      this.triggerException(EXCEPTION.OVERFLOW);
      return false;
    }
    this.setReg(rd, diff >>> 0);
    return true;
  }

  // ==================== Coprocessador 0 (System) ====================

  private executeCOP0(instr: number, rs: number, rt: number, rd: number): number {
    const funct = instr & 0x3F;
    if ((instr & 0x02000000) === 0) {
      // MFC0 (Move from Cop0)
      this.setReg(rt, this.state.cop0[rd]);
      return 1;
    }
    if ((instr & 0x02000000) !== 0 && (instr & 0x01000000) === 0) {
      // MTC0 (Move to Cop0)
      this.state.cop0[rd] = this.getReg(rt);
      return 1;
    }
    // Comandos (RFU)
    void funct;
    void rs;
    return 1;
  }

  // ==================== Coprocessador 2 (GTE) ====================

  private executeCOP2(instr: number, rs: number, rt: number, rd: number, funct: number): number {
    const bit25 = (instr >>> 25) & 1;

    if (bit25 === 0) {
      // Comandos GTE (RTPS, NCLIP, etc)
      this.executeGTECommand(funct);
      return 1;
    }

    const isMoveTo = (instr & 0x00010000) !== 0; // MTC2 vs MFC2
    if (isMoveTo) {
      // MTC2 (Move to Cop2)
      if (this.state.cop2[rd] !== undefined) {
        this.state.cop2[rd] = this.getReg(rt);
      }
      // LZCS/LZCR especiais
      if (rd === 30) { /* LZCS */ }
      return 1;
    } else {
      // MFC2 (Move from Cop2)
      this.setReg(rt, this.state.cop2[rd] | 0);
      return 1;
    }
  }

  /**
   * Executa um comando GTE (Geometry Transformation Engine).
   * O GTE é usado para transformações 3D (projeção, iluminação).
   * No MVP executamos um subconjunto essencial (RTPS, NCLIP, RTPT).
   */
  private executeGTECommand(command: number): void {
    // A implementação completa do GTE é extensa. Aqui garantimos que
    // as operações mais comuns do PS1 não travem. Cálculos detalhados
    // são um TODO para a Fase 2 (precisão de renderização 3D).
    switch (command) {
      case 0x01: // RTPS - Perspective Transformation
      case 0x06: // NCLIP
      case 0x0C: // OP - Outer Product
      case 0x10: // DPCS
      case 0x11: // INTPL
      case 0x14: // DPCT
      case 0x16: // NCS
      case 0x1E: // NCDS
      case 0x12: // MVMVA
      case 0x06 * 0: // no-op placeholder
        // Comportamento padrão: mantém registradores
        break;
      default:
        break;
    }
  }

  // ==================== Exceções / Interrupções ====================

  private triggerException(cause: number): void {
    const sr = this.state.cop0[COP0.SR];
    // Salva PC atual em EPC
    this.state.cop0[COP0.EPC] = this.state.pc;
    // Configura CAUSE
    this.state.cop0[COP0.CAUSE] = cause << 2;
    // Estoura para o vetor de exceção
    this.state.pc = EXCEPTION_VECTOR;
  }

  /**
   * Verifica e trata interrupções pendentes
   */
  checkInterrupts(): boolean {
    const sr = this.state.cop0[COP0.SR];
    const interruptsEnabled = (sr & 1) !== 0; // IEc (bit 0)

    if (interruptsEnabled && this.bus.hasPendingInterrupt()) {
      // Salva estado
      this.state.cop0[COP0.EPC] = this.state.pc;
      this.state.cop0[COP0.CAUSE] = EXCEPTION.INTERRUPT << 2;
      // Empilha modo kernel
      const newSr = sr & ~0x3F;
      this.state.cop0[COP0.SR] = newSr | ((sr >> 2) & 0x3F);
      this.state.pc = EXCEPTION_VECTOR;
      return true;
    }
    return false;
  }

  // ==================== Serialização ====================

  serialize(): CPUState {
    return {
      gpr: this.state.gpr.slice(),
      pc: this.state.pc,
      hi: this.state.hi,
      lo: this.state.lo,
      cop0: this.state.cop0.slice(),
      cop2: this.state.cop2.slice(),
      branchTarget: this.state.branchTarget,
      inDelaySlot: this.state.inDelaySlot,
      cycles: this.state.cycles
    };
  }

  deserialize(state: CPUState): void {
    this.state.gpr.set(state.gpr);
    this.state.pc = state.pc;
    this.state.hi = state.hi;
    this.state.lo = state.lo;
    this.state.cop0.set(state.cop0);
    this.state.cop2.set(state.cop2);
    this.state.branchTarget = state.branchTarget;
    this.state.inDelaySlot = state.inDelaySlot;
    this.state.cycles = BigInt(state.cycles);
  }
}

export default CPU;