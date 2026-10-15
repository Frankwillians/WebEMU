/**
 * Servidor WebSocket de Sinalização + Lobby para Netplay
 *
 * Responsabilidades:
 *   1. Sinalização WebRTC (offer/answer/ice-candidate) entre os jogadores de
 *      uma mesma sala — o vídeo/áudio/inputs vão P2P, direto entre os navegadores.
 *   2. Lobby: lista de salas abertas (para os outros jogadores entrarem).
 *   3. Chat simples por sala.
 *
 * O servidor NÃO emula nada: quem emula e transmite a imagem é o host.
 */

import { WebSocketServer, WebSocket } from 'ws';

const MessageType = {
  JOIN: 'join',
  LEAVE: 'leave',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  PEER_LIST: 'peer-list',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  ERROR: 'error',
  READY: 'ready',
  SYNC_REQUEST: 'sync-request',
  SYNC_RESPONSE: 'sync-response',
  // Lobby / sala
  LOBBY_SUBSCRIBE: 'lobby-subscribe',
  LOBBY_UNSUBSCRIBE: 'lobby-unsubscribe',
  ROOM_LIST: 'room-list',
  ROOM_UPDATE: 'room-update',
  ROOM_CLOSED: 'room-closed',
  HOST_CHANGED: 'host-changed',
  CHAT: 'chat',
  KICK: 'kick',
  KICKED: 'kicked'
};

const MAX_PLAYERS_DEFAULT = 4;

/** roomId -> { id, meta, peers: Map<peerId, peer> } */
const rooms = new Map();
/** Sockets que estão olhando o lobby */
const lobbyWatchers = new Set();

function now() { return Date.now(); }

/** Alfabeto do código da sala — sem caracteres ambíguos (o convidado digita à mão). */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 5;

/** Sorteia um código que ainda NÃO existe: o código da sala é único. */
function generateRoomCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length));
    }
    if (!rooms.has(code)) return code;
  }
  return '';
}

/** Metadados sem a senha (pode ir para outros jogadores) */
function metaPublic(room) {
  const { password, ...rest } = room.meta;
  return { ...rest, hasPassword: !!password };
}

/** Lista dos peers da sala exceto um (para montar a peer-list de cada um) */
function peersExcept(room, peerId) {
  const peers = [];
  for (const [id, p] of room.peers) {
    if (id === peerId) continue;
    peers.push({
      id: p.id,
      playerIndex: p.playerIndex,
      ready: p.ready,
      name: p.metadata.name,
      metadata: p.metadata
    });
  }
  return peers;
}

/** (Re)envia a peer-list a TODOS da sala — usado quando o host muda */
function broadcastPeerList(room) {
  for (const [id, peer] of room.peers) {
    send(peer.ws, {
      type: MessageType.PEER_LIST,
      payload: {
        peers: peersExcept(room, id),
        yourId: id,
        yourPlayerIndex: peer.playerIndex,
        metadata: metaPublic(room),
        room: roomSummary(room)
      }
    });
  }
}

function roomSummary(room) {
  return {
    roomId: room.id,
    name: room.meta.name || room.id,
    system: room.meta.system || '',
    systemName: room.meta.systemName || '',
    gameName: room.meta.gameName || '',
    host: room.meta.host || '',
    players: room.peers.size,
    maxPlayers: room.meta.maxPlayers || MAX_PLAYERS_DEFAULT,
    hasPassword: !!room.meta.password,
    started: !!room.meta.started,
    createdAt: room.meta.createdAt || 0
  };
}

function publicRoomSummaries() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.meta.public === false) continue;
    list.push(roomSummary(room));
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws, message) {
  send(ws, { type: MessageType.ERROR, payload: { message } });
}

