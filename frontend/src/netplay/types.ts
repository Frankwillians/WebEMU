/**
 * Tipos do módulo de Netplay (WebRTC)
 */

export interface InputFrame {
  /** Número do frame (monotônico) */
  frame: number;
  /** Bitmask de botões do jogador */
  buttons: number;
  /** Estado analógico (opcional) */
  analog?: {
    lx: number;
    ly: number;
    rx: number;
    ry: number;
  };
}

export interface PeerInputBundle {
  /** Frame a que se referem os inputs */
  frame: number;
  /** Inputs por player: playerIndex -> InputFrame */
  inputs: Record<number, InputFrame>;
}

export interface SyncMessage {
  type: 'input' | 'ack' | 'state' | 'state-request' | 'ping' | 'pong' | 'start' | 'config';
  payload?: unknown;
  frame?: number;
}

export interface NetplayConfig {
  /** URL do signaling server (ex: ws://192.168.1.10:8080/signaling) */
  signalingUrl: string;
  /** ID da sala */
  roomId: string;
  /** Índice do jogador local */
  playerIndex: number;
  /** Número total de jogadores esperados na sala (padrão: 2) */
  playerCount?: number;
  /** Metadados do jogador */
  metadata?: Record<string, unknown>;
  /** Callbacks */
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onConnected?: (peerId: string) => void;
  onDisconnected?: (peerId: string) => void;
  onInput?: (frame: number, inputs: Record<number, number>) => void;
  onStateSync?: (state: Uint8Array, frame: number) => void;
  onStateRequest?: () => void;
  onError?: (error: Error) => void;
  onLog?: (level: string, message: string) => void;
}

export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface PeerInfo {
  id: string;
  playerIndex: number;
  metadata: Record<string, unknown>;
  connected: boolean;
  latency: number;
}

// AAC (Acknowledgement) para frame-sync
export interface FrameAck {
  frame: number;
  playerIndex: number;
}

export const NETPLAY_CONSTANTS = {
  /** Frames entre keepalive pings */
  PING_INTERVAL: 1000,
  /** Timestamp de timeout de desconexão */
  DISCONNECT_TIMEOUT: 5000,
  /** Máximo de frames de buffer (rollback) */
  MAX_BUFFER_FRAMES: 8,
  /** Intervalo de sincronização de estado */
  STATE_SYNC_INTERVAL: 300 // a cada 5 segundos a 60fps
} as const;