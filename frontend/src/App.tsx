/**
 * App - Integra todos os painéis do PS1 Emulator
 *
 * Layout:
 *   - Sidebar: abas (Local / Rede / Multiplayer) + controles
 *   - Main: GameCanvas
 */

import { useCallback, useEffect } from 'react';
import { useStore } from './store';
import { useEmulator } from './hooks/useEmulator';
import { useInput } from './hooks/useInput';
import { useAudio } from './hooks/useAudio';
import { useNetplay } from './hooks/useNetplay';
import ROMLoader from './components/ROMLoader';
import GameBrowser from './components/GameBrowser';
import GameCanvas from './components/GameCanvas';
import GamepadMapper from './components/GamepadMapper';
import NetplayLobby from './components/NetplayLobby';
import Toasts from './components/Toasts';
import type { VideoFrame } from './core/types';

export function App() {
  const {
    activeTab, setActiveTab,
    showGamepadMapper, setShowGamepadMapper,
    isRunning, isPaused, fps, romLoaded, romName, romInfo
  } = useStore();

  const emulator = useEmulator();
  const input = useInput();
  const audio = useAudio();
  const netplay = useNetplay();

  // Conecta o input (teclado/gamepad) ao emulador a cada mudança
  useEffect(() => {
    emulator.setInput(input.buttons);
    // Também envia para o netplay se conectado
    if (netplay.status !== 'idle') {
      netplay.sendInput(input.buttons);
    }
  }, [input.buttons, emulator, netplay]);

  // Handler de frame: envia pixels ao canvas e áudio ao Web Audio
  const handleFrame = useCallback((callback: (pixels: Uint8Array, w: number, h: number) => void) => {
    emulator.onFrame((frame: VideoFrame, audioBuf: Float32Array | null) => {
      callback(frame.pixels, frame.width, frame.height);
      if (audioBuf) {
        audio.pushAudio(audioBuf);
      }
    });
  }, [emulator, audio]);

  // Carrega ROM de URL (usado pelo GameBrowser)
  const handleLoadFromURL = useCallback(async (url: string, name: string) => {
    await emulator.loadROMFromURL(url, name);
    // Inicializa áudio no primeiro clique (política de autoplay)
    audio.ensureContext();
  }, [emulator, audio]);

  const handleLoadROM = useCallback(async (file: File) => {
    audio.ensureContext();
    await emulator.loadROMFile(file);
  }, [emulator, audio]);

  const handlePauseToggle = useCallback(() => {
    if (isPaused) emulator.resume();
    else emulator.pause();
  }, [isPaused, emulator]);

  // Atalho de espaço para pausar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && romLoaded) {
        e.preventDefault();
        handlePauseToggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [romLoaded, handlePauseToggle]);

  const tabs = [
    { id: 'local' as const, label: 'Local', icon: '💾' },
    { id: 'network' as const, label: 'Rede', icon: '🌐' },
    { id: 'netplay' as const, label: 'Multiplayer', icon: '👥' }
  ];

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-brand">
          <div className="brand-logo">PS<span>1</span></div>
          <div className="brand-text">
            <h1>PS1 Emulator</h1>
            <p>Browser-based PlayStation 1</p>
          </div>
        </div>

        <div className="app-header-status">
          {input.gamepadConnected && (
            <span className="badge badge-success">🎮 Gamepad</span>
          )}
          {netplay.status !== 'idle' && (
            <span className={`badge ${netplay.status === 'connected' ? 'badge-success' : 'badge-warning'}`}>
              👥 {netplay.status === 'connected' ? 'P2P Online' : netplay.status}
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowGamepadMapper(true)} title="Configurar controles">
            ⚙️ Controles
          </button>
        </div>
      </header>

      <div className="app-notice">
        ⚠️ Esta interface usa o <strong>core experimental</strong> (Fase 1, ainda não
        executa jogos). Para <strong>jogar de verdade</strong>, use o emulador com
        núcleo WebAssembly real:
        <a className="btn btn-primary btn-sm" href="/play.html" style={{ marginLeft: 12 }}>
          ▶ Abrir o jogo (EmulatorJS)
        </a>
      </div>

      <div className="app-body">
        {/* Sidebar */}
        <aside className="app-sidebar">
          <nav className="sidebar-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="sidebar-tab-icon">{tab.icon}</span>
                <span className="sidebar-tab-label">{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-content">
            {activeTab === 'local' && (
              <div className="panel">
                <h2 className="panel-title">Carregar do Computador</h2>
                <ROMLoader
                  onLoadROM={handleLoadROM}
                  onLoadBIOS={emulator.loadBIOSFile}
                />
              </div>
            )}

            {activeTab === 'network' && (
              <div className="panel">
                <h2 className="panel-title">Jogos da Rede Local</h2>
                <GameBrowser
                  onLoadGame={handleLoadFromURL}
                  disabled={isRunning}
                />
              </div>
            )}

            {activeTab === 'netplay' && (
              <div className="panel">
                <h2 className="panel-title">Multiplayer (WebRTC)</h2>
                <NetplayLobby
                  onHost={netplay.hostRoom}
                  onJoin={netplay.joinRoom}
                  onDisconnect={netplay.disconnect}
                />
              </div>
            )}
          </div>

          {/* Rodapé da sidebar com status */}
          <div className="sidebar-footer">
            {romLoaded ? (
              <div className="rom-status-card">
                <span className="status-dot active" />
                <div className="rom-status-info">
                  <span className="rom-status-name" title={romName || ''}>{romName}</span>
                  <span className="rom-status-meta">
                    {romInfo?.region} · {romInfo?.serial} · {(romInfo!.size / 1024 / 1024).toFixed(0)} MB
                  </span>
                </div>
              </div>
            ) : (
              <span className="sidebar-footer-hint">Nenhuma ROM carregada</span>
            )}
          </div>
        </aside>

        {/* Área principal */}
        <main className="app-main">
          <GameCanvas
            onFrame={handleFrame}
            onReset={emulator.reset}
            onPauseToggle={handlePauseToggle}
            isRunning={isRunning}
            isPaused={isPaused}
            fps={fps}
          />
        </main>
      </div>

      {showGamepadMapper && (
        <GamepadMapper
          keyMapping={input.keyMapping}
          gamepadMapping={input.gamepadMapping}
          onSetKeyMapping={input.setKeyMapping}
          onSetGamepadMapping={input.setGamepadMapping}
          gamepadConnected={input.gamepadConnected}
          gamepadName={input.gamepadName}
        />
      )}

      <Toasts />

      <style>{`
        .app { display: flex; flex-direction: column; height: 100%; }

        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-md);
          padding: var(--space-sm) var(--space-lg);
          height: var(--header-height);
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }

        .app-brand { display: flex; align-items: center; gap: var(--space-md); }
        .brand-logo {
          font-size: 24px; font-weight: 900; letter-spacing: -1px;
          background: linear-gradient(135deg, var(--accent-primary), #fff, var(--accent-secondary));
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .brand-logo span { font-size: 16px; }
        .brand-text h1 { font-size: 15px; font-weight: 700; line-height: 1.1; }
        .brand-text p { font-size: 11px; color: var(--text-muted); }

        .app-header-status { display: flex; align-items: center; gap: var(--space-sm); }

        .app-notice {
          display: flex; align-items: center; flex-wrap: wrap;
          gap: 6px;
          padding: var(--space-sm) var(--space-lg);
          font-size: 12px;
          color: var(--text-secondary, #cbd5e1);
          background: linear-gradient(90deg, rgba(245, 158, 11, .12), rgba(59, 130, 246, .10));
          border-bottom: 1px solid var(--border-color, #243044);
        }
        .app-notice strong { color: var(--text-primary, #e8eefc); }

        .app-body { display: flex; flex: 1; min-height: 0; }

        .app-sidebar {
          width: var(--sidebar-width);
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-color);
          flex-shrink: 0;
          min-height: 0;
        }

        .sidebar-tabs { display: flex; border-bottom: 1px solid var(--border-color); }
        .sidebar-tab {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: var(--space-sm);
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all var(--transition-fast);
          font-size: 11px;
        }
        .sidebar-tab:hover { color: var(--text-secondary); background: var(--bg-hover); }
        .sidebar-tab.active { color: var(--accent-primary); border-bottom-color: var(--accent-primary); }
        .sidebar-tab-icon { font-size: 18px; }
        .sidebar-tab-label { font-weight: 600; }

        .sidebar-content { flex: 1; overflow-y: auto; padding: var(--space-md); min-height: 0; }
        .panel { display: flex; flex-direction: column; gap: var(--space-md); }
        .panel-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }

        .sidebar-footer { padding: var(--space-md); border-top: 1px solid var(--border-color); flex-shrink: 0; }
        .sidebar-footer-hint { font-size: 12px; color: var(--text-muted); }
        .rom-status-card { display: flex; align-items: center; gap: var(--space-sm); }
        .rom-status-info { display: flex; flex-direction: column; min-width: 0; }
        .rom-status-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rom-status-meta { font-size: 11px; color: var(--text-muted); }

        .app-main { flex: 1; padding: var(--space-md); min-width: 0; min-height: 0; }

        @media (max-width: 768px) {
          .app-body { flex-direction: column; }
          .app-sidebar { width: 100%; max-height: 45%; border-right: none; border-bottom: 1px solid var(--border-color); }
          .app-main { flex: 1; }
        }
      `}</style>
    </div>
  );
}

export default App;