/** Envia um objeto para todos os hosts do lobby */
function broadcastLobby() {
  if (!lobbyWatchers.size) return;
  const data = JSON.stringify({ type: MessageType.ROOM_LIST, payload: { rooms: publicRoomSummaries() } });
  for (const ws of lobbyWatchers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

/** Envia para todos os peers da sala (menos um, se informado) */
function broadcastRoom(room, message, excludePeerId = null) {
  const data = JSON.stringify(message);
  for (const [id, peer] of room.peers) {
    if (id !== excludePeerId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  }
}

function mergeMeta(room, meta) {
  if (!meta || typeof meta !== 'object') return;
  const allowed = ['name', 'system', 'systemName', 'gameName', 'gameUrl', 'host', 'maxPlayers', 'locked', 'password', 'started', 'public'];
  for (const key of allowed) {
    if (key in meta) room.meta[key] = meta[key];
  }
  room.meta.updatedAt = now();
}

/** Remove um peer da sala e avisa os demais */
function removePeer(room, peer) {
  if (!room || !room.peers.has(peer.id)) return;
  const wasHost = peer.playerIndex === 0;
  room.peers.delete(peer.id);

  broadcastRoom(room, {
    type: MessageType.PEER_LEFT,
    payload: { id: peer.id, playerIndex: peer.playerIndex, wasHost }
  });

  if (room.peers.size === 0) {
    rooms.delete(room.id);
    console.log(`[SIGNALING] Sala ${room.id} removida (vazia)`);
  } else if (wasHost) {
    // O host saiu: a sala NÃO acaba — passa a vez para outro jogador
    // (o de menor playerIndex, ou seja, quem entrou antes).
    const restantes = [...room.peers.values()].sort((a, b) => a.playerIndex - b.playerIndex);
    const novoHost = restantes[0] || null;
    if (novoHost) {
      novoHost.playerIndex = 0;
      // Os metadados da sala passam a ser do novo host.
      room.meta.host = (novoHost.metadata && novoHost.metadata.name) || `Jogador 1`;
      room.meta.updatedAt = now();
      console.log(`[SIGNALING] Sala ${room.id}: host agora é ${novoHost.id} (${room.meta.host})`);
    }
    // Todo mundo recebe a lista nova (com o novo host como jogador 1) e o aviso.
    broadcastPeerList(room);
    broadcastRoom(room, {
      type: MessageType.HOST_CHANGED,
      payload: {
        roomId: room.id,
        hostId: novoHost ? novoHost.id : null,
        hostName: room.meta.host
      }
    });
    broadcastRoom(room, {
      type: MessageType.ROOM_UPDATE,
      payload: { metadata: metaPublic(room), summary: roomSummary(room) }
    });
  }

  broadcastLobby();
}

export function setupSignalingServer(server, path) {
  const wsPath = path || '/signaling';
  const wss = new WebSocketServer({ server, path: wsPath });
  console.log(`[SIGNALING] Servidor WebSocket (sinalização + lobby) em ${wsPath}`);

  attachSignaling(wss);
}

/**
 * Anexa o lobby/sinalização a um WebSocketServer JÁ criado.
 * Usado pela Vercel (api/ws.js): a função serverless exporta um http.Server com
 * o WebSocketServer montado, e a Vercel roteia as conexões até ele.
 */
export function attachSignaling(wss) {
  console.log('[SIGNALING] Lobby/sinalização anexado');

  wss.on('connection', (ws, req) => {
    const peerId = `peer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    // IP do cliente (pode vir atrás de proxy/ngrok — pega x-forwarded-for se houver)
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    let currentPeer = null;
    let currentRoomId = null;

    console.log(`[SIGNALING] Conexão: ${peerId} de ${clientIp}`);

    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendError(ws, 'Mensagem inválida (JSON)');
        return;
      }
      try {
        handleMessage(message);
      } catch (error) {
        console.error('[SIGNALING] Erro ao tratar mensagem:', error.message);
        sendError(ws, 'Erro interno');
      }
    });

    ws.on('close', () => {
      lobbyWatchers.delete(ws);
      // Só remove o peer se ESTE socket ainda for o dono dele. Numa retomada de
      // sessão o peer é reaproveitado por outra conexão; sem esta guarda, o
      // fechamento da conexão antiga derrubaria a sessão nova.
      if (currentPeer && currentRoomId && currentPeer.ws === ws) {
        removePeer(rooms.get(currentRoomId), currentPeer);
      }
      currentPeer = null;
      currentRoomId = null;
    });

    ws.on('error', (error) => {
      console.error(`[SIGNALING] Erro na conexão ${peerId}:`, error.message);
    });

    function leaveRoom() {
      if (currentPeer && currentRoomId && currentPeer.ws === ws) {
        removePeer(rooms.get(currentRoomId), currentPeer);
      }
      currentPeer = null;
      currentRoomId = null;
    }

    function handleMessage(message) {
      switch (message.type) {
        case MessageType.LOBBY_SUBSCRIBE:
          lobbyWatchers.add(ws);
          send(ws, { type: MessageType.ROOM_LIST, payload: { rooms: publicRoomSummaries() } });
          break;

        case MessageType.LOBBY_UNSUBSCRIBE:
          lobbyWatchers.delete(ws);
          break;

        case MessageType.JOIN:
          joinRoom(message);
          break;

        case MessageType.LEAVE:
          leaveRoom();
          break;

        case MessageType.ROOM_UPDATE:
          updateRoom(message);
          break;

        case MessageType.CHAT:
          relayChat(message);
          break;

        case MessageType.KICK:
          kickPeer(message);
          break;

        case MessageType.OFFER:
        case MessageType.ANSWER:
        case MessageType.ICE_CANDIDATE:
        case MessageType.SYNC_REQUEST:
        case MessageType.SYNC_RESPONSE:
          relaySignal(message);
          break;

        case MessageType.READY:
          markReady();
          break;

        default:
          sendError(ws, `Tipo desconhecido: ${message.type}`);
      }
    }

    function joinRoom(message) {
      const payload = message.payload || {};
      const metadata = (payload.metadata && typeof payload.metadata === 'object') ? payload.metadata : {};
      // Criar sala é uma AÇÃO EXPLÍCITA (`create`) — só `npCreateRoom` a envia.
      // Entrar exige que a sala JÁ exista: antes, qualquer `join` criava a sala
      // quando o código não existia, então digitar um código qualquer "abria"
      // uma sala nova e ainda fazia do digitador o host.
      const create = payload.create === true;
      let roomId = String(payload.roomId || '').trim().toUpperCase();

      if (create) {
        // Código ÚNICO: se o proposto já está em uso (ou veio vazio), o servidor
        // sorteia outro — o definitivo volta para o cliente no peer-list.
        if (!roomId || rooms.has(roomId)) roomId = generateRoomCode();
        if (!roomId) { sendError(ws, 'Não foi possível gerar um código de sala'); return; }
      } else {
        if (!roomId) { sendError(ws, 'roomId é obrigatório'); return; }
        if (!rooms.has(roomId)) { sendError(ws, 'Sala não encontrada'); return; }
      }

      let room = rooms.get(roomId);
      if (!room) {
        room = { id: roomId, meta: { public: true, maxPlayers: MAX_PLAYERS_DEFAULT, createdAt: now() }, peers: new Map() };
        rooms.set(roomId, room);
        console.log(`[SIGNALING] Sala criada: ${roomId}`);
      }

      if (room.meta.password && String(room.meta.password) !== String(payload.password || '')) {
        sendError(ws, 'Senha incorreta');
        return;
      }

      const maxPlayers = room.meta.maxPlayers || MAX_PLAYERS_DEFAULT;
      if (room.peers.size >= maxPlayers) {
        sendError(ws, 'Sala cheia');
        return;
      }

      // Sessão por token (mesmo navegador = mesmo jogador). O token vive em
      // localStorage, portanto é o MESMO entre abas/janelas do mesmo navegador.
      const sessionToken = payload.sessionToken ? String(payload.sessionToken).trim() : '';
      if (sessionToken) {
        for (const [existingPeerId, existingPeer] of room.peers) {
          if (existingPeer.sessionToken === sessionToken) {
            // Se o peer ainda está conectado, é OUTRA ABA/JANELA do mesmo
            // navegador. Recusamos: não criamos um jogador extra e não roubamos o
            // WebSocket (senão uma aba derrubaria a outra). Um navegador = um jogador.
            if (existingPeer.ws && existingPeer.ws.readyState === WebSocket.OPEN) {
              console.log(`[SIGNALING] Sessão ${sessionToken} já ativa em ${roomId} — aba duplicada recusada`);
              sendError(ws, 'Você já está nesta sala em outra aba/janela deste navegador.');
              return;
            }
            // Peer saiu de verdade (ws fechado) — retoma a MESMA sessão
            // (mesmo playerIndex), sem criar um jogador novo.
            console.log(`[SIGNALING] Reconexão: ${existingPeerId} (player ${existingPeer.playerIndex + 1}) token=${sessionToken}`);
            existingPeer.ws = ws;
            existingPeer.ip = clientIp; // atualiza IP se mudou
            currentPeer = existingPeer;
            currentRoomId = roomId;
            // Responde com peer-list atualizada (mesmo formato do join normal)
            const peers = peersExcept(room, existingPeerId);
            send(ws, {
              type: MessageType.PEER_LIST,
              payload: {
                peers,
                yourId: existingPeerId,
                yourPlayerIndex: existingPeer.playerIndex,
                metadata: metaPublic(room),
                room: roomSummary(room),
                resumed: true // flag para o frontend saber que é retomada
              }
            });
            // Avisa os outros da sala que este jogador voltou
            broadcastRoom(room, {
              type: MessageType.PEER_JOINED,
              payload: {
                id: existingPeerId,
                playerIndex: existingPeer.playerIndex,
                name: existingPeer.metadata.name
              }
            }, existingPeerId);
            return;
          }
        }
      }

      // Impede duas conexões do mesmo IP na mesma sala (evita "clone" do host)
      // Só aplica se NÃO for reconexão por token (tokens diferentes = pessoas diferentes)
      if (!sessionToken) {
        for (const [, existingPeer] of room.peers) {
          if (existingPeer.ip === clientIp && existingPeer.id !== peerId) {
            sendError(ws, 'Já existe um jogador com este IP na sala');
            return;
          }
        }
      }

      // Sai de uma sala anterior, se houver
      leaveRoom();

      // Escolhe o índice do jogador
      const used = new Set([...room.peers.values()].map((p) => p.playerIndex));
      let playerIndex = null;
      if (Number.isInteger(payload.playerIndex) && payload.playerIndex >= 0 && payload.playerIndex < maxPlayers && !used.has(payload.playerIndex)) {
        playerIndex = payload.playerIndex;
      }
      if (playerIndex === null) {
        for (let i = 0; i < maxPlayers; i++) {
          if (!used.has(i)) { playerIndex = i; break; }
        }
      }
      if (playerIndex === null) { sendError(ws, 'Sala cheia'); return; }

      const peer = {
        id: peerId,
        ws,
        roomId,
        playerIndex,
        ready: false,
        ip: clientIp,
        sessionToken, // token para reconexão do mesmo navegador
        metadata: { name: metadata.name || `Jogador ${playerIndex + 1}`, ...metadata },
        joinedAt: now()
      };
      room.peers.set(peerId, peer);
      currentPeer = peer;
      currentRoomId = roomId;

      // O host (índice 0) define os metadados da sala.
      if (playerIndex === 0) {
        mergeMeta(room, metadata);
        // A senha vem em payload.password (não no metadata público).
        if (payload.password !== undefined) room.meta.password = String(payload.password || '');
      }

      const peers = peersExcept(room, peerId);

      send(ws, {
        type: MessageType.PEER_LIST,
        payload: {
          peers,
          yourId: peerId,
          yourPlayerIndex: playerIndex,
          metadata: metaPublic(room),
          room: roomSummary(room)
        }
      });

      broadcastRoom(room, {
        type: MessageType.PEER_JOINED,
        payload: { id: peerId, playerIndex, name: peer.metadata.name, metadata: peer.metadata }
      }, peerId);

      broadcastRoom(room, {
        type: MessageType.ROOM_UPDATE,
        payload: { metadata: metaPublic(room), summary: roomSummary(room) }
      }, peerId);

      broadcastLobby();
      console.log(`[SIGNALING] ${peerId} entrou em ${roomId} como jogador ${playerIndex}`);
    }

    function updateRoom(message) {
      if (!currentPeer || !currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      if (currentPeer.playerIndex !== 0) {
        sendError(ws, 'Apenas o host pode alterar a sala');
        return;
      }
      mergeMeta(room, message.payload && message.payload.metadata);
      broadcastRoom(room, {
        type: MessageType.ROOM_UPDATE,
        payload: { metadata: metaPublic(room), summary: roomSummary(room) }
      });
      broadcastLobby();
    }

    function relayChat(message) {
      if (!currentPeer || !currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const text = String((message.payload && message.payload.text) || '').slice(0, 300).trim();
      if (!text) return;
      broadcastRoom(room, {
        type: MessageType.CHAT,
        payload: {
          from: currentPeer.id,
          playerIndex: currentPeer.playerIndex,
          name: currentPeer.metadata.name,
          text,
          at: now()
        }
      });
    }

    function kickPeer(message) {
      if (!currentPeer || !currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      if (currentPeer.playerIndex !== 0) return;
      const target = message.targetId ? room.peers.get(message.targetId) : null;
      if (!target) return;
      send(target.ws, { type: MessageType.KICKED, payload: { roomId: room.id } });
      removePeer(room, target);
    }

    function relaySignal(message) {
      if (!currentPeer || !currentRoomId) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;
      const target = message.targetId ? room.peers.get(message.targetId) : null;
      if (!target) return;
      send(target.ws, {
        type: message.type,
        payload: { ...(message.payload || {}), fromId: currentPeer.id, fromPlayerIndex: currentPeer.playerIndex }
      });
    }

    function markReady() {
      if (!currentPeer || !currentRoomId) return;
      currentPeer.ready = true;
      broadcastRoom(currentRoomId ? rooms.get(currentRoomId) : null, {
        type: MessageType.READY,
        payload: { id: currentPeer.id, ready: true }
      }, currentPeer.id);
    }
  });

  // Limpeza periódica de conexões mortas
  setInterval(() => {
    for (const room of [...rooms.values()]) {
      for (const peer of [...room.peers.values()]) {
        if (peer.ws.readyState !== WebSocket.OPEN) {
          console.log(`[SIGNALING] Removendo peer morto: ${peer.id}`);
          removePeer(room, peer);
        }
      }
    }
  }, 30000);

  return wss;
}

export default setupSignalingServer;
