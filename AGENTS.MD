# AGENTS.md — WebEMU (Central de Emulação)

> **Leia este arquivo antes de qualquer mudança.** Ele é o contrato de trabalho
> para agentes de IA e desenvolvedores que contribuem com o **WebEMU**
> (repo: `Frankwillians/WebEMU`, pasta local `ps1emu`).
>
> Idioma do projeto: **português** (comentários, mensagens de commit, UI e
> respostas ao usuário).

---

## 0. TL;DR para agentes

- O produto real é **`frontend/public/play.html`** — uma página **vanilla JS**
  (sem build) que emula **29 consoles** no navegador via **EmulatorJS (WASM)**.
- O **`frontend/src/`** (React + Vite + TS) é **legado/experimental**. Não é o
  caminho de jogo. Não gaste esforço "consertando" o React sem pedido explícito.
- O backend é **`src/backend/`** (Express + `ws`), ESM, com paths resolvidos a
  partir da **raiz do projeto**.
- Deploy: **Vercel** estático (`public/`) + funções serverless em `api/`.
- **Nunca** versione ROMs/ISOs/BIOS. Use apenas conteúdo que o usuário possui.
- Rode o validador antes de commitar: checks de sintaxe + validador local (ver §11).
- Commits: **Conventional Commits em português**, um assunto por commit.

---

## 0.5 Princípios de engenharia (obrigatórios)

Estas regras valem para **toda** mudança, sem exceção. Em caso de dúvida entre
duas soluções, escolha a que respeita estes princípios.

1. **Não preserve compatibilidade retroativa.** Remova caminhos obsoletos em vez
   de adicionar camadas de compatibilidade, *fallbacks* ou migrações.
2. **Escolha a implementação mais simples que atenda por completo aos requisitos
   atuais.** Evite abstrações especulativas, configuração e indireção.
3. **Cresça o sistema em camadas.** Comece pela menor versão que funciona de
   ponta a ponta e adicione cada nova capacidade sobre um produto que **já
   funciona**. Nunca troque um produto que funciona por complexidade inacabada.
4. **Mantenha os componentes modulares e as responsabilidades claramente
   separadas.**
5. **Prefira bibliotecas consolidadas e bem mantidas** quando elas reduzem a
   complexidade total ou aumentam a confiabilidade. Não reimplemente
   funcionalidades comuns sem um motivo claro.
6. **Apoie-se nas dependências que o projeto já tem** antes de escrever a sua
   própria implementação ou adicionar pacotes. Não presuma que uma biblioteca não
   tem uma capacidade sem antes checar a documentação e os tipos.
7. **Tome decisões arquiteturais pensando no longo prazo.** Não aceite um
   paliativo que só funciona agora e que já nasce para ser substituído depois.

> As "invariantes que não se regridem" do §9 são **requisitos atuais**, não
> legado — mantê-las é compatível com o princípio 1.

---

## 1. Visão geral

