/**
 * Tipos do Frontend
 */

export interface GameInfo {
  id: string;
  name: string;
  fileName: string;
  size: number;
  sizeFormatted: string;
  extension: string;
  modified: string;
}

export interface PlayerInfo {
  id: string;
  playerIndex: number;
  metadata: Record<string, unknown>;
  connected: boolean;
  latency: number;
}

export type NetplayStatus = 'idle' | 'connecting' | 'connected' | 'hosting' | 'error';

export interface GamepadMapping {
  [button: string]: number | null;
}

export interface KeyMapping {
  [button: string]: string | null;
}

export type InputSource = 'keyboard' | 'gamepad';