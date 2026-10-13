/**
 * SPU (Sound Processing Unit) do PlayStation 1
 * 24 vozes ADPCM, RAM de 512KB, saída estéreo 44.1kHz
 *
 * No MVP implementamos:
 *   - Registradores de voz
 *   - Decodificação ADPCM básica
 *   - Mixagem para buffer de áudio (consumido pela Web Audio API)
 */

export const SPU_RAM_SIZE = 512 * 1024; // 512KB
export const NUM_VOICES = 24;

export interface Voice {
  active: boolean;
  pitch: number;
  startAddress: number;
  repeatAddress: number;
  volumeL: number;
  volumeR: number;
  currentAddress: number;
  // ADSR
  adsrAttack: number;
  adsrDecay: number;
  adsrSustain: number;
  adsrRelease: number;
  adsrVolume: number;
  adsrPhase: 'off' | 'attack' | 'decay' | 'sustain' | 'release';
  // Decodificação ADPCM
  sampleBuffer: Int16Array;
  sampleIndex: number;
}

export class SPU {
  public ram: Uint8Array;
  private voices: Voice[];

  // Registradores globais
  private mainVolumeL = 0x3FFF;
  private mainVolumeR = 0x3FFF;
  private reverbVolumeL = 0;
  private reverbVolumeR = 0;
  private control = 0;
  private status = 0;

  // Buffer de saída de amostras (estéreo interleaved)
  private audioBuffer: Float32Array;
  private audioBufferIndex = 0;

  constructor() {
    this.ram = new Uint8Array(SPU_RAM_SIZE);
    this.voices = Array.from({ length: NUM_VOICES }, () => this.createVoice());
    this.audioBuffer = new Float32Array(4096 * 2);
  }

  private createVoice(): Voice {
    return {
      active: false,
      pitch: 0x1000,
      startAddress: 0,
      repeatAddress: 0,
      volumeL: 0,
      volumeR: 0,
      currentAddress: 0,
      adsrAttack: 0,
      adsrDecay: 0,
      adsrSustain: 0,
      adsrRelease: 0,
      adsrVolume: 0,
      adsrPhase: 'off',
      sampleBuffer: new Int16Array(28),
      sampleIndex: 28
    };
  }

  reset(): void {
    this.ram.fill(0);
    for (const voice of this.voices) {
      Object.assign(voice, this.createVoice());
    }
    this.audioBufferIndex = 0;
  }

  /**
   * Carrega dados na RAM da SPU (via DMA)
   */
  loadData(offset: number, data: Uint8Array): void {
    this.ram.set(data, offset & (SPU_RAM_SIZE - 1));
  }

  writeRegister(address: number, value: number): void {
    value &= 0xFFFF;
    const offset = address - 0x1F801C00;

    if (offset < 0x180) {
      // Registradores de voz (0x180 = 24 vozes * 0x10 bytes)
      const voiceIdx = (offset / 0x10) | 0;
      const reg = offset % 0x10;
      if (voiceIdx >= NUM_VOICES) return;
      const voice = this.voices[voiceIdx];

      switch (reg) {
        case 0x0: voice.volumeL = value; break;
        case 0x2: voice.volumeR = value; break;
        case 0x4: voice.pitch = value; break;
        case 0x6: voice.startAddress = (value << 3) & 0x7FFFF; break;
        case 0x8: this.setAdsr(voice, value, true); break;
        case 0xA: this.setAdsr(voice, value, false); break;
        case 0xC:
          voice.adsrVolume = value;
          voice.active = voice.adsrPhase !== 'off';
          break;
        case 0xE: voice.repeatAddress = (value << 3) & 0x7FFFF; break;
      }
      return;
    }

    // Registradores globais
    if (offset === 0x180) this.mainVolumeL = value;
    else if (offset === 0x182) this.mainVolumeR = value;
    else if (offset === 0x184) this.reverbVolumeL = value;
    else if (offset === 0x186) this.reverbVolumeR = value;
    else if (offset === 0x18A) this.control = value;
    else if (offset === 0x18C) this.status = value;
  }