**WebEMU** é uma **Central de Emulação** multi-console que roda **no navegador**
(WASM via [EmulatorJS](https://emulatorjs.org)) e também pode delegar ao
**RetroArch nativo** do "PC servidor". Uma única página (`/play.html`) traz
**seletor de console**, **biblioteca com capas**, **busca por nome**, **coleção
de links salvos** (com backup) e **netplay (LAN e internet)**.

Consoles configurados (29) — definidos em `src/backend/systems.js`:

`ps1`, `ps2`, `psp`, `snes`, `nes`, `n64`, `gb`, `gba`, `nds`, `vb`, `segaMD`,
`segaMS`, `segaGG`, `segaCD`, `sega32x`, `segaSaturn`, `atari2600`, `atari7800`,
`lynx`, `jaguar`, `arcade`, `pce`, `ngp`, `ws`, `3do`, `pcfx`, `c64`, `dos`, `amiga`.

Quatro "motores" de emulação coexistem:

| Motor | Onde roda | Quando |
|-------|-----------|--------|
| **EmulatorJS (LibRetro/WASM)** | No navegador do jogador | Padrão para todos os consoles |
| **RetroArch nativo** | No PC servidor (`POST /api/systems/:id/launch`) | Modo "PC servidor" (mais rápido) |
| **Play! .js (WASM)** | Navegador, página `/ps2/` | PS2 experimental |
| **Builds recompilados** | Navegador, páginas próprias (`recomp/`) | Só 4 títulos (PS2/PSP), gerados localmente |

> ⚠️ O README documenta **por que** a tela ficava preta no core próprio
> (CPU/GPU/SPU em TS): ele **não** boota jogos comerciais. A solução foi adotar
> cores WASM maduros. O React antigo continua como referência.

---

## 2. Stack

- **Runtime:** Node.js **18+**, ESM (`"type": "module"`).
- **Backend:** Express 4, `ws` (WebSocket), `cors`, `mime-types`.
- **Frontend de jogo:** HTML + **vanilla JS** + CSS (um único `play.html`).
- **Legado:** React 18 + Vite + TypeScript + Zustand (`frontend/`).
- **Emulação:** EmulatorJS (WASM), Play! .js (PS2), RetroArch nativo opcional.
- **Rede:** WebRTC (P2P) + WebSocket de sinalização.
- **Deploy:** Vercel (estático + serverless functions).

---

## 3. Estrutura real do repositório

```text
ps1emu/
├── frontend/public/
│   ├── play.html          ⭐ O PRODUTO: hub, player, netplay, controles, tudo aqui
│   ├── ps2/               Play! .js (PS2 experimental) + static/ (css/js)
│   ├── favicon.svg
│   └── standalone.html    Core próprio experimental (legado)
├── frontend/
│   ├── index.html         App React legado
│   └── src/               React legado (core/ TS, netplay/, hooks/, components/)
├── src/backend/           Backend Node (ESM)
│   ├── server.js          HTTP + API REST + estáticos + wiring do signaling
│   ├── signaling.js       WebSocket de sinalização + lobby (salas/senha/chat/kick)
│   ├── systems.js         Catálogo dos 29 consoles (id, nome, cores, extensões)
│   ├── covers.js          Capas: nome→imagem no libretro-thumbnails (exata/aproximada) + rota /api/cover
│   ├── proxy.js           Guarda de SSRF dos proxies (loopback/link-local)
│   ├── storage.js         Indexação de ROMs do disco (PS1, PS2, por sistema)
│   ├── bios.js            Upload/armazenamento de BIOS
│   ├── settings.js        Config persistente (ps1emu.config.json)
│   └── config.js          Portas, diretórios, CORS, extensões
├── api/                   Funções serverless da Vercel
│   ├── [...all].js        Adaptador catch-all que expõe TODO o backend em /api/*
│   ├── ws.js              Endpoint WebSocket do netplay online
│   ├── rom.js             Proxy de ROM (Mixed Content: HTTPS→HTTP + Range)
│   └── cover.js           Capa do jogo na Vercel (mesma lógica de covers.js)
├── scripts/
│   ├── vercel-build.mjs   Copia frontend/public → public/ no deploy
│   └── make-cert.mjs      Gera certs/ (HTTPS local p/ PSP e DOS)
├── bios/  games/  ps2games/  roms/  recomp/   (dados locais; ignorados no git)
├── vercel.json            outputDirectory, rewrites, headers COOP/COEP + CORS
├── ps1emu.config.json     Config local em runtime (ignorado no git)
├── .env.example           Modelo de variáveis de ambiente
├── package.json           Scripts e dependências do backend
├── SKILL.md               Skill do projeto (guia de desenvolvimento)
└── AGENTS.md              Este arquivo
```

> **Regra de ouro:** quase toda a lógica de jogo/rede do cliente vive em
> **`frontend/public/play.html`**. É um arquivo grande (~160 KB) e **sem build**:
> o que você edita é o que roda.

---

## 4. Comandos

```bash
npm install              # dependências do backend
npm run build            # compila o React legado (referência; NÃO é servido)
npm start                # sobe o backend em http://localhost:3000
npm run dev              # backend (watch) + frontend React (vite) em paralelo
npm run cert             # gera certs/ p/ HTTPS local (PSP/DOS precisam)
node scripts/vercel-build.mjs   # gera a saída estática public/
```

Deploy (site estático + funções):

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # produção
```

> O projeto Vercel correto é **`web-emu`** → `https://web-emu.vercel.app`.
> (`webemu.vercel.app` e `webemu-pet-dog-tag.vercel.app` dão 404.)
> Branch de trabalho: **`master`**.

**Dica de teste local rápido** (servidor alternativo na porta 3999):

```powershell
$env:HTTP_PORT="3999"; node src/backend/server.js
```

---

## 5. Variáveis de ambiente

Definidas em `src/backend/config.js` (lidas do ambiente / `.env`):

| Variável | Padrão | Efeito |
|----------|--------|--------|
| `HTTP_PORT` | `3000` | Porta HTTP (API + estáticos) |
| `HTTPS_PORT` | `3443` | Porta HTTPS (só sobe se houver `certs/`) |
| `GAMES_DIR` | `<raiz>/games` | Pasta de ROMs/ISOs de PS1 |
| `BIOS_DIR` | `<raiz>/bios` | Pasta de BIOS |
| `PS2_DIR` | `<raiz>/ps2games` | Pasta de ISOs de PS2 |
| `SYSTEMS_ROOT` | `<raiz>/roms` | Raiz das pastas por console (`roms/snes`, …) |
| `RECOMP_DIR` | `<raiz>/recomp` | Builds recompilados PS2/PSP |
| `PSP_DISC_DIR` | `<raiz>/recomp/psp/disc` | Disco extraído do PSP (servido em `/disc`) |
| `RETROARCH_PATH` | vazio | Caminho do RetroArch (auto-detecta se vazio) |
| `CORS_ORIGIN` | `*` | Origens permitidas |
| `LOG_LEVEL` | `info` | `info` \| `debug` |

Do netplay:

| Variável | Efeito |
|----------|--------|
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN próprio p/ WebRTC (padrão: TURN público gratuito) |
| `PUBLIC_URL` | URL pública (ex.: túnel HTTPS que você subiu) usada nos **links de convite** |
| `ACCESS_TOKEN` | Token opcional p/ proteger a API e o sinalizador |
| `NETPLAY_WS=0` | **Desliga** a opção 🌐 Online (Vercel) |

---

## 6. Arquitetura

### 6.1 Fluxo do jogo (navegador)

```
/play.html  ──► GET /api/systems            (lista consoles + contagem)
            ──► GET /api/systems/:id/games  (biblioteca indexada)
            ──► GET /api/cover?system=&name= (capa no libretro-thumbnails, exata/aproximada)
            ──► GET /roms/:systemId/<arquivo>            (ROM local, Range)
             ou  GET /api/rom?url=…                      (ROM por URL, proxy CORS)
            ──► EmulatorJS carrega o core WASM no navegador
            ──► canvas + Web Audio (áudio liberado no 1º clique)
```

O PC servidor ainda pode **abrir o jogo no RetroArch nativo** via
`POST /api/systems/:id/launch`.

### 6.2 Netplay (WebRTC P2P)

```
Sinalização da sala: WebSocket  (LAN: /signaling | Online: /api/ws)
Mídia e inputs:    WebRTC (P2P) — o HOST emula e transmite; convidados só mandam input
```

- O **host** emula, captura `canvas.captureStream(30)` + áudio e envia vídeo/áudio
  por WebRTC. Os **convidados** recebem o vídeo e devolvem os comandos (data channel).
- Convidado **não precisa da ROM**.
- **Inputs** chegam ao host e são aplicados via
  `gameManager.functions.simulateInput(player, retroArchIndex, value)`.
- ICE/STUN/TURN vêm de `GET /api/ice` (rota de **um** segmento, para funcionar
  também na função da Vercel — multi-segmento não chega lá).

### 6.3 Deploy (Vercel)

- `outputDirectory: public` (cópia de `frontend/public` feita no build).
- `api/[...all].js` expõe o backend Express em `/api/*` (com *smart-join* do
  `req.query['...all']`, caso a Vercel entregue o resto do caminho como query).
- **Atenção (verificado em produção):** no site publicado só chegam à função as
  rotas de **um segmento** (`/api/systems`, `/api/health`, `/api/config`, `/api/ice`…);
  as de vários segmentos (`/api/systems/:id/games`, `/api/rom?…` é um segmento, mas
  `/api/bios/upload`) voltam `NOT_FOUND` **da própria Vercel**. Por isso todo
  recurso que o site precisa tem função/rota de um segmento — a capa é
  `api/cover.js` (`/api/cover`) e o ICE é `/api/ice` (mesmo handler do Express).
- **Como o front evita o 404:** `/api/health` devolve `library` (`true` no Express
  local, `false` na Vercel). Com `library:false` o front **não chama** as rotas de
  disco (`/api/systems/:id/games`, `rescan`, `m3u`, `bios/upload`): mostra um
  aviso e conta só os links salvos. A biblioteca do disco continua vindo do
  backend configurado (`getApiBase()`/`?server=`), não da função da Vercel.
- `vercel.json` aplica **COOP/COEP** em `/` e `/play.html` (necessário para
  `SharedArrayBuffer` e o modo threads do PSP) e CORS/CORP em `/api/rom`,
  `/roms/*`, `/api/systems/*`.
- O servidor de produção serve **apenas o produto**: `play.html` (rotas `/`,
  `/play`, `/play.html`), `/ps2`, `/recomp`, `/disc`, `/bios`, `/roms` e a API.
  O **React (`frontend/src`) é referência de código e não é servido** (o
  *SPA fallback* foi removido).

---

## 7. API (referência)

### Núcleo / jogos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Status + `lanIP`/`lanUrl` + `netplay`/`ws` + `library` (tem disco?) |
| GET | `/api/systems` | Consoles, contagem, modos e BIOS |
| GET | `/api/systems/:id/games` | Jogos do console (indexado do disco) |
| POST | `/api/systems/:id/rescan` | Reindexa a pasta do console |
| POST | `/api/systems/:id/m3u` | Cria playlist `.m3u` (multi-disco) a partir de `{ name, gameIds }` |
| GET | `/api/cover?system=&name=` | Capa do jogo (exata + aproximada no console, com cache) |
| GET | `/api/cover?system=&url=` | Capa manual (proxy da imagem apontada, com guarda anti-SSRF) |
| POST | `/api/systems/:id/launch` | Abre no RetroArch do PC |
| GET | `/roms/:systemId/*` | Arquivos do console (Range) |
| GET | `/api/rom?url=` | Proxy de ROM por URL (CORS + Range) |
| GET | `/api/ice` | Servidores ICE (STUN/TURN) — um segmento (Vercel) |
| GET | `/api/bios` · POST/DELETE `/api/bios` | Gestão de BIOS |
| GET/POST | `/api/config` | Lê/grava pastas (grava em `ps1emu.config.json`) |
| GET | `/api/ps2/games` · POST `/api/ps2/rescan` | Biblioteca de PS2 |
| GET | `/ps2roms/*` | Arquivos de PS2 (Range) |
| GET | `/api/recomp?kind=ps2` | Builds recompilados |
| GET | `/recomp/ps2|psp/<jogo>/*` · `/disc/*` | Estáticos dos builds (COOP/COEP + Range) |
| WS | `/signaling` | Sinalizador + lobby **local** (LAN) |
| WS | `/api/ws` | Sinalizador + lobby **Vercel** (online) |

---

## 8. Convenções de código

### Backend (`src/backend/`, `api/`)

- **ESM** (`import`/`export`); sem CommonJS.
- Caminhos **sempre resolvidos da raiz** via `config.projectRoot` (nunca dependa
  do `cwd`).
- Funções pequenas, nomes em português para domínio e inglês para utilitários.
- Comentários explicam **por quê**, em PT-BR. Não comente o óbvio.
- Trate `Range`, `Range` retomável e stream de arquivos grandes com cuidado.

### Frontend (`frontend/public/play.html`)

- **Vanilla JS**, sem framework, sem build. Mantenha o estilo existente:
  IIFE, `var`, funções `npAlgumaCoisa` para netplay, `el('id')` para DOM.
- **Não introduza bundler nem dependências no `play.html`.**
- Preserve acessibilidade e responsividade (o mobile é cidadão de 1ª classe).
- Estados persistidos em `localStorage` usam o prefixo `ps1emu.` (ex.:
  `ps1emu.session`, `ps1emu.links`); chaves só do netplay usam `np_` (`np_pad`,
  `np_gamepad_idx`, `np_session_token`).
- **Coleção de links salvos:** todo jogo aberto por URL é catalogado por console
  em `localStorage['ps1emu.links']` (`{ [systemId]: [{ url, name, addedAt,
  lastPlayed, cover? }] }`). `saveLink` é idempotente por URL (rejogar não
  duplica) e `renderLinks`/`linkCard` desenham a grade; `playSavedLink` reusa
  `playByUrl`. Fica no cartão **🔗 Links salvos** de cada console, com renomear
  (✏️), capa (🖼) e remover (🗑); esses jogos **somam** na contagem do console
  (`linksCount`/`sysCard`/`games-count`). No mesmo cartão, `exportLinksBackup`
  baixa um JSON com a coleção de **todos os consoles** (incluindo `cover`) e
  `importLinksBackup` restaura (mescla sem duplicar, teto de 100 por console).
- **Capa dos links:** `linkCard` pede a capa por `coverUrlByName(sys, nome)` e
  `coverUrlManual(sys, url)`, que compartilham `coverEndpoint` — sempre na origem
  da própria página (`/api/cover?system=&name=|url=`), inclusive no site
  publicado. O backend (`covers.js`) tenta o nome exato no libretro-thumbnails e,
  se não achar, uma busca **aproximada** dentro daquele console; renomear refaz a
  capa. Se o nome ainda errar, `link.cover` guarda uma **URL manual** (o 🖼).
- Ao mexer em UI, **valide o balanceamento de tags** (ver §11).

### Estilo geral

- Prefira **edits cirúrgicos** a reescrever blocos grandes.
- Mudança de contrato (rota, payload de mensagem, env var) ⇒ atualize **README
  e este AGENTS.md no mesmo commit**.
- Não deixe código morto nem flags experimentais para trás.

---

## 9. Netplay — invariantes e armadilhas (leia antes de mexer)

Mensagens do sinalizador (`src/backend/signaling.js`): `join`, `leave`, `offer`,
`answer`, `ice-candidate`, `peer-list`, `peer-joined`, `peer-left`, `error`,
`ready`, `sync-request/response`, `lobby-subscribe/unsubscribe`, `room-list`,
`room-update`, `room-closed`, `host-changed`, `chat`, `kick`.

**Invariantes que já custaram bugs — não regrida:**

1. **Um jogador = um `playerIndex` estável.** O índice mapeia 1:1 para a **porta
   de controle** no console. Não reordene índices por acaso.
2. **Sessão por token.** O frontend guarda `np_session_token` no `localStorage`, que
   é **compartilhado entre abas do mesmo navegador**, e envia no `join` — inclusive
   ao **criar** sala (`npCreateRoom`). Se o token já está ativo numa conexão aberta,
   o backend **recusa** a nova ("já está em outra aba"): um navegador = um jogador
   (evita clicar 2× no link virar vários jogadores). Se o peer caiu (ws fechado), o
   backend **retoma** a sessão e responde `resumed: true`; aí o frontend não recria
   a view — *exceto* numa página nova (`NP.viewIniciada`), que precisa montá-la.
3. **Anti-clone por IP.** Sem token, dois peers do mesmo IP na mesma sala são
   bloqueados. Com tokens diferentes (máquinas/navegadores distintos), ambos entram.
   O `close`/`leave` só remove o peer se `peer.ws === ws` (uma conexão antiga não
   pode derrubar a sessão retomada).
4. **Stream versionado.** `NP.streamVersion` incrementa a cada captura nova.
   Trocar de jogo = **recriar** peer connections (tracks antigas morrem).
5. **`npHostRecheckStream` tem guard** (`npRecheckBusy`) — nunca deixe rodar dois
   loops de retry concorrentes.
6. **"Aguardando o host" só em `failed`/`closed`** — nunca em `disconnected`
   (que é temporário durante ICE restart/renegociação).
7. **Expulso/reconectar:** ao sair/expulsar o próprio peer, limpe **todo** o
   estado local (`NP.peers`, `roomId`, `remoteStream`, `streamVersion`).
8. **1 controle por pessoa:** cada jogador escolhe o seu gamepad físico
   (`NP_GP.gamepadIndex`, salvo em `localStorage['np_gamepad_idx']`). O loop usa
   **apenas** o gamepad selecionado. `npSendInput(idx, val)` é o **único**
   caminho de input: solo/host aplica local (`simulateInput(NP.myPlayerIndex ||
   0, idx, val)`); convidado envia pela rede com `player: NP.myPlayerIndex`.
   Como o convidado não emula, o mesmo caminho serve para todos.
   - **Controles na tela (`np-pad`) valem em solo, host e convidado.** O
     `npBuildPad` monta um **joystick analógico** (esquerda) + botões (direita),
     mostrado automaticamente em aparelho de toque (`npEhToque()`, persistido em
     `np_pad`). O stick emite **os dois** formatos: analógico esquerdo do
     EmulatorJS (`simulateInput` com os índices 16/17 = X+/X- e 18/19 = Y+/Y-,
     valor 0..32767) **e** o D-pad digital (4=cima, 5=baixo, 6=esquerda,
     7=direita) — assim funciona em **todos** os consoles (os sem analógico usam
     só o digital). O gamepad nativo do EmulatorJS é **escondido por CSS**
     (`.ejs_virtualGamepad_parent`) para não sobrepor nem duplicar toques; os
     índices analógicos seguem a tabela padrão do EmulatorJS (`16..23`).
9. **Dois sinalizadores:** 🏠 LAN (`/signaling`) e 🌐 Online (`/api/ws`). O link de
   convite carrega `?room=`, `?server=` e `?ws=` para o convidado conectar sozinho.
10. **Mixed Content:** em HTTPS (Vercel), ROMs vindas de HTTP local passam por
    proxy (`/api/rom`). Use `precisaProxy()`
    (`location.protocol === 'https:' && /^http:/i.test(getApiBase())`).
    A **capa** não cai nisso: ela é sempre pedida à origem da própria página
    (`/api/cover`), que resolve por nome + console sem tocar no backend local.
    Uma página HTTPS **não** consegue falar direto com API HTTP da LAN
    (`/api/health`, `/api/systems`): o navegador bloqueia. Para
    jogar pelos arquivos do PC, abra o próprio `http://IP:3000/play.html`.
    **Ponte HTTPS↔HTTP (caminhos válidos):** (a) abrir a própria página do PC
    (same-origin); (b) o PC servir **HTTPS** — `npm run cert` gera `certs/` com
    **o IP da LAN no SAN** (senão dá erro de nome) e o servidor sobe `:3443`;
    aí é HTTPS→HTTPS (aceite o certificado autoassinado) — `/api/health`
    devolve `lanHttpsUrl` (para uso em `?server=`); (c) túnel HTTPS
    (`cloudflared`/`ngrok`/Tailscale) — `PUBLIC_URL` nos links de convite;
    (d) `http://localhost:3000` na mesma máquina (isento de Mixed Content).
    Navegador **público→privado** (Vercel→LAN) também exige responder o
    preflight **Private Network Access** com `Access-Control-Allow-Private-Network:
    true` (feito no `server.js`); isso **não** contorna Mixed Content.
    No site publicado (`library:false`, ver §6.3) o front **nem tenta** a
    biblioteca de disco (`/api/systems/:id/games`…): evita o 404 da Vercel. O
    **ICE** é `/api/ice` (um segmento) justamente para o TURN chegar ao navegador
    também na Vercel.
10b. **Base da API (`ps1emu.apiBase`) é STRING crua.** `setApiBase` grava string
    e `getApiBase` lê string (com `normalizarBase` para aceitar `IP:porta`).
    **Nunca** leia essa chave com `readJSON`/`JSON.parse`: era exatamente o bug
    em que a base digitada era ignorada e tudo caía no servidor da própria
    página ("Conectado a https://web-emu.vercel.app").
11. **Ciclo de vida do jogo local.** No boot o site **não** reabre o último jogo
    (abre no seletor, `showHub()`); `🏠 Consoles` **encerra** o núcleo local
    (`npPararTransmissao` + `npDestroyEmulator`), valendo para solo e host — nada
    pode seguir rodando ao fundo.
12. **O "palco" do convidado nunca fica sobre o emulador local.** `showPlayer`
    esconde `#np-stage`; ao virar host, `npAssumirHost()` sai do palco e retoma a
    transmissão (ou volta ao hub se não houver jogo). Sem isso, o host via tela
    preta "Aguardando o host" sobre o próprio jogo.
13. **Recuperação de conexão do convidado.** Se o vídeo do host não chega em ~8 s,
    o vigia (`npStartGuestWatchdog`) envia `sync-request` ao host, que refaz a
    oferta (`npHostOnSyncRequest`) — sem precisar sair/entrar da sala. O host não
    cria ofertas concorrentes (`npHostCreateOffer(force)`).

Painéis da UI: **👥 Jogar em rede** = criar sala / netplay. Não há mais painel de
servidor: para usar os jogos de outra máquina, aponte a base com o parâmetro
**`?server=`** (`localStorage['ps1emu.apiBase']`, string crua). Um túnel HTTPS é
responsabilidade do usuário (`PUBLIC_URL` nos links de convite).

---

## 10. Legal & segurança

- **Nunca** versione ROMs, ISOs ou BIOS (direitos de terceiros). As pastas
  `games/`, `roms/`, `ps2games/*`, `bios/*.bin|rom` e `recomp/*` são ignoradas
  pelo Git por isso.
- Não publique builds recompilados (são tradução do executável do jogo).
- Use apenas conteúdo que o usuário possui legalmente.
- `certs/` contém chave privada — **nunca** versione.
- `ps1emu.config.json` é local — não versione.
- Antes de commitar dados/recursos novos, considere a auditoria de legalidade.

---

## 11. Validação antes de commitar

Fluxo recomendado de verificação (rode sempre antes de commitar):

1. **Sintaxe do backend:**
   ```powershell
   node --check src/backend/signaling.js
   node --check src/backend/server.js
   ```
   > ⚠️ `api/[...all].js` tem colchetes no nome → `node --check` inline no
   > PowerShell quebra. Use `spawnSync`/caminho direto.
2. **Sintaxe do JS inline do `play.html`:** extraia o conteúdo de `<script>` para
   um `.js` temporário e rode `node --check` nele.
3. **Validador de transmissão/HTML:** confira a presença dos trechos críticos
   (stream version, `track ended`, gamepad, vibração) e o **balanceamento de tags
   HTML** (`div`, `section`, `button`).
4. **Teste HTTP** contra o servidor local (`HTTP_PORT=3999`): `/play.html` 200 e
   os trechos servidos.
5. Testes reais de WebRTC exigem **2 navegadores/dispositivos** (não há
   automação/Playwright no ambiente).

**Quirks do ambiente (Windows/PowerShell):**
- `&&`, `tail` e escapes `\"` dentro de `node -e` falham. **Use scripts `.cjs`**.
- `git push` escreve progresso no **stderr** → PowerShell mostra "exited with
  code 1"/NativeCommandError, mas o push **funciona**. Confirme pelo `d0f8107..xxxx`.
- Ruídos inofensivos no console: `Translation not found for …`;
  `Cannot read properties of null (reading 'classList')` (interno do `emulator.min.js`).

---

## 12. Git & commits

- **Conventional Commits em português**, escopo por área.
  Ex.: `fix(netplay-kick-reconnect): …`, `feat(session-resume): …`,
  `feat(gamepad-multiplayer): …`.
- Um assunto lógico por commit; descreva **o que** e **por quê** no corpo quando
  a mudança for sutil (ex.: invariantes de rede).
- Atualize **README.md** e **AGENTS.md** quando mudar contrato/comportamento.
- Branch: **`master`** (`origin` em `Frankwillians/WebEMU`).

---

## 13. Equipe de agentes

Agentes disponíveis neste workspace e o **escopo de cada um neste repo**. Sempre
prefira o especialista; o orquestrador quebra o pedido e roteia. Deixe o
resultado **verificável** (teste/validação) antes de considerar pronto.

| Agente | Papel | Escopo principal neste repo |
|--------|-------|-----------------------------|
| **arquiteto** | Fundação, contratos, convenções, tooling, CI | Estrutura, `config.js`, contratos de API, `vercel.json`, build |
| **nucleo** | Núcleo de emulação (WASM/WASM-núcleos, performance) | Cores EmulatorJS, `systems.js`, otimizações, `--!native`-like tuning |
| **ponte** | Rede/pipe, protocolo, transporte | `signaling.js`, `api/ws.js`, WebRTC, codec de input, medição de banda |
| **sessao** | Sessões/salas, slots de jogador, persistência | Lobby, `playerIndex`, kick/host-churn, token de sessão, save states |
| **tela** | Render/superfície do telão, LOD, orçamento | Canvas, `captureStream`, material CRT, orçamento de render |
| **input** | Mapeamento unificado de entrada | Teclado/gamepad/touch/VR, `NP_GP`, `simulateInput`, latência |
| **pixel** | UI/UX, HUD, lobby, biblioteca, mobile/VR, SFX | `play.html` (CSS/DOM), capas, fluxos, responsividade |
| **mundo** | Ambiente 3D/presença (quando aplicável) | Sala/arcade, assentos, iluminação, streaming |
| **qa** | Qualidade/performance, benchmarks, regressão | Suíte de testes, validador local, detector de regressão, telemetria |
| **auditor** | Legalidade e conformidade | Licenças de terceiros, ToS, varredura de conteúdo protegido |
| **explore** | Exploração rápida de código | Localizar arquivos/símbolos/padrões |
| **general** | Pesquisa e tarefas multi-etapa | Trabalho amplo fora dos especialistas |

> Os nomes de especialistas (`nucleo`, `ponte`, `tela`, `input`, `sessao`,
> `pixel`, `mundo`) também aparecem historicamente como **MIPS / HOST / SYNC /
> PIXEL**. São o mesmo time com nomes atualizados.

### Regras de colaboração

1. **Um dono por arquivo/superfície.** `play.html` é grande — combine antes de
   edições simultâneas; divida por região (CSS, netplay, input, HUD).
2. **Contrato antes de código.** Mudou mensagem/rota/payload? Documente e avise
   o `ponte`/`sessao` (rede/salas) e o consumidor (`pixel`/`input`).
3. **Toda mudança de jogo/persistência passa pelo `auditor`** antes do commit.
4. **`qa` valida** performance e regressão; nenhum PR de rede fecha sem teste.
5. Entregue com **evidência**: saída do validador, antes/depois, passos de reprodução.

---

## 14. Solução de problemas (sintomas → causa provável)

| Sintoma | Causa provável / onde olhar |
|---------|-----------------------------|
| Tela preta em jogos comerciais | Core próprio (TS) não boota; use EmulatorJS. Ver §1 |
| PSP/DOS não iniciam no celular | Falta contexto seguro + COOP/COEP (`npm run cert`, HTTPS) |
| 404 em `/api/systems/:id/games` ao abrir um console no site publicado | A função da Vercel só recebe um segmento; o front agora usa `health.library` e **não chama** rotas de disco quando `false` (mostra aviso + links). Para a biblioteca do PC, abra pelo backend (`?server=`, ver §6.3) |
| Netplay sem TURN no site publicado | O ICE era `/api/netplay/ice` (multi-segmento) → 404. Agora é `/api/ice` (um segmento), servido pelo Express e pela função |
| Capa bloqueada no site publicado | Não deveria: a capa é pedida à própria origem (`/api/cover`) e resolvida só por nome + console |
| ROM por link bloqueada no Vercel | Mixed Content: use `/api/rom` (`precisaProxy()`) |
| Conectar do site HTTPS ao PC da LAN | **Mixed Content** (bloqueio do navegador, não é header). Abra `http://IP:3000/play.html`, use o **HTTPS** do PC (`npm run cert` → `https://IP:3443`, com `?server=`) ou um túnel HTTPS. O preflight **PNA** já é respondido |
| Jogar com quem está em **outra rede** | **👥 Jogar em rede** no modo 🌐 Online (netplay); ou um túnel HTTPS que **você** sobe (`cloudflared`/`ngrok`/Tailscale) + `PUBLIC_URL` para levar a biblioteca. O túnel expõe o PC na internet — considere `ACCESS_TOKEN` |
| "Conectado a https://web-emu.vercel.app" ao digitar um IP | `getApiBase` lendo a base com `JSON.parse` (gravada crua) — aponte com `?server=` (grava string crua); `normalizarBase` |
| Convidado não vê, host trava | `streamVersion`/recriação de PC, `npHostRecheckStream`, `track ended` |
| "Aguardando o host" preso | Só deve aparecer em `failed`/`closed`; limpe estado ao sair |
| Host vê tela preta "Aguardando o host" | Palco `#np-stage` do convidado sobre o canvas; esconder no `showPlayer`/`npAssumirHost` |
| Jogo continua rodando ao fundo | `🏠 Consoles` deve destruir o núcleo local (solo e host), não só o host |
| Clicou em 🏠 e não consegue mais voltar/parar | No boot não reabrir o último jogo; abrir no seletor (`showHub()`) |
| Convidado não conecta "de primeira" | Vigia envia `sync-request`; host refaz a oferta (`npHostOnSyncRequest`); resetar `NP.leaving` |
| Mesmo navegador vira "Player 2" por aba | `npCreateRoom` deve enviar `sessionToken`; backend recusa token já ativo (outra aba) |
| Clique duplo no convite cria "Player 2" | Token de sessão (`np_session_token`) + `resumed` |
| Dois peers do mesmo IP | Anti-clone por IP (sem token) |
| Lobby some na Vercel | Funções serverless não compartilham memória — limitação conhecida |
| Controle na tela não responde (mobile) | `npSendInput` precisa aplicar local em solo/host (não só em sala). O stick emite analógico (16-19) **e** digital (4-7); sem analógico no core, o digital mantém o controle funcionando. O gamepad nativo do EmulatorJS é escondido por CSS para não duplicar |
| Push "falha" no PowerShell | stderr do git; confirme `a..b master -> master` |

---

## 15. Roadmap (alto nível)

- [ ] Rollback real (save/restore de estado por frame) e sincronização de saves.
- [ ] Estado das salas em Redis/Marketplace (remover limite de instância da Vercel).
- [x] Suporte a multi-disco (`.m3u`) pela interface.
- [ ] Conquistas / saves em nuvem local.

---

## 16. Glossário

- **Host:** quem emula e transmite (é o dono da "verdade" do jogo).
- **Convidado:** recebe vídeo/áudio e envia inputs; não precisa de ROM.
- **Sinalizador:** WebSocket que só faz a apresentação inicial (SDP/ICE).
- **Cor:** núcleo LibRetro compilado para WASM que emula um console.
- **BIOS:** firmware (ex.: `scph5501.bin`) — pode ser exigida por alguns cores.
- **COOP/COEP:** cabeçalhos que habilitam `SharedArrayBuffer` (PSP/DOS).
- **Range:** requisições parciais HTTP usadas para stream de ROM/ISO.
- **`...all`:** nome do parâmetro que a Vercel usa para o resto do caminho.
