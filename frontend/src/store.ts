/**
 * Store global (Zustand) - estado do emulador, jogos e netplay
 */

import { create } from 'zustand';
import type { GameInfo, PlayerInfo, NetplayStatus } from './types';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface EmulatorStore {
  // ===== Estado do Emulador =====
  romLoaded: boolean;
  romName: string | null;
  romInfo: { region: string; serial: string; size: number } | null;
  isRunning: boolean;
  isPaused: boolean;
  fps: number;
  frameTime: number;
  emulatorStats: { cyclesPerSecond: number } | null;

  // ===== Jogos =====
  games: GameInfo[];
  gamesLoading: boolean;
  gamesError: string | null;

  // ===== Netplay =====
  netplayStatus: NetplayStatus;
  netplayRoomId: string;
  netplayPlayerIndex: number;
  netplayPeers: PlayerInfo[];

  // ===== UI =====
  toasts: Toast[];
  activeTab: 'local' | 'network' | 'netplay';
  showGamepadMapper: boolean;

  // ===== Actions =====
  setRomLoaded: (name: string, info: { region: string; serial: string; size: number }) => void;
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setStats: (fps: number, frameTime: number, cycles: number) => void;

  setGames: (games: GameInfo[]) => void;
  setGamesLoading: (loading: boolean) => void;
  setGamesError: (error: string | null) => void;

  setNetplayStatus: (status: NetplayStatus) => void;
  setNetplayRoom: (roomId: string, playerIndex: number) => void;
  setNetplayPeers: (peers: PlayerInfo[]) => void;

  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;
  setActiveTab: (tab: 'local' | 'network' | 'netplay') => void;
  setShowGamepadMapper: (show: boolean) => void;
}

export const useStore = create<EmulatorStore>((set) => ({
  romLoaded: false,
  romName: null,
  romInfo: null,
  isRunning: false,
  isPaused: false,
  fps: 0,
  frameTime: 0,
  emulatorStats: null,

  games: [],
  gamesLoading: false,
  gamesError: null,

  netplayStatus: 'idle',
  netplayRoomId: '',
  netplayPlayerIndex: 0,
  netplayPeers: [],

  toasts: [],
  activeTab: 'local',
  showGamepadMapper: false,

  setRomLoaded: (name, info) => set({ romLoaded: true, romName: name, romInfo: info }),
  setRunning: (running) => set({ isRunning: running }),
  setPaused: (paused) => set({ isPaused: paused }),
  setStats: (fps, frameTime, cycles) => set({ fps, frameTime, emulatorStats: { cyclesPerSecond: cycles } }),

  setGames: (games) => set({ games }),
  setGamesLoading: (loading) => set({ gamesLoading: loading }),
  setGamesError: (error) => set({ gamesError: error }),

  setNetplayStatus: (status) => set({ netplayStatus: status }),
  setNetplayRoom: (roomId, playerIndex) => set({ netplayRoomId: roomId, netplayPlayerIndex: playerIndex }),
  setNetplayPeers: (peers) => set({ netplayPeers: peers }),

  addToast: (type, message) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setShowGamepadMapper: (show) => set({ showGamepadMapper: show })
}));