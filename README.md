# Central de Emulação — vários consoles no navegador

Emulador multi-console que roda **no navegador** (WebAssembly via
[EmulatorJS](https://emulatorjs.org)) e também pode **rodar no PC servidor**
(RetroArch nativo). Carregue ROMs **locais** ou jogue os arquivos de uma
**pasta compartilhada na rede** — tudo por uma página única com **seletor de
console**.

Consoles já configurados: **PS1, PS2, PSP, SNES, NES, N64, Game Boy/Color,
GBA, DS, Virtual Boy, Mega Drive/Genesis, Master System, Game Gear, Sega CD,
32X, Saturn, Atari 2600/7800/Lynx/Jaguar, Arcade (FBNeo), PC Engine, Neo Geo
Pocket, WonderSwan, 3DO, PC-FX, Commodore 64, DOS e Amiga**.

> **Núcleo de emulação:** cores do [EmulatorJS](https://emulatorjs.org)
> (LibRetro compilado para WASM: PCSX-ReARMed, Snes9x, FCEUmm, mGBA,
> Mupen64Plus, ...). O **PS2** usa o [Play! .js](https://playjs.purei.org/)
> no navegador e o **PCSX2** via RetroArch no modo nativo. Usamos cores
> maduros em vez de reescrever o emulador do zero — é o que faz os jogos
> **realmente rodarem**.
>
> A página `/play.html` é servida **cross-origin isolated** (`COOP: same-origin`
> + `COEP: require-corp`) para habilitar `SharedArrayBuffer` e o modo *threads*
> do EmulatorJS — **exigido** pelo núcleo de **PSP (PPSSPP)**: sem isso o PSP
> nem inicia. O CDN do EmulatorJS envia `Cross-Origin-Resource-Policy:
> cross-origin`, então é compatível com esse isolamento.
>
> 🔒 **PSP e DOS exigem um contexto *seguro*.** `SharedArrayBuffer` só existe em
> **`https://`** ou **`localhost`**; no celular, por `http://SEU-IP:3000` o
> navegador bloqueia e o PSP/DOS não iniciam. Para jogar esses dois no celular:
>
> ```bash
> npm run cert   # gera certs/key.pem + certs/cert.pem (usa o openssl do Git no Windows)
> npm start
> ```
>
> Depois abra **`https://SEU-IP:3443/play.html`** e aceite o aviso de certificado
> autoassinado ("Avançado → Continuar"). **Todos os outros consoles** funcionam
> em HTTP normal (`http://SEU-IP:3000/play.html`).

---

## 🚀 Como abrir a página web (para jogar)

Requer [Node.js](https://nodejs.org) 18+.

```bash
cd ps1emu
npm install        # instala dependências do backend
npm run build      # compila o frontend (uma vez) — opcional p/ jogar
npm start          # sobe o servidor (http://localhost:3000)
```

Abra **http://localhost:3000/play.html**, escolha um **console** e pronto. Você pode:

1. **Arrastar uma ROM** do seu aparelho para a página — funciona na hora;
2. **Escolher um jogo da rede** — coloque arquivos na pasta do console e clique em *Jogar*;
3. **Informar a pasta dos jogos e o servidor** pela própria página;
4. **Rodar no PC servidor (nativo)** — usa o RetroArch instalado no PC (mais rápido).

> **Aviso:** use apenas ROMs/BIOS que você possui legalmente. As pastas de
> ROMs (`games/`, `roms/`, `ps2games/`) são ignoradas pelo Git.

Do outro PC/celular na mesma rede: `http://SEU-IP-LOCAL:3000/play.html`
(o endereço correto aparece no log ao iniciar o servidor).

> **Precisa de internet?** O EmulatorJS é carregado de um CDN. A ROM local é
> processada no seu navegador; nada é enviado para fora.

### 🔗 Jogar por link (URL da ROM)

Além do arquivo do aparelho, a página aceita um **link direto** para a ROM/ISO.
Em cada console há o cartão *Jogar por link (URL)*: cole o endereço e clique em
**▶ Jogar**. O download pode ser feito:

- **pelo navegador** (caixa desmarcada) — direto, desde que o host permita CORS; ou
- **pelo servidor** (caixa marcada, padrão) — passa por `/api/rom`, que contorna
  bloqueios de CORS e suporta `Range`. O proxy recusa `localhost`/`169.254.*`.

```http
GET /api/rom?url=https://exemplo.com/jogo.zip
Range: bytes=0-          # opcional (retomada/seek)
```

> **Coleção de links salvos.** Todo jogo aberto por link é catalogado
> automaticamente **por console** em `localStorage` (`ps1emu.links`), com capa e
> nome. Ele reaparece no cartão **🔗 Links salvos** daquele console — dá para
> rejogar (▶), renomear (✏️), trocar a capa (🖼) ou remover (🗑) a qualquer
> momento. Rejogar o mesmo link **não** duplica (a chave é a própria URL), e cada
> navegador guarda a sua coleção (nada vai para o servidor). Esses jogos
> **contam** na quantidade de jogos do console.
>
> **A capa segue o nome + console.** O backend resolve o nome no catálogo
> libretro-thumbnails daquele console: primeiro tenta o nome **exato** e, se não
> achar, uma busca **aproximada** (ignora região/tags como `(USA)`, `(Rev 1)`,
> `[T+Pt]` e a extensão). Renomear o link refaz a capa; se ainda assim não for a
> certa, o **🖼** grava uma **URL de capa manual**. A capa é resolvida pela rota
> `/api/cover` da **própria página** — funciona no site publicado (Vercel) sem
> precisar do PC dos jogos, porque ela só depende de nome + console.
>
> **Backup da coleção.** Ainda no cartão **🔗 Links salvos**, **⬇️ Exportar
> backup** baixa um JSON com a coleção de **todos os consoles** (inclusive as
> capas manuais); **⬆️ Importar backup** restaura esse arquivo em outro aparelho
> (mescla e não duplica).


### ▲ Deploy na Vercel

O projeto já vem preparado para a Vercel (site estático + funções):

- `vercel.json` gera a saída estática em `public/` (cópia de `frontend/public`,
  feita por `scripts/vercel-build.mjs`) e aplica `COOP/COEP` em `/play.html`;
- `api/[...all].js` expõe **todo** o backend Express em `/api/*`.

Pelo CLI:

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # produção
```

Ou importe o repositório em [vercel.com/new](https://vercel.com/new).

> **Funciona na Vercel:** rodar no navegador (todos os consoles), capas,
> arquivos escolhidos no aparelho, **link (URL)** da ROM e **netplay online**
> (`/api/ws`).
> **Não existe** em serverless: biblioteca no disco do servidor e abrir no
> RetroArch do "PC servidor".

---

## 🧬 Por que a tela ficava preta (core próprio)

A Fase 1 construiu um *esqueleto* de emulador próprio (CPU/GPU/SPU em TypeScript).
Ele **não consegue bootar jogos comerciais** — sem BIOS boot, controller de
CD-ROM, IRQ de VBlank e GTE completos, a VRAM fica preta. Emular PS1 de verdade
é o trabalho de anos (DuckStation, PCSX, ...).

Por isso a versão de jogo (`/play.html`) usa os cores **LibRetro compilados para
WASM**, que já implementam tudo isso. O frontend React antigo continua no
projeto como referência/experimento.

---

## 📦 Estrutura do projeto

```
ps1emu/
├── frontend/public/play.html ← ⭐ Página de jogo de PS1 (EmulatorJS/WASM) — use esta!
├── frontend/public/ps2/      ← Emulador de PS2 (Play! .js) — experimental
├── bios/                     ← BIOS de PS1 (ex.: scph5501.bin)
├── games/                    ← ROMs/ISOs de PS1 (servidas pela rede)
├── ps2games/                 ← ISOs de PS2 (experimental; separado de games/)
├── package.json              ← Backend (Express + WebSocket)
├── .env.example              ← Configurações do backend
├── src/
│   └── backend/
│       ├── bios.js           ← Upload/armazenamento de BIOS
│       ├── server.js         ← Servidor HTTP + API REST + arquivos estáticos
│       ├── signaling.js      ← WebSocket Signaling Server (WebRTC)
│       ├── storage.js        ← Indexação de ROMs do disco (PS1 e PS2)
│       ├── settings.js       ← Config persistente (pastas escolhidas)
│       └── config.js         ← Portas, pastas, CORS
└── frontend/                 ← Versão completa (React + Vite + TypeScript)
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx             ← Entry React
        ├── App.tsx              ← Layout + integração dos painéis
        ├── store.ts             ← Estado global (Zustand)
        ├── types.ts
        ├── core/                ← AGENTE 1: Core de Emulação
        │   ├── index.ts         ← API pública (createEmulator)
        │   ├── emulator.ts      ← Orquestra CPU/GPU/SPU/Bus
        │   ├── worker.ts        ← Web Worker (loop fora da thread principal)
        │   ├── bus.ts           ← System Bus (mapa de memória)
        │   ├── types.ts         ← Tipos + mapeamento de botões
        │   ├── cpu/interpreter.ts  ← CPU MIPS R3000A
        │   ├── gpu/gpu.ts          ← GPU / Rasterizador
        │   └── spu/spu.ts          ← SPU (áudio)
        ├── netplay/             ← AGENTE 3: Multiplayer
        │   ├── index.ts         ← Orquestrador (createNetplay)
        │   ├── signaling-client.ts  ← Cliente WebSocket
        │   ├── webrtc-connection.ts ← RTCPeerConnection + DataChannel
        │   ├── frame-sync.ts        ← Lockstep / sincronização de frames
        │   └── types.ts
        ├── hooks/               ← AGENTE 4: UI
        │   ├── useEmulator.ts
        │   ├── useInput.ts      ← Teclado + Gamepad API
        │   ├── useAudio.ts      ← Web Audio API
        │   └── useNetplay.ts
        └── components/
            ├── ROMLoader.tsx    ← Painel 1: ROMs locais (drag & drop)
            ├── GameBrowser.tsx  ← Painel 2: jogos da rede
            ├── GameCanvas.tsx   ← Painel 3: canvas + fullscreen
            ├── GamepadMapper.tsx← Remapeamento de controles
            ├── NetplayLobby.tsx ← Lobby de multiplayer
            └── Toasts.tsx
```

---

## 🖥️ Rodando o backend (para Rede + Multiplayer)

Requer [Node.js](https://nodejs.org) 18+.

```bash
cd ps1emu
npm install
npm start
```

O servidor sobe em:
- **API/HTTP:** `http://localhost:3000`
- **Página de jogo:** `http://localhost:3000/play.html`
- **WebSocket Signaling:** `ws://localhost:3000/signaling` (mesma porta)

Coloque suas ROMs na pasta `games/` (ou escolha outra pasta — veja abaixo).
Depois abra `/play.html` e clique em **Atualizar** no cartão *Jogos pela rede*.

### Acessar de outro PC/celular da rede

1. Descubra o IP do PC host: `ipconfig` (Windows) → ex. `192.168.0.5`
   (o mesmo IP aparece no cartão *Jogos pela rede* e no log do servidor);
2. No outro aparelho (mesma rede Wi‑Fi), abra `http://192.168.0.5:3000/play.html`;
3. Escolha o jogo na lista e clique em **Jogar**.

> **Windows Defender:** na primeira execução o Firewall pode bloquear a porta
> `3000`. Permita o acesso em *Redes privadas* quando o Windows perguntar.

---

## 📁 Pasta de jogos & Rede

O projeto é pensado para você **escolher** de onde vêm os jogos e **qual
servidor** usar — sem editar código.

### Escolher o servidor (rede)

Por padrão a página usa o **próprio servidor que a abriu** (`location.origin`).
Para apontar para os jogos de **outra máquina** que também esteja rodando o
backend, abra a página com o parâmetro **`?server=`**:

```text
https://SEU-SITE/play.html?server=http://192.168.0.5:3000
```

A escolha fica salva no navegador (`localStorage`) e passa a valer para a API e
para o netplay. É esse mesmo endereço que vai embutido no **link de convite**.

> Se a URL do `?server=` for um endereço **HTTPS** (ex.: o do PC via
> `npm run cert` → `https://192.168.0.5:3443`), funciona até a partir do site no
> Vercel. Um `?server=` em **HTTP** só funciona abrindo a página de dentro da
> mesma rede (ver o aviso de Mixed Content abaixo).

> ⚠️ **Página HTTPS (Vercel) → servidor HTTP da rede:** o navegador bloqueia
> esse pedido (Mixed Content) — não é algo que um cabeçalho resolva. Caminhos
> válidos:
>
> 1. **Abrir a própria página do PC** — `http://IP:3000/play.html` (same-origin,
>    sem bloqueio).
> 2. **Usar o HTTPS do PC** — rode `npm run cert` (gera `certs/`, já com o IP da
>    LAN no certificado) e reabra o servidor; aí abra
>    `https://IP:3443/play.html` (aceite o aviso de certificado autoassinado).
>    É HTTPS→HTTPS, então funciona também a partir da página da Vercel, e dá o
>    **contexto seguro** que PSP/DOS exigem.
> 3. **Túnel HTTPS** (`cloudflared`/`ngrok`/Tailscale) — ver abaixo.
> 4. Na **mesma máquina**, `http://localhost:3000` é isento de Mixed Content.

> 🔒 Para o navegador deixar uma página **pública** chamar a API num **IP
> privado**, o servidor responde o preflight **Private Network Access**
> (`Access-Control-Allow-Private-Network: true`). Isso é automático.

### Jogar em rede (netplay com lobby)

O botão **👥 Jogar em rede** abre o lobby. O fluxo:

1. **Host** (quem tem o jogo): abra **👥 Jogar em rede → Criar sala**. É gerado um
   **código** e um **link** (`http://192.168.0.5:3000/play.html?room=CÓDIGO`). Dá
   para pôr **nome** e **senha** na sala. A sala pode ser criada **antes mesmo de
   escolher o jogo** — quando o host iniciar a partida, ela aparece para todos.
2. **Convidados** (qualquer aparelho): abrem o link, digitam o **código** ou entram
   pela **lista de salas** do lobby. **Não precisam da ROM** — recebem o
   vídeo/áudio do host e mandam os comandos.
3. O host **transmite a tela** (o emulador roda nele) e cada convidado aparece
   como um **jogador** (com nome e contagem "X de 4"); o host pode **expulsar**
   quem quiser. Há **chat** simples.
4. Controles do convidado: **gamepad na tela** (D‑pad, A/B/X/Y, L/R, Start/Select)
   ou teclado (setas, `Z`=A, `X`=B, `A`=X, `S`=Y, `Enter`=Start, `Shift`=Select,
   `Q`=L, `R`=R).

#### Escolha do sinalizador (LAN × Online)

No painel **👥 Jogar em rede** há duas opções de **sinalizador**:

| Modo | Usa | Alcance | Precisa de PC ligado? |
|------|-----|---------|----------------------|
| 🏠 **LAN (PC local)** | `ws://IP:3000/signaling` | mesma rede (Wi‑Fi) | sim (o PC host) |
| 🌐 **Online (Vercel)** | `wss://…/api/ws` | **internet** | **não** |

O link de convite (**🔗 Copiar link de convite**) já carrega `?ws=…`, então o
convidado entra sozinho no modo certo — inclusive abrindo o link pelo site do
Vercel. Há ainda o botão **🔌 Testar conexão** para confirmar o sinalizador.

> O WebRTC continua **ponto a ponto** (vídeo/áudio/inputs), usando os servidores
> STUN/TURN gratuitos entregues em `GET /api/ice`. O sinalizador só faz a
> apresentação inicial entre os jogadores.

#### Salas privadas

Ao criar a sala dá para marcar **“Sala privada (só por link/código)”** e/ou pôr
uma **senha**. A sala privada **não aparece** na lista pública: só entra quem
tiver o **link** ou o **código** (botão **Entrar por código** no lobby). Bom para
jogar só com os amigos.

### 🌐 Netplay online sem servidor externo

A **opção 🌐 Online (Vercel)** usa o endpoint WebSocket serverless do próprio
projeto (`api/ws.js`, servido em `/api/ws`). Nada precisa rodar no PC do host:
basta o site estar publicado. Marque a opção, clique em **🔌 Testar conexão**,
crie a sala e mande o link.

> **Limitação conhecida** (documentada pela Vercel): conexões novas não caem
> necessariamente na **mesma instância** da função, e o lobby guarda as salas em
> memória. Com 2 a 4 jogadores isso funciona na grande maioria das vezes. Se
> algum dia falhar, a solução durável é guardar o estado das salas num
> Redis/Marketplace. Para desligar a opção: `NETPLAY_WS=0`.

Como a Vercel derruba a conexão ao atingir a **duração máxima** da função, o
frontend **reconecta sozinho** e volta para a mesma sala.

### 🌍 Alternativa: jogar pela internet com túnel público

Se quiser levar também a **biblioteca de ROMs do seu PC** (em vez de só o
netplay), exponha o servidor local por um túnel HTTPS/WSS que **você** sobe
(sem deploy):

```powershell
# instale o cloudflared (uma vez)
winget install --id Cloudflare.cloudflared
# com o servidor rodando (npm start), em outra janela:
cloudflared tunnel --url http://localhost:3000
```

O túnel imprime um endereço tipo `https://algo-aleatorio.trycloudflare.com`.
**Abra esse endereço (no host e nos convidados)** — o WebSocket vira
`wss://…/signaling` automaticamente e o lobby passa a valer para todo mundo.

Para o link de convite sair certo mesmo que **você** esteja vendo em
`localhost`, inicie o servidor informando a URL pública:

```powershell
$env:PUBLIC_URL="https://algo-aleatorio.trycloudflare.com"; npm start
```

Aí o botão **🔗 Copiar link** gera `https://…/play.html?room=CÓDIGO&server=…`.

> ⚠️ Enquanto o túnel está ligado, **este PC fica acessível na internet**
> (jogos, API e netplay). Use só quando precisar e, de preferência, defina
> `ACCESS_TOKEN`.

> Alternativas de túnel: `ngrok http 3000`, `localtunnel` ou **Tailscale Funnel**
> (endereço fixo). Para algo sempre no ar, faça deploy do backend inteiro num
> host com processo persistente (Render/Railway/Fly.io/VPS) — a Vercel sozinha
> não serve, porque o lobby guarda as salas em memória.

#### TURN (NAT restrito)

STUN resolve a maioria dos casos, mas pela internet (NAT simétrico/CGNAT de
operadora) é preciso um **TURN** para retransmitir o vídeo. Já vem configurado um
TURN público gratuito (**Open Relay**, da Metered). Para usar o seu, defina:

```powershell
$env:TURN_URLS="turn:seu.turn:3478,turns:seu.turn:5349"
$env:TURN_USERNAME="usuario"; $env:TURN_CREDENTIAL="senha"; npm start
```

O servidor entrega esses dados ao navegador em `GET /api/ice` (rota de um só
segmento, para funcionar também na função da Vercel).

### Escolher a pasta de jogos

No mesmo cartão, o campo **Pasta de jogos no servidor** aceita um caminho
(absoluto ou relativo à raiz do projeto):

```
D:\PS1\ISOs
\\NAS\jogos\ps1        (compartilhamento de rede)
games
```

Clique em **Salvar pasta**: a pasta é validada, criada se não existir,
reindexada e a escolha é **gravada** em `ps1emu.config.json` (ignorado pelo
Git), então persiste entre reinícios.

Também é possível definir pelo `.env` (`GAMES_DIR`) ou por variável de
ambiente:

```bash
# Windows (PowerShell)
$env:GAMES_DIR="D:\PS1\ISOs"; npm start
```

### Multi-disco (.m3u)

Jogos com vários CDs (ex.: RPGs de PS1/Saturn/Sega CD) rodam como uma
**playlist `.m3u`** que lista os discos na ordem. Pela interface:

1. No cartão **Jogos da rede**, clique em **🧩 Criar .m3u** (entra no modo de seleção).
2. Clique nos discos que formam o jogo (na ordem: Disco 1, 2, 3…).
3. Dê um nome (ou deixe em branco) e clique em **Criar**.

A playlist é gravada na pasta do console e passa a aparecer na biblioteca como
um jogo normal — é só dar **▶ Jogar**. Para trocar de disco no meio do jogo, o
core lê a lista (o `.m3u` referencia os discos por caminho relativo).

> O console precisa listar `.m3u` entre as extensões aceitas (PS1, Saturn,
> Sega CD, PC-FX).

### API de configuração

| Método | Rota              | Descrição                                       |
|--------|-------------------|-------------------------------------------------|
| GET    | `/api/config`     | Retorna pasta de jogos, pasta de PS2, BIOS, IP e URL LAN |
| POST   | `/api/config`     | Troca pastas (`{ "gamesDir": "..." }`, `{ "ps2Dir": "..." }` ou ambos) |
| GET    | `/api/health`     | Status + `lanIP`/`lanUrl`                       |
| GET    | `/api/ps2/games`  | Lista os jogos de PS2 indexados                 |
| POST   | `/api/ps2/rescan` | Reindexa a pasta de PS2                         |
| GET    | `/ps2roms/...`    | Arquivos de PS2 (com Range), servidos da pasta de PS2 |
| GET    | `/ps2/`           | Emulador de PS2 (Play! .js) — abrir como página própria |

### API da central (multi-console, capas)

| Método | Rota                                 | Descrição                                            |
|--------|--------------------------------------|------------------------------------------------------|
| GET    | `/api/health`                        | Estado do servidor: `netplay`, `lanUrl`, `library` (se há biblioteca de disco) |
| GET    | `/api/systems`                       | Lista os consoles, contagem de jogos, modos e BIOS   |
| GET    | `/api/systems/:id/games`             | Lista os jogos do console (indexado do disco) — só com `library:true` |
| POST   | `/api/systems/:id/rescan`            | Reindexa a pasta do console                          |
| POST   | `/api/systems/:id/m3u`               | **Cria playlist `.m3u`** (multi-disco) a partir de `gameIds` |
| GET    | `/api/cover?system=<id>&name=<nome>` | **Capa do jogo** — busca no libretro-thumbnails (exata e, se preciso, aproximada no console), com cache. Serve o servidor local **e** a Vercel |
| GET    | `/api/cover?system=<id>&url=<img>`   | **Capa manual** — proxy da imagem apontada (mesma guarda anti-SSRF do proxy de ROM) |
| GET    | `/roms/:systemId/...`                | Arquivos do console (com Range)                      |
| POST   | `/api/systems/:id/launch`            | Abre o jogo no RetroArch do PC (modo “PC servidor”)  |
| GET    | `/api/ice`                           | Servidores ICE (STUN/TURN) do netplay (STUN + TURN público por padrão) — um segmento, funciona na Vercel |
| WS     | `/signaling`                         | Sinalizador + lobby das salas — **servidor local** (modo LAN)                |
| WS     | `/api/ws`                            | Sinalizador + lobby das salas — **Vercel** (modo online, `api/ws.js`)        |

> As capas vêm do projeto **libretro-thumbnails** (No-Intro, por nome do
> arquivo) e são servidas pelo backend — o cliente não precisa acessar o GitHub.
> O casamento é por prioridade: **exato** primeiro e, se não houver, uma busca
> **aproximada** dentro daquele console (índice do `thumbnails.libretro.com`,
> cacheado em memória), respeitando a região do nome quando ele já traz uma. Uma
> capa apontada manualmente (`?url=`) passa pelo mesmo proxy.
>
> **Biblioteca de disco:** `/api/health` informa `library`. No servidor local
> (`npm start`) é `true` e a pasta do servidor é listada normalmente. No site
> publicado da Vercel a função serverless não tem disco (`library:false`) e a
> Vercel responde 404 às rotas de vários segmentos — por isso o jogador lista
> pelos **links salvos** ou pelo **arquivo do aparelho**, ou aponta o backend do
> PC com `?server=` (HTTPS).

---

## 🧩 BIOS

Alguns jogos exigem uma BIOS de PS1 (arquivo de ~512 KB). Você pode:

- **Enviar pela página:** `/play.html` → cartão *BIOS* → escolha a região e o arquivo.
  O arquivo é salvo automaticamente com o nome correto (`scph5501.bin` = EUA,
  `scph5502.bin` = Europa, `scph5500.bin` = Japão).
- **Copiar manualmente** para a pasta `bios/` com um desses nomes.

O core **PCSX-ReARMed** roda muitos jogos **sem BIOS**; o **Beetle PSX** exige.
Você não precisa distribuir BIOS — apenas usar a sua.

---

## 🎮 PS2 (experimental)

Além do PS1, o projeto inclui um modo de **PlayStation 2** usando o
[Play! .js](https://playjs.purei.org/) (emulador Play! compilado para
WebAssembly e hospedado localmente pelo backend).

> ⚠️ **Isto é experimental.** O Play! .js não roda todos os jogos: vários não
> passam da tela de boot e outros ficam lentos. **Não é recomendado no
> celular.** Se você quer algo estável, use o modo PS1 (`/play.html`).

### Como usar

1. Coloque seus ISOs de PS2 na pasta **`ps2games/`** (separada de `games/`
   para não misturar com o PS1). Formatos: `.iso`, `.chd`, `.cso`, `.isz`,
   `.bin`, `.img`, `.elf`, `.mds`.
2. Em `/play.html`, use o cartão **PS2** para ajustar a pasta (campo
   *Pasta de jogos de PS2*) e clique em **Atualizar**.
3. Clique em **▶ Jogar** num jogo. O emulador abre em `/ps2/` numa aba própria.
4. **Não precisa de BIOS.** Dá para carregar um ISO local direto no botão
   *Escolher arquivo* da página `/ps2/`.

### Como funciona (Range streaming)

O Play! lê o disco por acesso aleatório (vários reads pequenos). Em vez de
baixar um ISO de vários GB para a memória, o `/ps2/lan.js` entrega ao emulador
um objeto "pseudo-arquivo" cujo `slice()` faz requisições **HTTP Range** ao
backend (`/ps2roms/...`). Ou seja, só os pedaços realmente lidos são
transferidos — funciona bem pela rede local.

> Detalhe técnico: o build do Play! usa *threads* + `SharedArrayBuffer`, então
> a página `/ps2/` é servida com `Cross-Origin-Opener-Policy` e
> `Cross-Origin-Embedder-Policy`. Por isso ela é uma **página própria** (não
> pode ser embutida em iframe). Os binários do Play! estão em
> `frontend/public/ps2/` com a licença BSD em `NOTICE.txt`.

### API

| Método | Rota              | Descrição                          |
|--------|-------------------|------------------------------------|
| GET    | `/api/ps2/games`  | Lista os jogos de PS2 indexados    |
| POST   | `/api/ps2/rescan` | Reindexa a pasta `ps2games/`       |
| GET    | `/ps2roms/...`    | Arquivos de PS2 (com suporte a Range) |

A pasta também pode ser definida pela variável de ambiente `PS2_DIR`.

---

## ⚡ Builds recompilados (PS2 / PSP → WebAssembly)

Existe uma segunda forma de rodar PS2 e PSP **no navegador**, de altíssima
performance, que **não** é um emulador genérico: a **recompilação estática**.
O executável de **um jogo específico** é traduzido *antes* (ahead-of-time) para
C++ e compilado para WebAssembly, e um runtime reimplementa o SO/GPU. É o que os
projetos abaixo fazem (ambos MIT):

- **PS2** — <https://github.com/snuri00/ps2-web-recomp> (renderer **WebGPU**)
- **PSP** — <https://github.com/snuri00/psp-web-recomp> (renderer **WebGL2**)

O backend desta central já **hospeda e lista** esses builds: coloque-os em
`recomp/ps2/<jogo>/` e `recomp/psp/<jogo>/` e eles aparecem no hub, no cartão
**“Builds recompilados (WASM)”** de cada console. Eles abrem como **página
própria** (não em iframe), já com `COOP`/`COEP` e suporte a **Range requests**.

### ⚠️ Limitações importantes (leia antes)

- **Não é um emulador:** cada build roda **um único jogo**. Hoje só há 4 títulos
  “abertos”: **Gran Turismo 4** e **God of War II** (PS2); **God of War: Chains
  of Olympus** e **God of War: Ghost of Sparta** (PSP).
- **Precisa de Linux (ou WSL2):** gerar o build exige `git`, `CMake`, `Ninja`,
  C++20, Python 3 e o SDK do Emscripten; os autores só rodaram no Linux. PS2:
  ~300 MB/jogo e **WebGPU** (Chrome/Edge). PSP: ~2 GB/jogo, **WebGL2** e um
  *decrypter* de `EBOOT.BIN`.
- **Você precisa do ISO do jogo exato**, que deve possuir legalmente.
- **Não publique os builds no GitHub:** o C++/WASM gerado é uma tradução do
  executável do jogo e pertence aos donos do jogo. Por isso a pasta `recomp/`
  é **ignorada pelo Git** (veja `.gitignore` e `recomp/README.md`).

> **Resumo prático:** para jogar **qualquer** PS2/PSP no navegador (sua
> biblioteca inteira), continue com o **Play! .js** (PS2) e o **PPSSPP**
> (PSP) — que já emulam no próprio aparelho pelo site. Use os builds
> recompilados **só** para os 4 títulos suportados acima, gerados localmente.

### API dos builds recompilados

| Método | Rota                     | Descrição                                              |
|--------|--------------------------|--------------------------------------------------------|
| GET    | `/api/recomp?kind=ps2`   | Lista os builds encontrados em `recomp/`               |
| GET    | `/recomp/ps2/<jogo>/...` | Arquivos do build PS2 (COOP/COEP + Range)              |
| GET    | `/recomp/psp/<jogo>/...` | Arquivos do build PSP (COOP/COEP + Range)              |
| GET    | `/disc/...`              | Disco extraído do PSP (o build o lê em `/disc`)        |

Variáveis: `RECOMP_DIR` (padrão `recomp`) e `PSP_DISC_DIR`
(padrão `recomp/psp/disc`).

---

## 🎮 Como jogar / controles

Os controles são configuráveis pelo menu do próprio emulador (ícone de
engrenagem). Gamepads USB/Bluetooth funcionam automaticamente (Gamepad API).

| Ação            | Teclado        |
|-----------------|----------------|
| Direcional      | Setas / WASD   |
| Confirmar / etc | conforme o menu |
| Salvar estado   | menu do emulador |

> **Áudio:** é liberado no primeiro clique na tela do jogo (política dos
> navegadores de autoplay).

---

## 🗺️ Roadmap (Fases)

### ✅ Fase 1 — Infraestrutura
- [x] Backend Node.js: API REST, streaming de ROMs, estáticos
- [x] Servidor de signaling WebSocket (para WebRTC)
- [x] Indexação de ROMs e suporte a Range Requests
- [x] Carregador de BIOS (upload + servidor)
- [x] Interface React + core próprio (esqueleto didático)
- [x] Página `standalone.html` (core próprio experimental)

### ✅ Fase 1.5 — Emulação que funciona (esta entrega)
- [x] Core real em WebAssembly (EmulatorJS: PCSX-ReARMed / Beetle PSX)
- [x] Página `/play.html` com carregamento local e pela rede
- [x] Gestão de BIOS pela interface (`/api/bios`)
- [x] Estática de ROMs em `/roms` (resolve `.cue` → `.bin`)
- [x] Fullscreen, tela cheia e núcleos selecionáveis
- [x] Seleção de servidor (rede) e da pasta de jogos pela interface

### 🧪 Fase 1.6 — PS2 experimental (esta entrega)
- [x] Emulador de PS2 self-hosted (Play! .js) em `/ps2/`
- [x] Pasta `ps2games/` separada + cartão na interface
- [x] Carregamento de ISOs por **HTTP Range** (sem baixar o arquivo inteiro)
- [x] Sem necessidade de BIOS

### ✅ Fase 2 — Multiplayer (esta entrega)
- [x] Netplay com **lobby** (criar/entrar por código ou link, senha, chat, expulsar)
- [x] **Sala sem jogo carregado**: dá para criar a sala antes e o host inicia a partida depois
- [x] Host transmite vídeo/áudio via **WebRTC** (`canvas.captureStream`) e aplica os inputs dos convidados
- [x] Convidado **sem ROM**: recebe o vídeo e envia comandos (gamepad na tela + teclado)
- [x] **Dois sinalizadores**: 🏠 LAN (`/signaling`) e 🌐 Online (`/api/ws`, serverless na Vercel)
- [x] **Link de convite** que já carrega `?room=`, `?server=` e `?ws=` — o convidado conecta sozinho
- [x] **Auto-reconexão**: se a conexão cair (ex.: duração máxima da função na Vercel), volta para a mesma sala
- [ ] Rollback / sincronização de estados

### 🔜 Fase 3 — Extras
- [ ] Conquistas / saves na nuvem local
- [x] Biblioteca com capas e metadados (libretro-thumbnails via `/api/cover`, exato + aproximado por nome+console)
- [x] Busca de jogos por nome na lista do console
- [x] **Multi-disco (`.m3u`) pela interface** — selecione 2+ discos na lista do console e clique em **🧩 Criar .m3u** (grava a playlist na pasta do console)

### 🔜 Fase 3 — Netplay avançado
- [ ] Rollback real (save/restore de estados por frame)
- [ ] Sincronização de save states comprimida
- [x] TURN/STUN configuráveis (`/api/ice` + variáveis `TURN_*`)
- [x] Lobby com lista de salas
- [ ] Estado das salas em Redis/Marketplace (remover a limitação de instância da Vercel)

### 🔧 Variáveis de ambiente do netplay

| Variável | Efeito |
|----------|--------|
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN próprio para o WebRTC (padrão: TURN público gratuito) |
| `PUBLIC_URL` | URL pública (ex.: túnel HTTPS que **você** subiu) usada nos links de convite |
| `ACCESS_TOKEN` | Token opcional para proteger a API e o sinalizador |
| `NETPLAY_WS=0` | **Desliga** a opção 🌐 Online na Vercel |

---

## 🧩 Arquitetura (visão geral)

```
┌─────────────────────── Navegador ───────────────────────┐
│                                                          │
│  Frontend (React)                                        │
│   ├── Painel Local  ──┐                                  │
│   ├── Painel Rede   ──┼──► Web Worker ─► Core PS1        │
│   └── Canvas        ──┘      (CPU/GPU/SPU)               │
│         ▲                                                │
│         │ frames RGBA                                    │
│  ┌──────┴────────┐         ┌──────────────────┐          │
│  │ useAudio      │         │ Netplay (WebRTC) │          │
│  │ (Web Audio)   │         │ DataChannel P2P  │          │
│  └───────────────┘         └────────┬─────────┘          │
└─────────────────────────────────────┼────────────────────┘
                                       │ signaling
┌──────────────────────────────────────┼────────────────────┐
│              PC Host (Node.js)        │                    │
│  HTTP API (/api/games)  ◄── ROMs       │                    │
│  WebSocket (/signaling) ◄─────────────┘                    │
└────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Aviso

Este projeto é para fins **educacionais**. Use apenas com BIOS e ROMs que você
possui legalmente. Não distribua material protegido por direitos autorais.

---

## 📋 Equipe de agentes (Maestri)

| Agente | Especialidade | Módulo |
|--------|---------------|--------|
| **MIPS**  | Core de Emulação (WASM/Low-level) | `frontend/src/core/` |
| **HOST**  | Backend & Rede Local               | `src/backend/` |
| **SYNC**  | Multiplayer & Netplay (WebRTC)     | `frontend/src/netplay/` |
| **PIXEL** | Interface & UX (Frontend)          | `frontend/src/components/`, `hooks/` |
