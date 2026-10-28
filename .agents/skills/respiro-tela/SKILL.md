---
name: respiro-tela
description: Criar ou ajustar uma tela, sheet ou componente do Respiro seguindo o UI.md. Use para qualquer mudança visual ou de texto no renderer (src/renderer).
---

# Tela do Respiro

1. Leia em `UI.md` só as seções que a tela usa (componente, tokens, escrita). Não invente variante: se faltar, acrescente ao `UI.md` primeiro.
2. Escreva o trabalho da tela numa frase: o que a pessoa decide aqui? Tudo que não ajuda nessa decisão sai.
3. Monte com HTML semântico em `src/renderer/`:
   - Sheet e alerta = `<dialog>` com `showModal()`; Esc fecha; foco volta para quem abriu.
   - Linha clicável = `<button>`; nunca botão dentro de botão.
   - Texto dinâmico entra por `textContent` (nome de pasta pode conter HTML).
   - Controles: `checkbox`, `toggle`, `select`, `menu`, `disclosure` e tooltip (`data-tip`) de `controls.js`. Nunca `input`, `select` ou `details` nativos (o check reprova). Faltou um controle? Crie em `controls.js` com o padrão WAI-ARIA e documente em `UI.md › Componentes`.
   - Ícone: `svg('nome')` de `controls.js`. Faltou? Adicione o nome em `scripts/icons.mjs` e rode `npm run icons`.
   - Número: `formatBytes`/`formatAgo` de `format.js`.
4. Estilo só com `var(--token)` de `tokens.css`. Cor literal fora de `tokens.css` reprova no `npm run check`.
5. Estados que podem acontecer: carregando, vazio, erro, sem acesso, ocupado. Cada um com texto do `UI.md › Escrita`.
6. Movimento: use `motion.js` (`swap` para trocar conteúdo de sheet, `leave` para item que sai, `countTo` para número que muda, `morph` para reordenar lista) e tokens `--dur-*`/`--ease-*` no CSS. Nada de tempo fixo em ms no código. Confira com `prefers-reduced-motion` ligado.
7. Prova: `npm run verify`, depois `npm run shot -- --theme=light --out=<scratch>/l.png` e `--theme=dark`. Olhe as duas imagens. Passe a skill `respiro-revisao` antes de encerrar.
