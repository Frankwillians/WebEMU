/**
 * GamepadMapper - Remapeamento visual de controles (Teclado e Gamepad)
 */

import { useState } from 'react';
import { useStore } from '../store';
import type { KeyMapping, GamepadMapping } from '../types';
import { DEFAULT_KEY_MAPPING, DEFAULT_GAMEPAD_MAPPING } from '../hooks/useInput';

interface GamepadMapperProps {
  keyMapping: KeyMapping;
  gamepadMapping: GamepadMapping;
  onSetKeyMapping: (m: KeyMapping) => void;
  onSetGamepadMapping: (m: GamepadMapping) => void;
  gamepadConnected: boolean;
  gamepadName: string | null;
}

const PS1_BUTTONS = [
  'UP', 'DOWN', 'LEFT', 'RIGHT',
  'CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE',
  'L1', 'R1', 'L2', 'R2',
  'START', 'SELECT'
];

export function GamepadMapper({
  keyMapping,
  gamepadMapping,
  onSetKeyMapping,
  onSetGamepadMapping,
  gamepadConnected,
  gamepadName
}: GamepadMapperProps) {
  const { setShowGamepadMapper, addToast } = useStore();
  const [listeningFor, setListeningFor] = useState<string | null>(null);
  const [tab, setTab] = useState<'keyboard' | 'gamepad'>('keyboard');

  const handleKeyCapture = (button: string) => {
    setListeningFor(button);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const newMapping = { ...keyMapping, [button]: e.key };
      onSetKeyMapping(newMapping);
      setListeningFor(null);
      window.removeEventListener('keydown', handler, true);
      addToast('success', `${button} mapeado para "${e.key}"`);
    };
    window.addEventListener('keydown', handler, true);
  };

  const resetDefaults = () => {
    onSetKeyMapping({ ...DEFAULT_KEY_MAPPING });
    onSetGamepadMapping({ ...DEFAULT_GAMEPAD_MAPPING });
    addToast('info', 'Mapeamento restaurado para o padrão');
  };

  return (
    <div className="modal-overlay" onClick={() => setShowGamepadMapper(false)}>
      <div className="modal gamepad-mapper" onClick={(e) => e.stopPropagation()}>
        <div className="mapper-header">
          <h2>Configurar Controles</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowGamepadMapper(false)}>✕</button>
        </div>

        <div className="mapper-tabs">
          <button
            className={`mapper-tab ${tab === 'keyboard' ? 'active' : ''}`}
            onClick={() => setTab('keyboard')}
          >
            ⌨️ Teclado
          </button>
          <button
            className={`mapper-tab ${tab === 'gamepad' ? 'active' : ''}`}
            onClick={() => setTab('gamepad')}
          >
            🎮 Gamepad {gamepadConnected && <span className="badge badge-success">Conectado</span>}
          </button>
        </div>

        {tab === 'keyboard' && (
          <div className="mapper-list">
            {PS1_BUTTONS.map((button) => (
              <div key={button} className="mapper-row">
                <span className="mapper-button-name">{button}</span>
                <button
                  className={`mapper-key ${listeningFor === button ? 'listening' : ''}`}
                  onClick={() => handleKeyCapture(button)}
                >
                  {listeningFor === button ? 'Pressione uma tecla...' : (keyMapping[button] || '—')}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'gamepad' && (
          <div className="mapper-gamepad-section">
            {!gamepadConnected ? (
              <div className="mapper-empty">
                <p>Nenhum gamepad conectado.</p>
                <span className="mapper-hint">Conecte um controle USB/Bluetooth e pressione qualquer botão para ativar.</span>
              </div>
            ) : (
              <>
                <div className="mapper-gamepad-name">
                  <span className="badge badge-success">Conectado</span>
                  <span className="mapper-gamepad-id">{gamepadName}</span>
                </div>
                <p className="mapper-hint">
                  O mapeamento usa a API padrão de gamepad (índices de botão). Ajuste manualmente se necessário.
                </p>
                <div className="mapper-list">
                  {PS1_BUTTONS.map((button) => (
                    <div key={button} className="mapper-row">
                      <span className="mapper-button-name">{button}</span>
                      <input
                        type="number"
                        className="input mapper-gamepad-input"
                        value={gamepadMapping[button] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                          onSetGamepadMapping({ ...gamepadMapping, [button]: val });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="mapper-footer">
          <button className="btn btn-secondary" onClick={resetDefaults}>Restaurar padrão</button>
          <button className="btn btn-primary" onClick={() => setShowGamepadMapper(false)}>Concluir</button>
        </div>
      </div>

      <style>{`
        .gamepad-mapper { max-width: 480px; }
        .mapper-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); }
        .mapper-header h2 { font-size: 18px; }
        .mapper-tabs { display: flex; gap: var(--space-xs); margin-bottom: var(--space-md); }
        .mapper-tab {
          display: flex; align-items: center; gap: var(--space-xs);
          padding: var(--space-sm) var(--space-md);
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          cursor: pointer; font-size: 13px; font-weight: 600;
          transition: all var(--transition-fast);
        }
        .mapper-tab.active { background: var(--bg-hover); border-color: var(--accent-primary); color: var(--text-primary); }
        .mapper-list { display: flex; flex-direction: column; gap: var(--space-xs); max-height: 340px; overflow-y: auto; padding-right: var(--space-xs); }
        .mapper-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
        .mapper-button-name { font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 90px; }
        .mapper-key {
          flex: 1; padding: var(--space-sm) var(--space-md);
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          cursor: pointer; font-size: 13px; text-align: center;
          transition: all var(--transition-fast);
        }
        .mapper-key:hover { border-color: var(--accent-primary); }
        .mapper-key.listening { border-color: var(--accent-warning); color: var(--accent-warning); animation: pulse 1s infinite; }
        .mapper-gamepad-section { display: flex; flex-direction: column; gap: var(--space-sm); }
        .mapper-gamepad-name { display: flex; align-items: center; gap: var(--space-sm); }
        .mapper-gamepad-id { font-size: 12px; color: var(--text-muted); }
        .mapper-gamepad-input { width: 80px; text-align: center; }
        .mapper-hint { font-size: 12px; color: var(--text-muted); }
        .mapper-empty { display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-lg); text-align: center; color: var(--text-secondary); }
        .mapper-footer { display: flex; justify-content: space-between; gap: var(--space-sm); margin-top: var(--space-lg); }
      `}</style>
    </div>
  );
}

export default GamepadMapper;