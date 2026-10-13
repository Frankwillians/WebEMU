/**
 * Hook useAudio - Reproduz o áudio gerado pela SPU via Web Audio API
 *
 * Recebe buffers Float32 (interleaved estéreo) do emulador e agenda
 * a reprodução contínua em um AudioContext.
 */

import { useRef, useCallback, useEffect } from 'react';

export function useAudio() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const bufferQueueRef = useRef<Float32Array[]>([]);
  const scheduledTimeRef = useRef(0);
  const enabledRef = useRef(true);

  const ensureContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 44100
      });
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      gain.connect(ctx.destination);
      audioContextRef.current = ctx;
      gainNodeRef.current = gain;
      scheduledTimeRef.current = ctx.currentTime;
    }
    // Retoma contexto suspenso (política de autoplay)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Enfileira um buffer de áudio do emulador
   */
  const pushAudio = useCallback((samples: Float32Array) => {
    if (!enabledRef.current || samples.length === 0) return;

    try {
      const ctx = ensureContext();

      // Mitigação: se o buffer acumulou muito, descarta o excesso
      if (bufferQueueRef.current.length > 8) {
        bufferQueueRef.current = bufferQueueRef.current.slice(-4);
      }

      bufferQueueRef.current.push(samples);
      scheduleBuffers(ctx);
    } catch (error) {
      console.warn('[Audio] Erro ao reproduzir:', error);
    }
  }, [ensureContext]);

  const scheduleBuffers = (ctx: AudioContext) => {
    const frames = bufferQueueRef.current;
    if (frames.length === 0) return;

    // Combina todos os buffers enfileirados
    const totalSamples = frames.reduce((sum, b) => sum + b.length, 0);
    const combined = new Float32Array(totalSamples);
    let offset = 0;
    for (const frame of frames) {
      combined.set(frame, offset);
      offset += frame.length;
    }
    bufferQueueRef.current = [];

    const stereoFrames = Math.floor(combined.length / 2);
    if (stereoFrames === 0) return;

    const audioBuffer = ctx.createBuffer(2, stereoFrames, ctx.sampleRate);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < stereoFrames; i++) {
      left[i] = combined[i * 2];
      right[i] = combined[i * 2 + 1];
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    if (gainNodeRef.current) source.connect(gainNodeRef.current);

    // Agenda logo após o último buffer
    const now = ctx.currentTime;
    const startTime = Math.max(now, scheduledTimeRef.current);
    source.start(startTime);
    scheduledTimeRef.current = startTime + audioBuffer.duration;
  };

  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = Math.max(0, Math.min(1, volume));
    }
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    if (!enabled && gainNodeRef.current) {
      gainNodeRef.current.gain.value = 0;
    }
  }, []);

  useEffect(() => {
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  return { pushAudio, setVolume, setEnabled, ensureContext };
}

export default useAudio;