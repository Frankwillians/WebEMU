# Builds recompilados (PS2 / PSP → WebAssembly)

Esta pasta guarda os builds gerados pelos projetos de **recompilação estática**
(eles **não** são emuladores genéricos — convertem **um jogo específico** para
WebAssembly):

- PS2: <https://github.com/snuri00/ps2-web-recomp>
- PSP: <https://github.com/snuri00/psp-web-recomp>

O backend serve estes builds com os cabeçalhos exigidos por eles
(`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp`) e com suporte a *Range requests*. Eles aparecem no hub, em cada
console (PS2/PSP), no cartão **“Builds recompilados (WASM)”** e abrem como
página própria (não em iframe, por causa do *cross-origin isolation*).

## Onde colocar

```
recomp/ps2/<jogo>/     ps2web.html + ps2web.js + ps2web.wasm + ps2web.data (+ disc.iso)
recomp/psp/<jogo>/     index.html  + index.js  + index.wasm  + index.data
recomp/psp/disc/       disco extraído do jogo PSP (servido em /disc)
```

- **PS2**: copie o conteúdo de `build/web-<jogo>/` (do projeto `ps2-web-recomp`)
  para `recomp/ps2/<jogo>/`. O `disc.iso` fica na mesma pasta e é lido pelo
  caminho relativo `disc.iso` (o padrão da página).
- **PSP**: copie o conteúdo de `build/web-<jogo>/profiles/web/` (do projeto
  `psp-web-recomp`) para `recomp/psp/<jogo>/`. O disco extraído
  (`games/<jogo>/root/disc`) vai para `recomp/psp/disc/`, porque a página o lê
  em `/disc/...`.

A pasta só aparece no hub se tiver um arquivo `.wasm` (ou seja, um build real).

## Requisitos para gerar um build

- **Linux** (o projeto só foi executado no Linux; no Windows use WSL2). Também
  precisa de `git`, `CMake`, `Ninja`, compilador C++20 e Python 3.
- O **disco (ISO) do jogo exato** suportado, que você precisa possuir.
- Só há jogos suportados hoje (os dois primeiros “abertos” por cada projeto):
  - PS2: **Gran Turismo 4** e **God of War II** (precisa de **WebGPU**).
  - PSP: **God of War: Chains of Olympus** e **God of War: Ghost of Sparta**
    (precisa de **WebGL2** + `PSP_DECRYPT` para descriptografar o `EBOOT.BIN`).

### Passo a passo (resumo)

PS2:

```bash
git clone https://github.com/snuri00/ps2-web-recomp.git
cd ps2-web-recomp
scripts/port.sh gt4 "Gran Turismo 4.iso"      # gera build/web-gt4/
# copie build/web-<jogo>/ para <este repo>/recomp/ps2/<jogo>/ e o ISO como disc.iso
```

PSP:

```bash
git clone https://github.com/snuri00/psp-web-recomp.git
cd psp-web-recomp
scripts/setup.sh
PSP_DECRYPT=/caminho/do/decrypter scripts/port.sh gow "God of War.iso"
# copie build/web-<jogo>/profiles/web/ para recomp/psp/<jogo>/
# e o disco extraído para recomp/psp/disc/
```

## Legal

O C++ gerado e o WebAssembly resultante são **traduções do executável do jogo**
e pertencem aos donos do jogo. **Mantenha no seu computador e não publique.**
Use ISOs de jogos que você possui. Por isso esta pasta é ignorada pelo Git
(veja `.gitignore`) — ela não deve ir para o GitHub.
