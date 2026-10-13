/**
 * GameBrowser - Painel 2: Navegador de jogos da rede local
 * Consome a API do backend (/api/games).
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store';

interface GameBrowserProps {
  onLoadGame: (gameId: string, name: string) => Promise<void>;
  disabled?: boolean;
}

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3000'
  : '';

export function GameBrowser({ onLoadGame, disabled }: GameBrowserProps) {
  const { games, setGames, gamesLoading, setGamesLoading, gamesError, setGamesError, addToast } = useStore();
  const [search, setSearch] = useState('');
  const [serverUrl, setServerUrl] = useState(API_BASE);
  const [loadingGame, setLoadingGame] = useState<string | null>(null);

  const fetchGames = useCallback(async (url: string) => {
    setGamesLoading(true);
    setGamesError(null);
    try {
      const response = await fetch(`${url}/api/games`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setGames(data.games || []);
      addToast('success', `${data.games?.length || 0} jogos encontrados na rede`);
    } catch (error: any) {
      setGamesError(error.message);
      addToast('error', `Não foi possível conectar ao servidor: ${error.message}`);
    } finally {
      setGamesLoading(false);
    }
  }, [setGames, setGamesLoading, setGamesError, addToast]);

  useEffect(() => {
    // Tenta carregar automaticamente na montagem
    fetchGames(serverUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = useCallback(async (gameId: string, name: string) => {
    if (disabled) return;
    setLoadingGame(gameId);
    try {
      const url = `${serverUrl}/api/games/${gameId}/download`;
      await onLoadGame(url, name);
    } finally {
      setLoadingGame(null);
    }
  }, [disabled, serverUrl, onLoadGame]);

  const filteredGames = games.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="game-browser">
      <div className="browser-controls">
        <input
          type="text"
          className="input"
          placeholder="Buscar jogos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="text"
          className="input server-input"
          placeholder="http://IP-DO-SERVIDOR:3000"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => fetchGames(serverUrl)}
          disabled={gamesLoading}
        >
          {gamesLoading ? <span className="spinner spinner-sm" /> : 'Conectar'}
        </button>
      </div>

      {gamesError && (
        <div className="browser-error">
          <span className="badge badge-danger">Erro</span>
          <span>{gamesError}</span>
          <span className="browser-error-hint">
            Verifique se o servidor backend está rodando e acessível na rede.
          </span>
        </div>
      )}

      {gamesLoading && (
        <div className="browser-empty">
          <span className="spinner" />
          <p>Indexando jogos do servidor...</p>
        </div>
      )}

      {!gamesLoading && filteredGames.length === 0 && !gamesError && (
        <div className="browser-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <p>{search ? 'Nenhum jogo corresponde à busca' : 'Nenhum jogo encontrado no servidor'}</p>
          <span className="browser-empty-hint">
            Coloque arquivos .bin/.iso na pasta configurada no backend (GAMES_DIR)
          </span>
        </div>
      )}

      <div className="game-grid">
        {filteredGames.map((game) => (
          <button
            key={game.id}
            className="game-card"
            onClick={() => handleLoad(game.id, game.name)}
            disabled={disabled || loadingGame !== null}
          >
            <div className="game-card-cover">
              {loadingGame === game.id ? (
                <span className="spinner" />
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              )}
            </div>
            <div className="game-card-info">
              <span className="game-card-name" title={game.name}>{game.name}</span>
              <div className="game-card-meta">
                <span className="badge badge-info">{game.extension.replace('.', '').toUpperCase()}</span>
                <span className="game-card-size">{game.sizeFormatted}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <style>{`
        .game-browser { display: flex; flex-direction: column; gap: var(--space-md); height: 100%; }

        .browser-controls {
          display: grid;
          grid-template-columns: 1fr 1fr auto;
          gap: var(--space-sm);
          align-items: center;
        }

        .server-input { font-size: 12px; }

        .browser-error {
          display: flex;
          flex-direction: column;
          gap: var(--space-xs);
          padding: var(--space-md);
          background: rgba(255, 46, 99, 0.08);
          border: 1px solid rgba(255, 46, 99, 0.3);
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .browser-error-hint { color: var(--text-muted); font-size: 12px; }

        .browser-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          padding: var(--space-xl);
          color: var(--text-muted);
          text-align: center;
          min-height: 200px;
        }

        .browser-empty-hint { font-size: 12px; }

        .game-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: var(--space-md);
          overflow-y: auto;
          padding-right: var(--space-xs);
          flex: 1;
        }

        .game-card {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
          padding: var(--space-sm);
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-fast);
          text-align: left;
        }

        .game-card:hover:not(:disabled) {
          border-color: var(--accent-primary);
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .game-card:disabled { opacity: 0.6; cursor: not-allowed; }

        .game-card-cover {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1;
          background: var(--bg-secondary);
          border-radius: var(--radius-sm);
          color: var(--accent-primary);
        }

        .game-card-info { display: flex; flex-direction: column; gap: var(--space-xs); }

        .game-card-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .game-card-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-xs);
        }

        .game-card-size { font-size: 11px; color: var(--text-muted); }
      `}</style>
    </div>
  );
}

export default GameBrowser;