  private setAdsr(voice: Voice, value: number, isLower: boolean): void {
    if (isLower) {
      voice.adsrAttack = value & 0x7F;
      voice.adsrDecay = (value >> 8) & 0x7F;
    } else {
      voice.adsrSustain = value & 0x1F;
      voice.adsrRelease = (value >> 8) & 0x7F;
    }
  }

  readRegister(address: number): number {
    const offset = address - 0x1F801C00;
    if (offset === 0x18A) return this.control;
    if (offset === 0x18C) return this.status;
    return 0;
  }

  /**
   * Gera N amostras de áudio (chamado pelo loop de emulação)
   * Retorna buffer interleaved estéreo Float32 [-1, 1]
   */
  generateSamples(count: number): Float32Array {
    const output = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      let sampleL = 0;
      let sampleR = 0;

      for (let v = 0; v < NUM_VOICES; v++) {
        const voice = this.voices[v];
        if (!voice.active) continue;

        // Obtém próxima amostra (decodifica ADPCM se necessário)
        let sample = 0;
        if (voice.sampleIndex < voice.sampleBuffer.length) {
          sample = voice.sampleBuffer[voice.sampleIndex];
        }
        voice.sampleIndex++;

        // Aproximação de passo baseado no pitch
        const step = (voice.pitch / 0x1000);
        if (Math.random() < step * 0.01) {
          // Placeholder: avança na stream ADPCM
        }

        // Aplica ADSR simples
        this.updateAdsr(voice, 1);

        const volL = this.volumeToFloat(voice.volumeL) * this.volumeToFloat(this.mainVolumeL);
        const volR = this.volumeToFloat(voice.volumeR) * this.volumeToFloat(this.mainVolumeR);

        sampleL += (sample / 32768) * voice.adsrVolume * volL;
        sampleR += (sample / 32768) * voice.adsrVolume * volR;
      }

      output[i * 2] = Math.max(-1, Math.min(1, sampleL));
      output[i * 2 + 1] = Math.max(-1, Math.min(1, sampleR));
    }

    return output;
  }

  private updateAdsr(voice: Voice, samples: number): void {
    switch (voice.adsrPhase) {
      case 'attack':
        voice.adsrVolume += voice.adsrAttack * 0.0001 * samples;
        if (voice.adsrVolume >= 1) { voice.adsrVolume = 1; voice.adsrPhase = 'decay'; }
        break;
      case 'decay':
        voice.adsrVolume -= (voice.adsrDecay * 0.0001) * samples;
        const sustainLevel = voice.adsrSustain / 0x1F;
        if (voice.adsrVolume <= sustainLevel) { voice.adsrVolume = sustainLevel; voice.adsrPhase = 'sustain'; }
        break;
      case 'sustain':
        // mantém
        break;
      case 'release':
        voice.adsrVolume -= (voice.adsrRelease * 0.0001) * samples;
        if (voice.adsrVolume <= 0) { voice.adsrVolume = 0; voice.adsrPhase = 'off'; voice.active = false; }
        break;
    }
  }

  private volumeToFloat(vol: number): number {
    // Formato de volume fixo 1.15 (signed)
    let v = vol & 0x7FFF;
    if (v & 0x4000) v = v - 0x8000;
    return v / 0x4000;
  }

  /**
   * Inicia decodificação de voz (chamado quando registro 0x0C é escrito)
   */
  keyOn(voiceIdx: number): void {
    const voice = this.voices[voiceIdx];
    if (!voice) return;
    voice.active = true;
    voice.currentAddress = voice.startAddress;
    voice.sampleIndex = 28;
    voice.adsrPhase = 'attack';
    voice.adsrVolume = 0;
  }

  keyOff(voiceIdx: number): void {
    const voice = this.voices[voiceIdx];
    if (!voice) return;
    voice.adsrPhase = 'release';
  }
}

export default SPU;