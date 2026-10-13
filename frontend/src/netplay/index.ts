/**
 * Módulo de Netplay - Orquestra signaling, WebRTC e frame-sync
 *
 * Uso:
 *   const netplay = createNetplay({ signalingUrl, roomId, playerIndex });
 *   await netplay.connect();
 *   netplay.sendInput(buttons, analog);
 *   netplay.onFrameReady((frame, inputs) => { ... });
 */

import { SignalingClient } from './signaling-client.js';
import { WebRTCConnection } from './webrtc-connection.js';
import { FrameSyncManager } from './frame-sync.js';
import type { NetplayConfig, PeerInfo, PeerInputBundle } from './types.js';

// Formato de mensagem no DataChannel (binário compacto)
// [1 byte tipo][4 bytes frame][4 bytes playerIndex][4 bytes buttons] = 13 bytes
const MSG_INPUT = 0x01;
const MSG_STATE = 0x02;
const MSG_STATE_REQUEST = 0x03;
const MSG_PING = 0x04;
const MSG_PONG = 0x05;

export class Netplay {
  private config: NetplayConfig;
  private signaling: SignalingClient;
  private connections = new Map<string, WebRTCConnection>();
  private peers = new Map<string, PeerInfo>();
  private frameSync: FrameSyncManager | null = null;
  private localPlayerIndex: number;

  private connected = false;
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();

  constructor(config: NetplayConfig) {
    this.config = config;
    this.localPlayerIndex = config.playerIndex;

    this.signaling = new SignalingClient(config.signalingUrl, {
      onPeerList: (peers) => this.handlePeerList(peers),
      onPeerJoined: (peer) => this.handlePeerJoined(peer),
      onPeerLeft: (id) => this.handlePeerLeft(id),
      onOffer: (fromId, sdp) => this.handleOffer(fromId, sdp),
      onAnswer: (fromId, sdp) => this.handleAnswer(fromId, sdp),
      onIceCandidate: (fromId, candidate) => this.handleIceCandidate(fromId, candidate),
      onError: (msg) => this.config.onError?.(new Error(msg)),
      onLog: (level, msg) => this.config.onLog?.(level, msg),
      onClose: () => {
        this.connected = false;
        this.config.onLog?.('warn', 'Signaling desconectado');
      }
    });
  }

  /**
   * Conecta ao signaling server e entra na sala
   */
  async connect(): Promise<{ id: string; peers: PeerInfo[] }> {
    const result = await this.signaling.connect(
      this.config.roomId,
      this.config.playerIndex,
      this.config.metadata || {}
    );

    this.connected = true;
    this.config.onLog?.('info', `Conectado à sala ${this.config.roomId} como player ${this.config.playerIndex}`);

    // Inicializa frame-sync (assume 2 jogadores por padrão)
    this.frameSync = new FrameSyncManager(
      this.localPlayerIndex,
      this.config.playerCount || 2,
      {
        onFrameReady: (frame, inputs) => {
          this.config.onInput?.(frame, inputs);
        },
        onSendInput: (bundle) => this.broadcastInput(bundle),
        onRequestStateSync: () => this.requestStateSync(),
        onLog: (level, msg) => this.config.onLog?.(level, msg)
      }
    );
    this.frameSync.start();

    return { id: result.id, peers: Array.from(this.peers.values()) };
  }

  // ==================== Handlers de sinalização ====================

  private handlePeerList(peers: { id: string; playerIndex: number; metadata: any }[]): void {
    for (const peer of peers) {
      this.peers.set(peer.id, {
        id: peer.id,
        playerIndex: peer.playerIndex,
        metadata: peer.metadata,
        connected: false,
        latency: 0
      });
    }
    // O peer com menor playerIndex inicia as conexões (evita dupla oferta)
    const myIndex = this.localPlayerIndex;
    for (const peer of peers) {
      if (myIndex < peer.playerIndex) {
        this.initiateConnection(peer.id);
      }
    }
  }

  private handlePeerJoined(peer: { id: string; playerIndex: number; metadata: any }): void {
    this.config.onLog?.('info', `Peer entrou: ${peer.id} (player ${peer.playerIndex})`);
    this.peers.set(peer.id, {
      id: peer.id,
      playerIndex: peer.playerIndex,
      metadata: peer.metadata,
      connected: false,
      latency: 0
    });

    // Quem já estava na sala inicia a conexão
    if (this.localPlayerIndex < peer.playerIndex) {
      this.initiateConnection(peer.id);
    }
    this.config.onPeerJoin?.(peer.id);
  }

  private handlePeerLeft(id: string): void {
    this.connections.get(id)?.close();
    this.connections.delete(id);
    this.peers.delete(id);
    this.pendingCandidates.delete(id);
    this.config.onPeerLeave?.(id);
  }

  private async initiateConnection(peerId: string): Promise<void> {
    const conn = this.getOrCreateConnection(peerId);
    try {
      const offer = await conn.createOffer();
      this.signaling.sendOffer(peerId, offer);
    } catch (error: any) {
      this.config.onError?.(new Error(`Falha ao criar oferta: ${error.message}`));
    }
  }

