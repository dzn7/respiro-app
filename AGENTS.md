# Respiro

App Electron para macOS que mostra o uso do disco e libera caches de dev com segurança. Produto: `PRD.md`. Visual: `UI.md`.

## Stack
Electron 44, JavaScript ESM com JSDoc checado por `tsc` (sem build), HTML/CSS/JS puros no renderer, fonte Geist embarcada, Phosphor Icons em SVG inline. Testes com `node --test`. Sem framework de UI, sem bundler.

## Estrutura
```
src/main/main.js          janela, menu, IPC
src/main/preload.cjs      ponte segura (window.respiro)
src/main/scan.js          roda as categorias e o disco
src/main/categories/*.js  uma categoria por arquivo (só leitura)
src/main/cleaner.js       ÚNICO lugar que apaga: Lixeira e comandos oficiais
src/main/sys.js           execFile, du, statfs, PATH do shell
src/main/store.js         cache da análise, histórico, preferências
src/renderer/             index.html, tokens.css, app.css, app.js, format.js, icons.js
src/renderer/controls.js  checkbox, switch, select, menu, tooltip, disclosure (sem controle nativo)
src/renderer/motion.js    countTo, swap, leave, morph (tempos vêm dos tokens)
src/renderer/fonts/       Geist e Geist Mono embarcadas (OFL)
test/                     node --test
scripts/check.mjs         regras do projeto (Lucide, cores, exclusão, contraste)
logo.jpg                  logo oficial; scripts/icon.js gera o ícone do app a partir dele
scripts/dmg-background.js fundo Retina do instalador
```

## Comandos
- `npm start` — abre o app
- `npm run verify` — check + typecheck + testes (rode antes de encerrar)
- `npm run shot -- --theme=dark --out=/tmp/x.png` — screenshot da janela
- `npm run icons` — regenera `src/renderer/icons.js`
- `npm run release` — `.app` e `.dmg` em `dist/`

## Regras inegociáveis
1. Apagar só via `src/main/cleaner.js` (Lixeira ou comando oficial da tabela). Nunca `rm`, `unlink`, `trashItem` ou comando de limpeza fora dele. Regras S1–S10 no `PRD.md`.
2. Renderer nunca envia caminho nem comando ao main; só ids de item.
3. Categoria nova segue a skill `respiro-categoria` (checklist de segurança + teste).
4. Tela nova ou ajuste visual segue `UI.md` e a skill `respiro-tela`. Cor, tipo e tempo só por token de `tokens.css`. Ícone só Phosphor. Lucide e controles nativos (`input`, `select`, `details`) proibidos: use `controls.js`.
5. Texto da interface em pt-BR, calmo, números como "12,4 GB".

## Skills do projeto (`.agents/skills/`)
`respiro-tela` criar/ajustar tela · `respiro-categoria` novo tipo de cache · `respiro-revisao` revisar tela · `respiro-release` build e release.
