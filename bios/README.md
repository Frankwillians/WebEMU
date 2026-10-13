# BIOS do PlayStation 1

Coloque aqui os arquivos de BIOS de PS1. Eles são servidos pelo backend em
`/bios/<arquivo>` e usados pelo core do EmulatorJS (PCSX-ReARMed / Beetle PSX).

## Nomes reconhecidos

O core procura por nomes específicos. Use exatamente um destes:

| Arquivo        | Região | Obrigatória?                          |
| -------------- | ------ | ------------------------------------- |
| `scph5500.bin` | Japão  | Para jogos JP                         |
| `scph5501.bin` | EUA    | Para jogos US                         |
| `scph5502.bin` | Europa | Para jogos EU                         |

Outros comuns também funcionam: `scph1001.bin`, `scph7001.bin`, `scph7502.bin`.

## Como obter

Você precisa extrair a BIOS do seu próprio console (arquivo de ~512 KB).
Por questões de direitos autorais, este projeto **não** distribui BIOS.

## Pela interface

Você não precisa copiar arquivos manualmente: na página `/play.html`, use o
cartão **BIOS → Enviar BIOS** e escolha a região. O arquivo é salvo aqui com o
nome correto automaticamente.
