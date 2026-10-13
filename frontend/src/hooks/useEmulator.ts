/**
 * Hook useEmulator - Inicializa e gerencia o cliente do emulador (Web Worker)
 */

import { useEffect, useRef, useCallback } from 'react';
import { createEmulator, type EmulatorClient } from '../core/index';
import { PS1Button, type VideoFrame } from '../core/types';
import { useStore } from '../store';

export interface UseEmulatorReturn {
  loadROMFile: (file: File) => Promise<void>;
  loadROMFromURL: (url: string, name: string) => Promise<void>;
  loadBIOSFile: (file: File) => Promise<void>;
  start: () => void;
  pause: () => void
  resume: () => void;
  reset: () => void;
  setInput: (buttons: number) => void;
  getEmulator: () => EmulatorClient | null;
  onFrame: (cb: (frame: VideoFrame, audio: Float32Array | null) => void) => void;
}

export function useEmulator(): UseEmulatorReturn {
  const emulatorRef = useRef<EmulatorClient | null>(null);
  const frameCallbacksRef = useRef<((frame: VideoFrame, audio: Float32Array | null) => void)[]>([]);

  const { setRomLoaded, setRunning, setPaused, setStats, addToast } = useStore();

  // Inicializa o emulador uma vez
  useEffect(() => {
    const emulator = createEmulator();
    emulatorRef.current = emulator;

    emulator.onFrame((frame, audio) => {
      for (const cb of frameCallbacksRef.current) cb(frame, audio);
    });

    emulator.onStats((stats) => {
      setStats(stats.fps, stats.frameTime, stats.cyclesPerSecond);
    });

    emulator.onError((error) => {
      console.error('[Emulator]', error);
      addToast('error', `Erro no emulador: ${error.message}`);
      setRunning(false);
    });

    emulator.onLog((level, message) => {
      console.log(`[Emulator:${level}]`, message);
    });

    return () => {
      emulator.destroy();
      emulatorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadROMFile = useCallback(async (file: File) => {
    const emulator = emulatorRef.current;
    if (!emulator) return;

    try {
      addToast('info', `Carregando ROM: ${file.name}...`);
      const buffer = await file.arrayBuffer();
      const info = await emulator.loadROM(buffer, file.name);

      setRomLoaded(file.name, { region: info.region, serial: info.serial, size: info.size });
      addToast('success', `ROM carregada: ${file.name}`);

      // Inicia automaticamente
      emulator.start();
      setRunning(true);
      setPaused(false);
    } catch (error: any) {
      addToast('error', `Falha ao carregar ROM: ${error.message}`);
    }
  }, [addToast, setRomLoaded, setRunning, setPaused]);

  const loadROMFromURL = useCallback(async (url: string, name: string) => {
    const emulator = emulatorRef.current;
    if (!emulator) return;

    try {
      addToast('info', `Baixando ROM da rede: ${name}...`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const info = await emulator.loadROM(buffer, name);

      setRomLoaded(name, { region: info.region, serial: info.serial, size: info.size });
      addToast('success', `ROM da rede carregada: ${name}`);

      emulator.start();
      setRunning(true);
      setPaused(false);
    } catch (error: any) {
      addToast('error', `Falha ao carregar ROM da rede: ${error.message}`);
    }
  }, [addToast, setRomLoaded, setRunning, setPaused]);

  const loadBIOSFile = useCallback(async (file: File) => {
    const emulator = emulatorRef.current;
    if (!emulator) return;
    try {
      const buffer = await file.arrayBuffer();
      await emulator.loadBIOS(buffer);
      addToast('success', `BIOS carregada: ${file.name}`);
    } catch (error: any) {
      addToast('error', `Falha ao carregar BIOS: ${error.message}`);
    }
  }, [addToast]);

  const start = useCallback(() => {
    emulatorRef.current?.start();
    setRunning(true);
    setPaused(false);
  }, [setRunning, setPaused]);

  const pause = useCallback(() => {
    emulatorRef.current?.pause();
    setPaused(true);
  }, [setPaused]);

  const resume = useCallback(() => {
    emulatorRef.current?.resume();
    setPaused(false);
  }, [setPaused]);

  const reset = useCallback(() => {
    emulatorRef.current?.reset();
  }, []);

  const setInput = useCallback((buttons: number) => {
    emulatorRef.current?.setInput(0, buttons);
  }, []);

  const getEmulator = useCallback(() => emulatorRef.current, []);

  const onFrame = useCallback((cb: (frame: VideoFrame, audio: Float32Array | null) => void) => {
    frameCallbacksRef.current.push(cb);
  }, []);

  return {
    loadROMFile,
    loadROMFromURL,
    loadBIOSFile,
    start,
    pause,
    resume,
    reset,
    setInput,
    getEmulator,
    onFrame
  };
}

export { PS1Button };