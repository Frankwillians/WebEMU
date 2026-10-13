/**
 * NetplayLobby - Lobby de multiplayer (host/join)
 */

import { useState } from 'react';
import { useStore } from '../store';

interface NetplayLobbyProps {
  onHost: (roomId: string) => Promise<boolean>;
  onJoin: (roomId: string) => Promise<boolean>;
  onDisconnect: () => void;
}

export function NetplayLobby({ onHost, onJoin, onDisconnect }: NetplayLobbyProps) {
  const [roomId, setRoomId] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const { netplayStatus, netplayPeers, netplayPlayerIndex, netplayRoomId, addToast } = useStore();

  const generateRoomId = () => {
    const id = `ps1-${Math.random().toString(36).substring(2, 8)}`;
    setRoomId(id);
  };

  const handleHost = async () => {
    if (!roomId.trim()) {
      addToast('warning', 'Digite um ID de sala ou gere um aleatório');
      return;
    }
    setIsWorking(true);
    await onHost(roomId.trim());
    setIsWorking(false);
  };

  const handleJoin = async () => {
    if (!roomId.trim()) {
      addToast('warning', 'Digite o ID da sala para entrar');
      return;
    }
    setIsWorking(true);
    await onJoin(roomId.trim());
    setIsWorking(false);
  };

  const isActive = netplayStatus !== 'idle' && netplayStatus !== 'error';

  return (
    <div className="netplay-lobby">
      {!isActive ? (
        <>
          <div className="lobby-intro">
            <h3>Multiplayer em Rede</h3>
            <p>Jogue com outro jogador na sua rede local via conexão P2P (WebRTC).</p>
          </div>

          <div className="lobby-input-group">
            <label className="lobby-label">ID da Sala</label>
            <div className="lobby-input-row">
              <input
                type="text"
                className="input"
                placeholder="ex: ps1-abc123"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
              <button className="btn btn-secondary btn-sm" onClick={generateRoomId} title="Gerar ID aleatório">
                🎲
              </button>
            </div>
          </div>

          <div className="lobby-actions">
            <button className="btn btn-primary" onClick={handleHost} disabled={isWorking}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              Criar Sala (Host)
            </button>
            <button className="btn btn-secondary" onClick={handleJoin} disabled={isWorking}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Entrar na Sala
            </button>
          </div>
        </>
      ) : (
        <div className="lobby-active">
          <div className="lobby-active-header">
            <span className={`status-dot ${netplayStatus === 'connected' ? 'active' : ''}`} />
            <div>
              <span className="lobby-room-name">Sala: {netplayRoomId}</span>
              <span className="lobby-role">
                Você é o <strong>Player {netplayPlayerIndex + 1}</strong>
                {netplayStatus === 'hosting' && ' (Host)'}
              </span>
            </div>
          </div>

          <div className="lobby-status-box">
            <span className="lobby-status-label">Status</span>
            <span className={`badge ${netplayStatus === 'connected' ? 'badge-success' : 'badge-warning'}`}>
              {netplayStatus === 'connecting' ? 'Conectando...' :
               netplayStatus === 'hosting' ? 'Aguardando jogador...' :
               netplayStatus === 'connected' ? 'Conectado' : netplayStatus}
            </span>
          </div>

          {netplayStatus === 'hosting' && (
            <div className="lobby-hint-box">
              <strong>Compartilhe o ID da sala:</strong>
              <code className="lobby-room-code">{netplayRoomId}</code>
              <span className="lobby-hint-text">
                O outro jogador deve abrir este site no mesmo PC/rede e usar "Entrar na Sala".
              </span>
            </div>
          )}

          <div className="lobby-players">
            <span className="lobby-players-title">Jogadores ({netplayPeers.filter(p => p.connected).length + 1}/2)</span>
            <div className="lobby-player-list">
              <div className="lobby-player">
                <span className="player-indicator player-self" />
                <span>Player {netplayPlayerIndex + 1} (você)</span>
              </div>
              {netplayPeers.map((peer) => (
                <div key={peer.id} className="lobby-player">
                  <span className={`player-indicator ${peer.connected ? 'player-connected' : 'player-waiting'}`} />
                  <span>Player {peer.playerIndex + 1}</span>
                  {peer.connected && <span className="badge badge-success">P2P</span>}
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn-danger" onClick={onDisconnect}>
            Desconectar
          </button>
        </div>
      )}

      <style>{`
        .netplay-lobby { display: flex; flex-direction: column; gap: var(--space-md); }
        .lobby-intro h3 { font-size: 16px; margin-bottom: var(--space-xs); }
        .lobby-intro p { font-size: 13px; color: var(--text-secondary); }
        .lobby-input-group { display: flex; flex-direction: column; gap: var(--space-xs); }
        .lobby-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .lobby-input-row { display: flex; gap: var(--space-xs); }
        .lobby-actions { display: flex; flex-direction: column; gap: var(--space-sm); }
        .lobby-actions .btn { justify-content: flex-start; }

        .lobby-active { display: flex; flex-direction: column; gap: var(--space-md); }
        .lobby-active-header { display: flex; align-items: center; gap: var(--space-sm); }
        .lobby-room-name { display: block; font-size: 15px; font-weight: 600; }
        .lobby-role { display: block; font-size: 12px; color: var(--text-muted); }

        .lobby-status-box { display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm) var(--space-md); background: var(--bg-card); border-radius: var(--radius-md); }
        .lobby-status-label { font-size: 13px; color: var(--text-secondary); }

        .lobby-hint-box { display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-md); background: rgba(0, 217, 255, 0.05); border: 1px solid rgba(0, 217, 255, 0.2); border-radius: var(--radius-md); font-size: 13px; }
        .lobby-room-code { font-family: monospace; font-size: 16px; color: var(--accent-primary); background: var(--bg-secondary); padding: var(--space-xs) var(--space-sm); border-radius: var(--radius-sm); text-align: center; }
        .lobby-hint-text { font-size: 12px; color: var(--text-muted); }

        .lobby-players { display: flex; flex-direction: column; gap: var(--space-sm); }
        .lobby-players-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
        .lobby-player-list { display: flex; flex-direction: column; gap: var(--space-xs); }
        .lobby-player { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); background: var(--bg-card); border-radius: var(--radius-sm); font-size: 13px; }
        .player-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
        .player-indicator.player-self { background: var(--accent-primary); }
        .player-indicator.player-connected { background: var(--accent-tertiary); box-shadow: 0 0 8px var(--accent-tertiary); }
        .player-indicator.player-waiting { background: var(--accent-warning); animation: pulse 1.5s infinite; }
      `}</style>
    </div>
  );
}

export default NetplayLobby;