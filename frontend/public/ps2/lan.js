/*
 * lan.js — Integração do Play! .js com a pasta de jogos do ps1emu
 * ---------------------------------------------------------------
 * O Play! lê o disco por acesso aleatório: ele pergunta o tamanho do arquivo
 * (getFileSize) e pede pedaços sob demanda (read/offset/size). Em vez de baixar
 * um ISO inteiro (que pode ter vários GB) para a memória, expomos um objeto
 * "pseudo-arquivo" cujo slice() faz um fetch com HTTP Range no servidor.
 *
 * O bundle do Play! foi ajustado (ver static/js/main.js) para, no momento em
 * que o emulador recebe um arquivo, usar globalThis.__ps2FileOverride quando
 * presente. Assim dispararmos o input nativo com um arquivo "isca" (de 1 byte,
 * com o nome/extensão corretos) e o Play! passa a ler do nosso objeto.
 *
 * Uso direto: /ps2/?url=<url>&name=<nome>&size=<bytes>
 * Uso programático: window.ps2Load({ url, name, size })
 */
(function () {
  'use strict';

  var PS2_EXT = /\.(iso|chd|cso|isz|bin|img|elf|mds)$/i;

  function el(id) { return document.getElementById(id); }

  function setStatus(html) {
    var s = el('ps2-status');
    if (s) s.innerHTML = html;
  }

  function setGameName(name) {
    var n = el('ps2-game-name');
    if (n) n.textContent = name || '';
  }

  function extOf(name) {
    var m = /(\.[a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '.iso';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(i === 1 ? 0 : 1)) + ' ' + units[i];
  }

  /**
   * Cria um objeto que "se parece" com um File para o DiscImageDevice,
   * mas lê os dados via HTTP Range.
   */
  function makeRangeFile(url, name, size) {
    return {
      name: name,
      size: size,
      lastModified: Date.now(),
      __ps2RangeFile: true,
      slice: function (start, end) {
        if (start < 0) start = Math.max(0, size + start);
        if (end == null || end > size) end = size;
        var len = end - start;
        // Leitura de tamanho zero (ou além do fim): devolve vazio sem Range
        // inválido (que o servidor responderia como 416).
        if (len <= 0) {
          return {
            size: 0,
            arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(0)); }
          };
        }
        return {
          size: len,
          arrayBuffer: function () {
            // Range "bytes=start-end" é inclusivo nas duas pontas.
            return fetch(url, { headers: { Range: 'bytes=' + start + '-' + (end - 1) }, cache: 'no-store' })
              .then(function (r) {
                if (!r.ok && r.status !== 206) {
                  throw new Error('HTTP ' + r.status + ' ao ler pedaço do jogo (' + url + ')');
                }
                return r.arrayBuffer();
              });
          }
        };
      }
    };
  }

  /** Descobre o tamanho do arquivo por HEAD (fallback se a URL não vier com size) */
  function probeSize(url) {
    return fetch(url, { method: 'HEAD' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url);
      var cr = r.headers.get('content-range');
      var cl = r.headers.get('content-length');
      var n = cr ? parseInt(cr.split('/').pop(), 10) : (cl ? parseInt(cl, 10) : 0);
      return isFinite(n) ? n : 0;
    });
  }

  /**
   * Entrega o arquivo ao emulador: espera o React renderizar o <input type=file>,
   * instala o override e dispara um evento "change" com um arquivo-isca.
   */
  function triggerBoot(url, name, size) {
    name = name || 'game.iso';
    if (!PS2_EXT.test(name)) name += '.iso';
    setGameName(name);
    var tries = 0;
    (function waitForInput() {
      var input = document.querySelector('#root input[type=file]') ||
                  document.querySelector('input[type=file]');
      if (!input) {
        if (++tries > 600) { // ~60s
          setStatus('<span class="err">O emulador não inicializou. Abra o console (F12) para ver o erro.</span>');
          return;
        }
        return setTimeout(waitForInput, 100);
      }

      try {
        var mock = makeRangeFile(url, name, size);
        globalThis.__ps2FileOverride = mock;

        var dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(1)], name, { type: 'application/octet-stream' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // O thunk do Redux chama setFile() de forma síncrona no ramo de disco,
        // então já capturou a referência — podemos limpar o override com segurança.
        globalThis.__ps2FileOverride = null;

        setStatus('Carregando <b>' + esc(name) + '</b>' + (size ? ' (' + fmtBytes(size) + ')' : '') +
                  '… o boot pode levar alguns segundos. <span class="spin"></span>');
      } catch (e) {
        console.error('[ps2] falha ao entregar o jogo:', e);
        setStatus('<span class="err">Erro ao carregar: ' + esc(e && e.message ? e.message : e) + '</span>');
      }
      return undefined;
    })();
  }

  // Assinatura pública para integração programática.
  globalThis.ps2Load = function (opts) {
    opts = opts || {};
    if (!opts.url) { setStatus('<span class="err">URL do jogo não informada.</span>'); return; }
    var name = opts.name || 'game.iso';
    if (opts.size && parseInt(opts.size, 10) > 0) {
      triggerBoot(opts.url, name, parseInt(opts.size, 10));
    } else {
      setStatus('Descobrindo o tamanho de <b>' + esc(name) + '</b>…');
      probeSize(opts.url)
        .then(function (s) { triggerBoot(opts.url, name, s); })
        .catch(function (e) {
          setStatus('<span class="err">' + esc(e && e.message ? e.message : e) + '</span>');
        });
    }
  };

  // ---- Auto-boot via query string ----
  var qs = new URLSearchParams(location.search);
  var gameUrl = qs.get('url') || qs.get('u');
  var gameName = qs.get('name') || qs.get('n') || 'game.iso';
  var gameSize = parseInt(qs.get('size') || qs.get('s') || '0', 10) || 0;

  if (gameUrl) {
    if (gameSize > 0) {
      triggerBoot(gameUrl, gameName, gameSize);
    } else {
      setStatus('Preparando…');
      probeSize(gameUrl)
        .then(function (s) { triggerBoot(gameUrl, gameName, s); })
        .catch(function (e) {
          setStatus('<span class="err">' + esc(e && e.message ? e.message : e) + '</span>');
        });
    }
  }
})();
