/**
 * Cliente de Sinalização WebSocket
 * Conecta ao signaling server para trocar SDP offers/answers e ICE candidates.
 */

const MessageType = {
  JOIN: 'join',
  LEAVE: 'leave',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  PEER_LIST: 'peer-list',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  ERROR: 'error',
  READY: 'ready'
} as const;

export interface SignalingEvents {
  onPeerList?: (peers: { id: string; playerIndex: number; metadata: Record<string, unknown> }[]) => void;
  onPeerJoined?: (peer: { id: string; playerIndex: number; metadata: Record<string, unknown> }) => void;
  onPeerLeft?: (id: string) => void;
  onOffer?: (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer?: (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (fromId: string, candidate: RTCIceCandidateInit) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  onLog?: (level: string, message: string) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private events: SignalingEvents;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private shouldReconnect = true;
  private roomId = '';
  private playerIndex = 0;
  private metadata: Record<string, unknown> = {};
  private lastJoinPayload: object | null = null;

  constructor(url: string, events: SignalingEvents) {
    this.url = url;
    this.events = events;
  }

  connect(roomId: string, playerIndex: number, metadata: Record<string, unknown> = {}): Promise<{ id: string; peers: any[] }> {
    return new Promise((resolve, reject) => {
      this.roomId = roomId;
      this.playerIndex = playerIndex;
      this.metadata = metadata;

      try {
        this.ws = new WebSocket(this.url);
      } catch (error: any) {
        reject(error);
        return;
      }

      const joinPayload = { type: MessageType.JOIN, payload: { roomId, playerIndex, metadata } };
      this.lastJoinPayload = joinPayload;

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.send(joinPayload);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message, resolve, reject);
        } catch (error: any) {
          this.events.onError?.(`Mensagem inválida: ${error.message}`);
        }
      };

      this.ws.onerror = () => {
        this.events.onError?.('Erro na conexão de sinalização');
      };

      this.ws.onclose = () => {
        this.events.onClose?.();
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private handleMessage(message: any, resolve?: (v: any) => void, reject?: (e: any) => void): void {
    switch (message.type) {
      case MessageType.PEER_LIST:
        this.playerIndex = message.payload.yourPlayerIndex;
        resolve?.({ id: message.payload.yourId, peers: message.payload.peers });
        this.events.onPeerList?.(message.payload.peers);
        break;

      case MessageType.PEER_JOINED:
        this.events.onPeerJoined?.(message.payload);
        break;

      case MessageType.PEER_LEFT:
        this.events.onPeerLeft?.(message.payload.id);
        break;

      case MessageType.OFFER:
        this.events.onOffer?.(message.payload.fromId, message.payload.sdp);
        break;

      case MessageType.ANSWER:
        this.events.onAnswer?.(message.payload.fromId, message.payload.sdp);
        break;

      case MessageType.ICE_CANDIDATE:
        this.events.onIceCandidate?.(message.payload.fromId, message.payload.candidate);
        break;

      case MessageType.ERROR:
        this.events.onError?.(message.payload.message);
        reject?.(new Error(message.payload.message));
        break;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => {
      if (this.shouldReconnect && this.lastJoinPayload) {
        this.connect(this.roomId, this.playerIndex, this.metadata).catch(() => {});
      }
    }, delay);
  }

  send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendOffer(targetId: string, sdp: RTCSessionDescriptionInit): void {
    this.send({ type: MessageType.OFFER, targetId, payload: { sdp } });
  }

  sendAnswer(targetId: string, sdp: RTCSessionDescriptionInit): void {
    this.send({ type: MessageType.ANSWER, targetId, payload: { sdp } });
  }

  sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit): void {
    this.send({ type: MessageType.ICE_CANDIDATE, targetId, payload: { candidate } });
  }

  markReady(): void {
    this.send({ type: MessageType.READY });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.send({ type: MessageType.LEAVE });
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export default SignalingClient;