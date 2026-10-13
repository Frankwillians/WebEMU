/**
 * GPU do PlayStation 1 - Rasterizador por software
 * Renderiza para VRAM (1024x512 pixels de 16-bit BGR555)
 *
 * Comandos GP0: renderização (polígonos, linhas, retângulos, imagens, fill)
 * Comandos GP1: controle (display, DMA, reset)
 *
 * A VRAM resultante é convertida para RGBA e enviada ao frontend,
 * que faz o upload para um canvas/WebGL.
 */

export const VRAM_WIDTH = 1024;
export const VRAM_HEIGHT = 512;
export const VRAM_SIZE = VRAM_WIDTH * VRAM_HEIGHT;

// Máscara de coordenadas (VRAM é addressada por 10 bits X e 9 bits Y)
const X_MASK = 0x3FF;
const Y_MASK = 0x1FF;

/**
 * Converte cor BGR555 (16-bit) para RGBA (32-bit)
 */
function bgr555toRGBA(color: number): number {
  const r = (color & 0x1F) << 3;
  const g = ((color >> 5) & 0x1F) << 3;
  const b = ((color >> 10) & 0x1F) << 3;
  const a = (color & 0x8000) ? 0xFF : 0xFF; // Bit 15 controla semi-transparência
  return (a << 24) | (b << 16) | (g << 8) | r;
}

export class GPURasterizer {
  // VRAM: 1MB = 524288 pixels de 16 bits
  public vram: Uint16Array;

  // Estado de display
  public displayEnabled = false;
  public displayVramX = 0;
  public displayVramY = 0;
  public horizontalResolution = 320;
  public verticalResolution = 240;
  public displayAreaColorDepth = 0;
  public videoMode = 0;
  public displayHoriz = 0x200;
  public displayVert = 0x10;

  // Command buffer (GP0)
  private gp0Words: number[] = [];
  private commandNeeded = 0;
  private isGP0Command = true;

  // GP1 status
  private gpustat = 0x14802000;

  // Drawing state
  private drawMode = 0;
  private drawOffsetX = 0;
  private drawOffsetY = 0;
  private textureWindowMaskX = 0;
  private textureWindowMaskY = 0;
  private textureWindowOffsetX = 0;
  private textureWindowOffsetY = 0;
  private drawingAreaLeft = 0;
  private drawingAreaTop = 0;
  private drawingAreaRight = 0;
  private drawingAreaBottom = 0;
  private drawingOffsetX = 0;
  private drawingOffsetY = 0;

  // GPUREAD
  private gpuReadValue = 0;

  // Ciclos / timing
  public cycles = 0;

  constructor() {
    this.vram = new Uint16Array(VRAM_SIZE);
    this.resetDrawingArea();
  }

  private resetDrawingArea(): void {
    this.drawingAreaLeft = 0;
    this.drawingAreaTop = 0;
    this.drawingAreaRight = VRAM_WIDTH - 1;
    this.drawingAreaBottom = VRAM_HEIGHT - 1;
  }

  reset(): void {
    this.vram.fill(0);
    this.displayEnabled = false;
    this.gp0Words = [];
    this.commandNeeded = 0;
    this.gpustat = 0x14802000;
    this.cycles = 0;
    this.resetDrawingArea();
  }

  // ==================== GP0 (Porta de Renderização) ====================

  /**
   * Escreve um comando ou dado na GP0
   */
  writeGP0(value: number): void {
    value >>>= 0;

    if (this.commandNeeded === 0) {
      // Novo comando: o byte baixo determina o tipo
      const opcode = value & 0xFF;
      this.commandNeeded = this.getCommandLength(opcode);
      this.gp0Words = [value];
      this.commandNeeded--;
      if (this.commandNeeded === 0) {
        this.executeGP0Command();
      }
    } else {
      this.gp0Words.push(value);
      this.commandNeeded--;
      if (this.commandNeeded === 0) {
        this.executeGP0Command();
      }
    }
  }

