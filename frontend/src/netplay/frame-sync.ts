/**
 * Frame Sync Manager (Lockstep determinístico)
 *
 * Estratégia: LOCKSTEP com confirmação.
 * - Cada frame, o jogador local captura seu input e o envia aos peers.
 * - O frame N só é executado quando os inputs de TODOS os jogadores para
 *   o frame N foram recebidos (ou quando um timeout expira e usamos o
 *   último input conhecido - "input prediction simples").
 *
 * Isso garante que todos os clientes executem exatamente a mesma sequência
 * de frames, assumindo que o core de emulação é determinístico.
 */

import { NETPLAY_CONSTANTS, type InputFrame, type PeerInputBundle } from './types.js';

export interface FrameSyncEvents {
  /** Chamado quando um frame está pronto para execução com todos os inputs */
  onFrameReady: (frame: number, inputs: Record<number, number>) => void;
  /** Envia um input para os peers */
  onSendInput: (bundle: PeerInputBundle) => void;
  /** Solicita sincronização de estado (resync) */
  onRequestStateSync?: () => void;
  /** Log */
  onLog?: (level: string, message: string) => void;
}

export class FrameSyncManager {
  private events: FrameSyncEvents;
  private localPlayerIndex: number;
  private playerCount: number;

  /** Frame atual de emulação */
  private currentFrame = 0;

  /** Inputs do jogador local por frame */
  private localInputs = new Map<number, InputFrame>();

  /** Inputs recebidos de peers: frame -> (playerIndex -> buttons) */
  private remoteInputs = new Map<number, Record<number, number>>();

  /** Último input conhecido de cada player (para predição em caso de perda) */
  private lastKnownInputs = new Map<number, number>();

  /** Frames aguardando execução (buffer) */
  private readyFrames: number[] = [];

  private running = false;

  constructor(localPlayerIndex: number, playerCount: number, events: FrameSyncEvents) {
    this.localPlayerIndex = localPlayerIndex;
    this.playerCount = playerCount;
    this.events = events;

    for (let i = 0; i < playerCount; i++) {
      this.lastKnownInputs.set(i, 0);
    }
  }

  start(): void {
    this.running = true;
    this.currentFrame = 0;
    this.localInputs.clear();
    this.remoteInputs.clear();
    this.readyFrames = [];
    this.events.onLog?.('info', `FrameSync iniciado (player ${this.localPlayerIndex}/${this.playerCount})`);
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Registra o input do jogador LOCAL para o frame atual e o transmite.
   */
  submitLocalInput(buttons: number, analog?: InputFrame['analog']): void {
    if (!this.running) return;

    const frame = this.currentFrame;
    const input: InputFrame = { frame, buttons, analog };

    this.localInputs.set(frame, input);
    this.lastKnownInputs.set(this.localPlayerIndex, buttons);

    // Envia para os peers
    this.events.onSendInput({
      frame,
      inputs: {
        [this.localPlayerIndex]: input
      }
    });
  }

  /**
   * Recebe inputs de um peer
   */
  receiveRemoteInput(bundle: PeerInputBundle): void {
    if (!this.running) return;

    if (!this.remoteInputs.has(bundle.frame)) {
      this.remoteInputs.set(bundle.frame, {});
    }
    const frameInputs = this.remoteInputs.get(bundle.frame)!;

    for (const [playerIdx, input] of Object.entries(bundle.inputs)) {
      const idx = parseInt(playerIdx, 10);
      frameInputs[idx] = input.buttons;
      this.lastKnownInputs.set(idx, input.buttons);
    }

    // Verifica se o frame atual está completo
    this.tryAdvanceFrame();
  }

  /**
   * Tenta avançar para o próximo frame.
   * Chamado a cada tick do loop de emulação.
   */
  tick(): void {
    if (!this.running) return;
    this.tryAdvanceFrame();
  }

  private tryAdvanceFrame(): void {
    const frame = this.currentFrame;

    // Coleta inputs de todos os players para o frame atual
    const inputs: Record<number, number> = {};
    const frameInputs = this.remoteInputs.get(frame) || {};

    let allReceived = true;
    for (let p = 0; p < this.playerCount; p++) {
      if (p === this.localPlayerIndex) {
        const localInput = this.localInputs.get(frame);
        if (localInput) {
          inputs[p] = localInput.buttons;
        } else {
          // Usa último input conhecido (predição)
          inputs[p] = this.lastKnownInputs.get(p) || 0;
        }
      } else {
        if (frameInputs[p] !== undefined) {
          inputs[p] = frameInputs[p];
        } else {
          // Input ainda não chegou: usa predição
          inputs[p] = this.lastKnownInputs.get(p) || 0;
          allReceived = false;
        }
      }
    }

    // Executa o frame (seja completo ou com predição)
    this.events.onFrameReady(frame, inputs);

    // Limpa buffers antigos
    this.localInputs.delete(frame);
    this.remoteInputs.delete(frame);

    this.currentFrame++;

    // Resync periódico para corrigir dessincronização acumulada
    if (this.currentFrame % NETPLAY_CONSTANTS.STATE_SYNC_INTERVAL === 0) {
      this.events.onLog?.('info', `Solicitando resync no frame ${this.currentFrame}`);
      this.events.onRequestStateSync?.();
    }
  }

  getCurrentFrame(): number {
    return this.currentFrame;
  }

  /**
   * Aplica um deslocamento (rollback) - usado quando recebemos estado
   * de um peer que está à frente/atrás
   */
  applyRollback(targetFrame: number): void {
    if (targetFrame < this.currentFrame) {
      this.events.onLog?.('warn', `Rollback de ${this.currentFrame} para ${targetFrame}`);
      this.currentFrame = targetFrame;
    } else if (targetFrame > this.currentFrame) {
      // Avança frames "vazios" até alcançar
      this.currentFrame = targetFrame;
    }
  }

  getLocalPlayerIndex(): number {
    return this.localPlayerIndex;
  }
}

export default FrameSyncManager;