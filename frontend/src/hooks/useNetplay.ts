/**
 * Hook useNetplay - Gerencia a conexão de multiplayer
 */

import { useRef, useCallback } from 'react';
import { createNetplay, type Netplay } from '../netplay/index';
import { useStore } from '../store';

export function useNetplay() {
  const netplayRef = useRef<Netplay | null>(null);

  const {
    addToast,
    setNetplayStatus,
    setNetplayRoom,
    setNetplayPeers,
    netplayStatus
  } = useStore();

  /**
   * Cria uma sala (host) e conecta
   */
  const hostRoom = useCallback(async (roomId: string) => {
    setNetplayStatus('connecting');
    try {
      const signalingUrl = getSignalingUrl();
      const netplay = createNetplay({
        signalingUrl,
        roomId,
        playerIndex: 0, // host é player 0
        playerCount: 2,
        metadata: { name: `Player 1`, host: true },
        onPeerJoin: (peerId: string) => {
          addToast('info', `Jogador conectou: ${peerId.slice(0, 12)}`);
        },
        onPeerLeave: () => {
          addToast('warning', 'Jogador desconectou');
        },
        onConnected: () => {
          setNetplayStatus('connected');
          setNetplayPeers(netplay.getPeers());
          addToast('success', 'P2P conectado! Pronto para jogar.');
        },
        onInput: () => { /* aplicado externamente */ },
        onStateSync: () => { /* aplicado externamente */ },
        onError: (error: Error) => {
          addToast('error', `Netplay: ${error.message}`);
          setNetplayStatus('error');
        },
        onLog: (level: string, msg: string) => console.log(`[Netplay:${level}]`, msg)
      });

      netplayRef.current = netplay;
      await netplay.connect();
      setNetplayRoom(roomId, 0);
      setNetplayStatus('hosting');
      addToast('success', `Sala "${roomId}" criada. Compartilhe o ID com o outro jogador.`);
      return true;
    } catch (error: any) {
      addToast('error', `Falha ao criar sala: ${error.message}`);
      setNetplayStatus('error');
      return false;
    }
  }, [addToast, setNetplayStatus, setNetplayRoom, setNetplayPeers]);

  /**
   * Entra em uma sala existente
   */
  const joinRoom = useCallback(async (roomId: string) => {
    setNetplayStatus('connecting');
    try {
      const signalingUrl = getSignalingUrl();
      const netplay = createNetplay({
        signalingUrl,
        roomId,
        playerIndex: 1, // join é player 1
        playerCount: 2,
        metadata: { name: `Player 2`, host: false },
        onPeerJoin: (peerId: string) => {
          addToast('info', `Host detectado: ${peerId.slice(0, 12)}`);
        },
        onConnected: () => {
          setNetplayStatus('connected');
          addToast('success', 'Conectado ao host! Pronto para jogar.');
        },
        onPeerLeave: () => {
          addToast('warning', 'Host desconectou');
        },
        onError: (error: Error) => {
          addToast('error', `Netplay: ${error.message}`);
          setNetplayStatus('error');
        },
        onLog: (level: string, msg: string) => console.log(`[Netplay:${level}]`, msg)
      });

      netplayRef.current = netplay;
      await netplay.connect();
      setNetplayRoom(roomId, 1);
      setNetplayStatus('connecting');
      addToast('info', `Entrando na sala "${roomId}"...`);
      return true;
    } catch (error: any) {
      addToast('error', `Falha ao entrar na sala: ${error.message}`);
      setNetplayStatus('error');
      return false;
    }
  }, [addToast, setNetplayStatus, setNetplayRoom]);

  const disconnect = useCallback(() => {
    netplayRef.current?.disconnect();
    netplayRef.current = null;
    setNetplayStatus('idle');
    setNetplayPeers([]);
    addToast('info', 'Desconectado do netplay');
  }, [addToast, setNetplayStatus, setNetplayPeers]);

  const sendInput = useCallback((buttons: number) => {
    netplayRef.current?.sendInput(buttons);
  }, []);

  const tick = useCallback(() => {
    netplayRef.current?.tick();
  }, []);

  const getNetplay = useCallback(() => netplayRef.current, []);

  return {
    hostRoom,
    joinRoom,
    disconnect,
    sendInput,
    tick,
    getNetplay,
    status: netplayStatus
  };
}

/**
 * Permite sobrescrever a URL do backend por variável de ambiente.
 * Ex.: VITE_BACKEND_URL=http://192.168.1.10:3000
 */
const BACKEND_HTTP = (import.meta as any).env?.VITE_BACKEND_URL || '';

/**
 * Determina a URL do signaling server.
 * O signaling compartilha a mesma porta/processo do backend HTTP.
 * - Produção: mesma origem do site (o backend serve o frontend).
 * - Dev: backend na porta 3000 desta máquina.
 */
function getSignalingUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (BACKEND_HTTP) {
    const u = new URL(BACKEND_HTTP);
    return `${protocol}//${u.hostname}${u.port ? ':' + u.port : ''}/signaling`;
  }

  if (import.meta.env.DEV) {
    const host = window.location.hostname;
    return `${protocol}//${host}:3000/signaling`;
  }

  // Produção: mesmo host e porta do site
  return `${protocol}//${window.location.host}/signaling`;
}

export default useNetplay;