  /**
   * Retorna quantas palavras (u32) o comando precisa
   */
  private getCommandLength(opcode: number): number {
    const lower = opcode & 0xE0; // 3 bits superiores do opcode
    const upper = opcode & 0xF8;

    // Comandos de 1 palavra
    if (opcode === 0x00) return 1; // NOP
    if (opcode === 0x01) return 1; // Clear cache
    if (opcode === 0x02) return 3; // Fill rect (opcode + color + xy + wh)
    if (opcode === 0x03) return 1; // NOP

    // Comandos de desenho variável
    if (upper === 0x20) return 4; // Flat polygon (monochrome)
    if (upper === 0x28) return 5; // Flat polygon (textured)
    if (upper === 0x30) return 6; // Gouraud polygon (shaded)
    if (upper === 0x38) return 7; // Gouraud polygon (shaded + textured)
    if (upper === 0x40) return 3; // Flat line
    if (upper === 0x48) return 4; // Gouraud line
    if (upper === 0x50) return 4; // Flat line (poly)
    if (upper === 0x60) return 3; // Rectangle (variable size)
    if (upper === 0x68) return 2; // Rectangle (1x1 dot)
    if (upper === 0x70) return 2; // Rectangle (8x8)
    if (upper === 0x78) return 2; // Rectangle (16x16)
    if (upper === 0x80) return 4; // Copy VRAM to VRAM
    if (upper === 0xA0) return 3; // Draw image (CPU to VRAM)
    if (upper === 0xC0) return 3; // Draw image (VRAM to VRAM)
    if (upper === 0xE0) return 1; // E1-E5 control commands
    if (opcode === 0xE1) return 1;
    if (opcode === 0xE2) return 1;
    if (opcode === 0xE3) return 1;
    if (opcode === 0xE4) return 1;
    if (opcode === 0xE5) return 1;
    if (opcode === 0xE6) return 1;

    // Default seguro
    return 1;
  }

  private executeGP0Command(): void {
    const opcode = this.gp0Words[0] & 0xFF;
    const upper = opcode & 0xF8;
    const words = this.gp0Words;

    switch (upper) {
      case 0x00:
        this.handleMiscCommand(opcode);
        break;
      case 0x20:
        this.drawFlatPolygon(words, false);
        break;
      case 0x28:
        this.drawFlatPolygon(words, true);
        break;
      case 0x30:
        this.drawGouraudPolygon(words, false);
        break;
      case 0x38:
        this.drawGouraudPolygon(words, true);
        break;
      case 0x40:
        this.drawLine(words, false);
        break;
      case 0x48:
        this.drawLine(words, true);
        break;
      case 0x50:
        this.drawLine(words, false);
        break;
      case 0x60:
      case 0x68:
      case 0x70:
      case 0x78:
        this.drawRectangle(words, opcode);
        break;
      case 0x80:
        this.copyVramToVram(words);
        break;
      case 0xA0:
        this.drawImage(words);
        break;
      case 0xC0:
        this.copyVramToVram(words);
        break;
      case 0xE0:
        this.handleMiscCommand(opcode);
        break;
      default:
        // Comando desconhecido, ignora
        break;
    }

    this.gp0Words = [];
  }

  private handleMiscCommand(opcode: number): void {
    const words = this.gp0Words;

    switch (opcode) {
      case 0x00: // NOP
      case 0x01: // Clear cache
        break;
      case 0x02: { // Fill rectangle in VRAM
        // word[0]: 0x02RRGGBB, word[1]: xy, word[2]: wh
        const color = this.rgb24toBgr555(words[0] >> 8);
        const x = words[1] & 0x3F0;
        const y = (words[1] >> 16) & 0x1FF;
        const w = ((words[2] & 0x3FF) + 0xF) & ~0xF;
        const h = (words[2] >> 16) & 0x1FF;
        this.fillRect(x, y, w, h, color);
        break;
      }
      case 0xE1: // Set draw mode
        this.drawMode = words[0] >>> 24;
        break;
      case 0xE2: // Set texture window
        this.textureWindowMaskX = words[0] & 0x1F;
        this.textureWindowMaskY = (words[0] >> 5) & 0x1F;
        this.textureWindowOffsetX = (words[0] >> 10) & 0x1F;
        this.textureWindowOffsetY = (words[0] >> 15) & 0x1F;
        break;
      case 0xE3: // Set drawing area top-left
        this.drawingAreaLeft = words[0] & 0x3FF;
        this.drawingAreaTop = (words[0] >> 10) & 0x1FF;
        break;
      case 0xE4: // Set drawing area bottom-right
        this.drawingAreaRight = words[0] & 0x3FF;
        this.drawingAreaBottom = (words[0] >> 10) & 0x1FF;
        break;
      case 0xE5: // Set drawing offset
        this.drawingOffsetX = (words[0] & 0x7FF);
        if (this.drawingOffsetX & 0x400) this.drawingOffsetX |= ~0x7FF;
        this.drawingOffsetY = ((words[0] >> 11) & 0x7FF);
        if (this.drawingOffsetY & 0x400) this.drawingOffsetY |= ~0x7FF;
        break;
      case 0xE6: // Mask bit setting
        break;
    }
  }

