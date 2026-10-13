/**
 * Conexão WebRTC P2P
 * Gerencia a RTCPeerConnection e o DataChannel de baixa latência.
 */

import type { PeerConnectionState } from './types.js';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export interface WebRTCEvents {
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onData?: (data: ArrayBuffer | string) => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onStateChange?: (state: PeerConnectionState) => void;
  onError?: (error: Error) => void;
}

export class WebRTCConnection {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private events: WebRTCEvents;
  private iceServers: RTCIceServer[];
  private label: string;
  private isInitiator = false;

  constructor(events: WebRTCEvents, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS, label = 'ps1netplay') {
    this.events = events;
    this.iceServers = iceServers;
    this.label = label;
  }

  /**
   * Cria a oferta (lado que inicia a conexão)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.isInitiator = true;
    this.createPeerConnection();

    // Cria o DataChannel com baixa latência:
    // - ordered: true (inputs precisam de ordem)
    // - maxRetransmits: 0 (não retransmite, descarta se perdido - UDP-like)
    this.dataChannel = this.pc!.createDataChannel(this.label, {
      ordered: true,
      maxRetransmits: 0
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc!.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await this.pc!.setLocalDescription(offer);
    return offer;
  }

  /**
   * Aceita uma oferta e cria a resposta
   */
  async acceptOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    this.isInitiator = false;
    this.createPeerConnection();

    this.pc!.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    await this.pc!.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    return answer;
  }

  /**
   * Finaliza a conexão com uma resposta SDP
   */
  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection não inicializada');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Adiciona um ICE candidate recebido
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error: any) {
      this.events.onError?.(new Error(`Erro ao adicionar ICE: ${error.message}`));
    }
  }

  private createPeerConnection(): void {
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.events.onIceCandidate?.(event.candidate.toJSON());
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState as PeerConnectionState;
      this.events.onStateChange?.(state);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.events.onError?.(new Error(`ICE ${state}`));
      }
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.events.onDataChannelOpen?.();
    };

    channel.onclose = () => {
      this.events.onDataChannelClose?.();
    };

    channel.onmessage = (event) => {
      this.events.onData?.(event.data);
    };

    channel.onerror = (error) => {
      this.events.onError?.(new Error(`DataChannel error: ${(error as any).message || error}`));
    };
  }

  /**
   * Envia dados pelo DataChannel
   */
  send(data: ArrayBuffer | string): boolean {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data as any);
      return true;
    }
    return false;
  }

  getState(): PeerConnectionState {
    return (this.pc?.connectionState as PeerConnectionState) || 'new';
  }

  isOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.dataChannel = null;
    this.pc = null;
  }
}

export default WebRTCConnection;