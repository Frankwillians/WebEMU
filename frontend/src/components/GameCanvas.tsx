/**
 * GameCanvas - Painel 3: Canvas de exibição do jogo
 * Recebe frames do emulador (RGBA) e os desenha no canvas via ImageData.
 * Suporta fullscreen e scaling responsivo.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

interface GameCanvasProps {
  onFrame: (cb: (pixels: Uint8Array, width: number, height: number) => void) => void;
  onReset: () => void;
  onPauseToggle: () => void;
  isRunning: boolean;
  isPaused: boolean;
  fps: number;
  onFullscreen?: () => void;
}

export function GameCanvas({
  onFrame,
  onReset,
  onPauseToggle,
  isRunning,
  isPaused,
  fps
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<{ pixels: Uint8Array; width: number; height: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const { romName, romInfo } = useStore();

  // Recebe frames do emulador e agenda desenho
  useEffect(() => {
    onFrame((pixels, width, height) => {
      pendingFrameRef.current = { pixels, width, height };
    });
  }, [onFrame]);

  // Loop de renderização
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const render = () => {
      const pending = pendingFrameRef.current;
      if (pending && canvas.width === pending.width && canvas.height === pending.height) {
        pendingFrameRef.current = null;
        try {
          const imageData = new ImageData(new Uint8ClampedArray(pending.pixels), pending.width, pending.height);
          ctx.putImageData(imageData, 0, 0);
        } catch {
          // Fallback se o buffer tiver sido destacado
          const clamped = new Uint8ClampedArray(pending.pixels);
          const imageData = new ImageData(clamped, pending.width, pending.height);
          ctx.putImageData(imageData, 0, 0);
        }
      }
      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  // Monitora mudanças de fullscreen
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Atalhos de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11' || (e.key === 'f' && e.ctrlKey)) {
        e.preventDefault();
        toggleFullscreen();
      }
      if (e.key === 'Escape' && !document.fullscreenElement) {
        setShowOverlay((s) => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFullscreen]);

  return (
    <div className="game-canvas-wrapper">
      <div className="canvas-toolbar">
        <div className="canvas-status">
          {romName ? (
            <>
              <span className={`status-dot ${isRunning && !isPaused ? 'active' : 'paused'}`} />
              <span className="canvas-title" title={romName}>{romName}</span>
              {romInfo && (
                <>
                  <span className="badge badge-info">{romInfo.region}</span>
                  <span className="badge badge-success">{romInfo.serial}</span>
                </>
              )}
            </>
          ) : (
            <span className="canvas-title muted">Nenhuma ROM carregada</span>
          )}
        </div>

        <div className="canvas-controls">
          {isRunning && <span className="fps-counter">{fps} FPS</span>}
          <button
            className="btn btn-ghost btn-sm"
            onClick={onPauseToggle}
            disabled={!isRunning}
            title={isPaused ? 'Continuar (Espaço)' : 'Pausar (Espaço)'}
          >
            {isPaused ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            )}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onReset} disabled={!isRunning} title="Reiniciar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleFullscreen} title="Tela cheia (F11)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="canvas-container">
        <canvas
          ref={canvasRef}
          width={320}
          height={240}
          className="game-canvas"
          onClick={() => setShowOverlay(true)}
        />

        {!romName && (
          <div className="canvas-placeholder">
            <div className="canvas-placeholder-inner">
              <div className="ps1-logo">PS<span>1</span></div>
              <h2>PS1 Emulator</h2>
              <p>Carregue uma ROM local ou da rede para começar</p>
            </div>
          </div>
        )}

        {romName && isPaused && (
          <div className="canvas-pause-overlay" onClick={onPauseToggle}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>Clique para continuar</span>
          </div>
        )}

        {showOverlay && isFullscreen && (
          <div className="canvas-fullscreen-hint" onClick={() => setShowOverlay(false)}>
            ESC ou F11 para sair da tela cheia • Espaço para pausar
          </div>
        )}
      </div>

      <style>{`
        .game-canvas-wrapper {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .canvas-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-md);
          padding: var(--space-sm) var(--space-md);
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
        }

        .canvas-status {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          min-width: 0;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-muted);
          flex-shrink: 0;
        }

        .status-dot.active { background: var(--accent-tertiary); box-shadow: 0 0 8px var(--accent-tertiary); animation: pulse 2s infinite; }
        .status-dot.paused { background: var(--accent-warning); }

        .canvas-title {
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 320px;
        }

        .canvas-title.muted { color: var(--text-muted); font-weight: 400; }

        .canvas-controls {
          display: flex;
          align-items: center;
          gap: var(--space-xs);
        }

        .fps-counter {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--accent-tertiary);
          padding: 2px 8px;
          background: rgba(0, 255, 136, 0.1);
          border-radius: var(--radius-sm);
        }

        .canvas-container {
          position: relative;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          overflow: hidden;
          min-height: 0;
        }

        .game-canvas {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }

        .canvas-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, var(--bg-tertiary), var(--bg-primary));
        }

        .canvas-placeholder-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-sm);
          text-align: center;
        }

        .ps1-logo {
          font-size: 64px;
          font-weight: 900;
          letter-spacing: -2px;
          background: linear-gradient(135deg, var(--accent-primary), #fff, var(--accent-secondary));
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .ps1-logo span { font-size: 40px; }

        .canvas-placeholder h2 { font-size: 20px; font-weight: 600; }
        .canvas-placeholder p { font-size: 14px; color: var(--text-secondary); }

        .canvas-pause-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-md);
          background: rgba(0, 0, 0, 0.6);
          cursor: pointer;
          color: white;
        }

        .canvas-pause-overlay span { font-size: 14px; color: var(--text-secondary); }

        .canvas-fullscreen-hint {
          position: absolute;
          bottom: var(--space-lg);
          left: 50%;
          transform: translateX(-50%);
          padding: var(--space-sm) var(--space-md);
          background: rgba(0, 0, 0, 0.8);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          font-size: 13px;
          color: var(--text-secondary);
          cursor: pointer;
          animation: fadeIn var(--transition-normal);
        }

        :fullscreen .game-canvas-wrapper {
          border-radius: 0;
        }
      `}</style>
    </div>
  );
}

export default GameCanvas;