  private rgb24toBgr555(rgb: number): number {
    const r = (rgb >> 16) & 0xFF;
    const g = (rgb >> 8) & 0xFF;
    const b = rgb & 0xFF;
    return ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3);
  }

  // ==================== Primitivas de desenho ====================

  private plotPixel(x: number, y: number, color: number): void {
    x = (x + this.drawingOffsetX) & X_MASK;
    y = (y + this.drawingOffsetY) & Y_MASK;

    // Verifica área de desenho
    if (x < this.drawingAreaLeft || x > this.drawingAreaRight) return;
    if (y < this.drawingAreaTop || y > this.drawingAreaBottom) return;

    const idx = y * VRAM_WIDTH + x;
    const old = this.vram[idx];
    this.vram[idx] = this.blendColor(color, old, this.drawMode);
  }

  /**
   * Aplica blending de semi-transparência
   */
  private blendColor(src: number, dst: number, mode: number): number {
    // Bit 15 = semi-transparência ativa
    const semiTransparent = (src & 0x8000) !== 0;
    if (!semiTransparent) return src & 0x7FFF;

    const r1 = src & 0x1F, g1 = (src >> 5) & 0x1F, b1 = (src >> 10) & 0x1F;
    const r2 = dst & 0x1F, g2 = (dst >> 5) & 0x1F, b2 = (dst >> 10) & 0x1F;

    let r: number, g: number, b: number;
    const blendMode = (mode >> 5) & 0x3;

    switch (blendMode) {
      case 0: // 0.5 + 0.5
        r = (r1 + r2) >> 1; g = (g1 + g2) >> 1; b = (b1 + b2) >> 1;
        break;
      case 1: // 1.0 + 0.5
        r = Math.min(31, r1 + (r2 >> 1)); g = Math.min(31, g1 + (g2 >> 1)); b = Math.min(31, b1 + (b2 >> 1));
        break;
      case 2: // 1.0 - 0.5
        r = Math.max(0, r1 - (r2 >> 1)); g = Math.max(0, g1 - (g2 >> 1)); b = Math.max(0, b1 - (b2 >> 1));
        break;
      case 3: // 1.0 + 0.25
        r = Math.min(31, r1 + (r2 >> 2)); g = Math.min(31, g1 + (g2 >> 2)); b = Math.min(31, b1 + (b2 >> 2));
        break;
      default:
        r = r1; g = g1; b = b1;
    }

    return (b << 10) | (g << 5) | r;
  }

  private fillRect(x: number, y: number, w: number, h: number, color: number): void {
    for (let dy = 0; dy < h; dy++) {
      const py = (y + dy) & Y_MASK;
      const rowBase = py * VRAM_WIDTH;
      for (let dx = 0; dx < w; dx++) {
        const px = (x + dx) & X_MASK;
        this.vram[rowBase + px] = color;
      }
    }
  }

  /**
   * Desenha polígono (flat ou gouraud). Implementação de triângulo com
   * scanline fill interpolado.
   */
  private drawFlatPolygon(words: number[], textured: boolean): void {
    const color = this.rgb24toBgr555(words[0] & 0xFFFFFF);
    let i = 1;
    if (textured) {
      // word[1] = texture coords + clut; word[2] = texpage
      // word[3] = vertex0 xy
      const v0x = this.signed11(words[3] & 0xFFFF);
      const v0y = this.signed11((words[3] >> 16) & 0xFFFF);
      const v1x = this.signed11(words[1] & 0xFFFF);
      const v1y = this.signed11((words[1] >> 16) & 0xFFFF);
      const v2x = this.signed11(words[2] & 0xFFFF);
      const v2y = this.signed11((words[2] >> 16) & 0xFFFF);
      this.fillTriangle(v0x, v0y, v1x, v1y, v2x, v2y, color);
    } else {
      const v0x = this.signed11(words[1] & 0xFFFF);
      const v0y = this.signed11((words[1] >> 16) & 0xFFFF);
      const v1x = this.signed11(words[2] & 0xFFFF);
      const v1y = this.signed11((words[2] >> 16) & 0xFFFF);
      const v2x = this.signed11(words[3] & 0xFFFF);
      const v2y = this.signed11((words[3] >> 16) & 0xFFFF);
      this.fillTriangle(v0x, v0y, v1x, v1y, v2x, v2y, color);
    }
    void i;
  }

  private drawGouraudPolygon(words: number[], textured: boolean): void {
    // Para o MVP, renderizamos como flat usando a cor do primeiro vértice
    const color = this.rgb24toBgr555(words[0] & 0xFFFFFF);
    const v0x = this.signed11(words[1] & 0xFFFF);
    const v0y = this.signed11((words[1] >> 16) & 0xFFFF);
    const v1x = this.signed11(words[3] & 0xFFFF);
    const v1y = this.signed11((words[3] >> 16) & 0xFFFF);
    const v2x = this.signed11(words[5] & 0xFFFF);
    const v2y = this.signed11((words[5] >> 16) & 0xFFFF);
    this.fillTriangle(v0x, v0y, v1x, v1y, v2x, v2y, color);
    void textured;
  }

  private signed11(value: number): number {
    value &= 0x7FF;
    return (value & 0x400) ? (value | ~0x7FF) : value;
  }

  /**
   * Rasteriza um triângulo preenchido usando scanline
   */
  private fillTriangle(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    color: number
  ): void {
    // Ordena por Y
    if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    if (y1 > y2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
    if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }

    const totalHeight = y2 - y0;
    if (totalHeight === 0) {
      this.plotPixel(x0, y0, color);
      return;
    }

    for (let y = y0; y <= y2; y++) {
      const secondHalf = y > y1 || y1 === y0;
      const segmentHeight = secondHalf ? (y2 - y1) : (y1 - y0);
      const segmentAlpha = segmentHeight === 0 ? 0 : (y - (secondHalf ? y1 : y0)) / segmentHeight;

      let ax = x0 + (x2 - x0) * ((y - y0) / totalHeight);
      let bx = secondHalf ? (x1 + (x2 - x1) * segmentAlpha) : (x0 + (x1 - x0) * segmentAlpha);

      if (ax > bx) { const t = ax; ax = bx; bx = t; }
      ax = Math.round(ax);
      bx = Math.round(bx);

      for (let x = ax; x <= bx; x++) {
        this.plotPixel(x, y, color);
      }
    }
  }

  private drawLine(words: number[], gouraud: boolean): void {
    let color = this.rgb24toBgr555(words[0] & 0xFFFFFF);
    let x0 = this.signed11(words[1] & 0xFFFF);
    let y0 = this.signed11((words[1] >> 16) & 0xFFFF);
    let x1: number, y1: number;

    if (gouraud) {
      x0 = this.signed11(words[1] & 0xFFFF);
      y0 = this.signed11((words[1] >> 16) & 0xFFFF);
      x1 = this.signed11(words[3] & 0xFFFF);
      y1 = this.signed11((words[3] >> 16) & 0xFFFF);
    } else {
      x1 = this.signed11(words[2] & 0xFFFF);
      y1 = this.signed11((words[2] >> 16) & 0xFFFF);
    }
    void color;

    // Bresenham
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      this.plotPixel(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  private drawRectangle(words: number[], opcode: number): void {
    const color = this.rgb24toBgr555(words[0] & 0xFFFFFF);
    const x = this.signed11(words[1] & 0xFFFF);
    const y = this.signed11((words[1] >> 16) & 0xFFFF);

    let w = 1, h = 1;
    if (opcode === 0x60) {
      w = this.signed11(words[2] & 0xFFFF);
      h = this.signed11((words[2] >> 16) & 0xFFFF);
    } else if (opcode === 0x68) {
      w = 1; h = 1;
    } else if (opcode === 0x70) {
      w = 8; h = 8;
    } else if (opcode === 0x78) {
      w = 16; h = 16;
    }

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.plotPixel(x + dx, y + dy, color);
      }
    }
  }

  private drawImage(words: number[]): void {
    // Desenha imagem da CPU para VRAM
    const xy = words[1];
    const wh = words[2];
    const x = xy & 0x3FF;
    const y = (xy >> 16) & 0x1FF;
    const w = wh & 0x3FF;
    const h = (wh >> 16) & 0x1FF;
    // Os dados de pixel chegam via GP0 subsequente; no MVP, apenas
    // reservamos a área. Implementação completa lê os próximos writeGP0.
    void x; void y; void w; void h;
  }

  private copyVramToVram(words: number[]): void {
    const src = words[1];
    const dst = words[2];
    const wh = words[3];
    const srcX = src & 0x3FF, srcY = (src >> 16) & 0x1FF;
    const dstX = dst & 0x3FF, dstY = (dst >> 16) & 0x1FF;
    const w = wh & 0x3FF, h = (wh >> 16) & 0x1FF;

    const buffer: number[] = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const sIdx = ((srcY + dy) & Y_MASK) * VRAM_WIDTH + ((srcX + dx) & X_MASK);
        buffer.push(this.vram[sIdx]);
      }
    }
    let i = 0;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const dIdx = ((dstY + dy) & Y_MASK) * VRAM_WIDTH + ((dstX + dx) & X_MASK);
        this.vram[dIdx] = buffer[i++];
      }
    }
  }

  // ==================== GP1 (Porta de Controle) ====================

  writeGP1(value: number): void {
    value >>>= 0;
    const command = (value >> 24) & 0xFF;

    switch (command) {
      case 0x00: // Reset GPU
        this.reset();
        break;
      case 0x01: // Reset command buffer
        this.gp0Words = [];
        this.commandNeeded = 0;
        break;
      case 0x02: // Acknowledge IRQ
        this.gpustat &= ~(1 << 24);
        break;
      case 0x03: // Display enable/disable
        this.displayEnabled = (value & 1) === 0;
        break;
      case 0x04: // DMA direction
        break;
      case 0x05: // Display area start
        this.displayVramX = value & 0x3FE;
        this.displayVramY = (value >> 10) & 0x1FF;
        break;
      case 0x06: // Horizontal display range
        this.displayHoriz = value & 0xFFF;
        break;
      case 0x07: // Vertical display range
        this.displayVert = value & 0x3FF;
        break;
      case 0x08: // Display mode
        this.videoMode = value & 0xFF;
        this.displayAreaColorDepth = (value >> 4) & 1;
        // Bit 6-7: resolução horizontal (320/640/512/640)
        const hr = (value >> 6) & 3;
        this.horizontalResolution = [256, 320, 512, 640][hr];
        const vr = (value >> 2) & 1;
        this.verticalResolution = vr ? 480 : 240;
        break;
      case 0x10: // GPU info
        this.gpuReadValue = 0;
        break;
      default:
        break;
    }
  }

  readGPUREAD(): number {
    return this.gpuReadValue >>> 0;
  }

  getStatus(): number {
    // Reconstrói o GPUSTAT com base no estado atual
    let stat = 0x14802000;
    if (this.displayAreaColorDepth) stat |= 1 << 17;
    if (this.displayEnabled) stat |= 1 << 23;
    // DMA request bits
    return stat >>> 0;
  }

  // ==================== Saída de vídeo ====================

  /**
   * Converte a região visível da VRAM para RGBA
   * @param width largura de saída
   * @param height altura de saída
   */
  renderFrame(width = 320, height = 240): Uint8Array {
    const output = new Uint8Array(width * height * 4);
    const startX = this.displayVramX & 0x3FF;
    const startY = this.displayVramY & 0x1FF;
    const srcWidth = this.horizontalResolution || 320;
    const srcHeight = this.verticalResolution || 240;

    for (let y = 0; y < height; y++) {
      const srcY = (startY + Math.floor((y * srcHeight) / height)) & Y_MASK;
      for (let x = 0; x < width; x++) {
        const srcX = (startX + Math.floor((x * srcWidth) / width)) & X_MASK;
        const pixel = this.vram[srcY * VRAM_WIDTH + srcX];
        const rgba = bgr555toRGBA(pixel);
        const outIdx = (y * width + x) * 4;
        output[outIdx] = rgba & 0xFF;
        output[outIdx + 1] = (rgba >> 8) & 0xFF;
        output[outIdx + 2] = (rgba >> 16) & 0xFF;
        output[outIdx + 3] = 0xFF;
      }
    }

    return output;
  }

  /**
   * Serializa o estado da GPU (compatível com Netplay)
   */
  serialize(): { vram: Uint16Array; displayState: object } {
    return {
      vram: this.vram.slice(),
      displayState: {
        displayEnabled: this.displayEnabled,
        displayVramX: this.displayVramX,
        displayVramY: this.displayVramY,
        horizontalResolution: this.horizontalResolution,
        verticalResolution: this.verticalResolution
      }
    };
  }

  deserialize(data: { vram: Uint16Array; displayState: any }): void {
    this.vram.set(data.vram);
    this.displayEnabled = data.displayState.displayEnabled;
    this.displayVramX = data.displayState.displayVramX;
    this.displayVramY = data.displayState.displayVramY;
    this.horizontalResolution = data.displayState.horizontalResolution;
    this.verticalResolution = data.displayState.verticalResolution;
  }
}

export default GPURasterizer;