  private async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const conn = this.getOrCreateConnection(fromId);
    try {
      const answer = await conn.acceptOffer(sdp);
      this.signaling.sendAnswer(fromId, answer);
      await this.flushPendingCandidates(fromId, conn);
    } catch (error: any) {
      this.config.onError?.(new Error(`Falha ao aceitar oferta: ${error.message}`));
    }
  }

  private async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const conn = this.connections.get(fromId);
    if (!conn) return;
    try {
      await conn.acceptAnswer(sdp);
      await this.flushPendingCandidates(fromId, conn);
    } catch (error: any) {
      this.config.onError?.(new Error(`Falha ao aceitar resposta: ${error.message}`));
    }
  }

  private async handleIceCandidate(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const conn = this.connections.get(fromId);
    if (!conn) {
      // Guarda candidatos até a conexão existir
      if (!this.pendingCandidates.has(fromId)) this.pendingCandidates.set(fromId, []);
      this.pendingCandidates.get(fromId)!.push(candidate);
      return;
    }
    await conn.addIceCandidate(candidate);
  }

  private async flushPendingCandidates(peerId: string, conn: WebRTCConnection): Promise<void> {
    const pending = this.pendingCandidates.get(peerId);
    if (!pending) return;
    for (const candidate of pending) {
      await conn.addIceCandidate(candidate);
    }
    this.pendingCandidates.delete(peerId);
  }

  private getOrCreateConnection(peerId: string): WebRTCConnection {
    let conn = this.connections.get(peerId);
    if (conn) return conn;

    conn = new WebRTCConnection({
      onIceCandidate: (candidate) => this.signaling.sendIceCandidate(peerId, candidate),
      onDataChannelOpen: () => {
        this.config.onLog?.('info', `DataChannel aberto com ${peerId}`);
        const peer = this.peers.get(peerId);
        if (peer) peer.connected = true;
        this.config.onConnected?.(peerId);
        this.signaling.markReady();
      },
      onDataChannelClose: () => {
        const peer = this.peers.get(peerId);
        if (peer) peer.connected = false;
        this.config.onDisconnected?.(peerId);
      },
      onData: (data) => this.handleData(peerId, data),
      onStateChange: (state) => {
        this.config.onLog?.('info', `Conexão ${peerId}: ${state}`);
      },
      onError: (error) => this.config.onError?.(error)
    });

    this.connections.set(peerId, conn);
    return conn;
  }

  // ==================== Handlers de DataChannel ====================

  private handleData(peerId: string, data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      // Mensagens JSON (ex: estado grande)
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'state') {
          const bytes = new Uint8Array(msg.data);
          this.config.onStateSync?.(bytes, msg.frame);
        }
      } catch { /* ignora */ }
      return;
    }

    const view = new DataView(data);
    const type = view.getUint8(0);

    switch (type) {
      case MSG_INPUT: {
        const frame = view.getUint32(1, true);
        const playerIndex = view.getUint32(5, true);
        const buttons = view.getUint32(9, true);
        this.frameSync?.receiveRemoteInput({
          frame,
          inputs: { [playerIndex]: { frame, buttons } }
        });
        break;
      }
      case MSG_STATE: {
        const frame = view.getUint32(1, true);
        const stateBytes = new Uint8Array(data, 5);
        this.config.onStateSync?.(stateBytes, frame);
        break;
      }
      case MSG_STATE_REQUEST:
        this.config.onStateRequest?.();
        break;
      case MSG_PING:
        this.sendRaw(peerId, this.buildMessage(MSG_PONG, 0, 0));
        break;
      case MSG_PONG:
        // Atualiza latência (simplificado)
        break;
    }
  }

  private buildMessage(type: number, frame: number, buttons: number, extra?: Uint8Array): ArrayBuffer {
    const size = 13 + (extra ? extra.length : 0);
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    view.setUint8(0, type);
    view.setUint32(1, frame, true);
    view.setUint32(5, this.localPlayerIndex, true);
    view.setUint32(9, buttons, true);
    if (extra) new Uint8Array(buffer, 13).set(extra);
    return buffer;
  }

  private sendRaw(peerId: string, data: ArrayBuffer | string): void {
    this.connections.get(peerId)?.send(data);
  }

  private broadcast(data: ArrayBuffer | string, excludePeer?: string): void {
    for (const [peerId, conn] of this.connections) {
      if (peerId !== excludePeer && conn.isOpen()) {
        conn.send(data);
      }
    }
  }

  // ==================== API pública ====================

  /**
   * Envia o input do jogador local para o frame atual
   */
  sendInput(buttons: number, analog?: { lx: number; ly: number; rx: number; ry: number }): void {
    this.frameSync?.submitLocalInput(buttons, analog);
  }

  private broadcastInput(bundle: PeerInputBundle): void {
    const localInput = bundle.inputs[this.localPlayerIndex];
    if (!localInput) return;
    const message = this.buildMessage(MSG_INPUT, bundle.frame, localInput.buttons);
    this.broadcast(message);
  }

  /**
   * Avança o frame-sync (chamar a cada frame do emulador)
   */
  tick(): void {
    this.frameSync?.tick();
  }

  /**
   * Envia estado do emulador para os peers (resync)
   */
  broadcastState(stateBytes: Uint8Array, frame: number): void {
    const buffer = this.buildMessage(MSG_STATE, frame, 0, stateBytes);
    this.broadcast(buffer);
  }

  private requestStateSync(): void {
    const message = this.buildMessage(MSG_STATE_REQUEST, this.frameSync?.getCurrentFrame() || 0, 0);
    this.broadcast(message);
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLocalPlayerIndex(): number {
    return this.localPlayerIndex;
  }

  disconnect(): void {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.signaling.disconnect();
    this.frameSync?.stop();
    this.connected = false;
  }
}

/**
 * Factory
 */
export function createNetplay(config: NetplayConfig): Netplay {
  return new Netplay(config);
}

export { SignalingClient, WebRTCConnection, FrameSyncManager };
export * from './types.js';