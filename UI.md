# Respiro — sistema de design

Fonte única do visual. Toda tela nova sai daqui. Valores vivem em `src/renderer/tokens.css`; este documento explica o porquê e o uso. Mudou um token? Mude os dois e rode `npm run check` (valida contraste e cores fora dos tokens).

## Princípios

1. **Calma no fundo, número na frente.** Neutros quentes, muito respiro, uma única cor de destaque. O que salta aos olhos é quanto espaço existe e quanto dá para liberar.
2. **Parece do macOS.** Tamanhos de controle do macOS, vibrancy na janela, listas agrupadas como nos Ajustes do Sistema, cursor padrão em botões (seta, não mãozinha). A voz tipográfica é da Geist, embarcada.
3. **Uma superfície por grupo.** Lista agrupada sobre o fundo da janela. Nada de card dentro de card, grade de cards ou borda em volta de tudo.
4. **Cor tem função.** Destaque = ação principal, foco e seleção. Verde, âmbar e vermelho = estado (sempre com ícone e texto). Cores de categoria = só identidade na barra e no ícone da categoria.
5. **Honestidade.** Número que não dá para saber antes vira explicação, não estimativa inventada. Progresso só com denominador real.
6. **Controles nossos, comportamento do sistema.** Checkbox, switch, select, segmentado, menu, tooltip e disclosure são componentes próprios (`controls.js`), com o teclado, o foco e a leitura do VoiceOver que o macOS daria. Texto (busca) é o único controle nativo, com visual nosso.
8. **Uma camada só.** Um sheet por vez. Detalhe, confirmação, resultado, Ajustes e Histórico trocam de conteúdo dentro do mesmo sheet, com "Voltar"; nada abre por cima de nada.
9. **Carregar sem pular.** O que ainda não existe ocupa o lugar que vai ocupar (lista de verificação, placeholder do número, legenda com altura reservada).
7. **Movimento explica, não enfeita.** Só anima o que mudou de estado, curto e sem quique.

**Proibido:** gradientes chamativos, brilho/glow, neon, sombras pesadas fora de sheets, robôs, raios/relâmpagos, faíscas (✨), ícones "mágicos" ou com cara de IA, emoji na interface, ponto de exclamação, texto na cor de uma série, Lucide, cores fora dos tokens, `cursor: pointer` em controles, controles nativos de escolha (`select`, checkbox, radio, `details`), sheet sobre sheet, quique (bounce/overshoot) e animação em loop decorativa.

## Referências

| Referência | O que levamos | O que não levamos |
|---|---|---|
| App do Claude | neutros quentes (marfim, cinza-areia), um terracota contido como destaque, muito espaço, texto que conversa sem pressa | fonte serifada, logotipo, ilustrações da marca |
| Ajustes do Sistema (macOS 26) | lista agrupada com cantos de 10 px, ícone em quadrado arredondado colorido, linhas com valor à direita, sheets que descem da barra de título | sidebar (o Respiro tem uma tela só) |
| Ajustes › Geral › Armazenamento | barra única segmentada com legenda, categorias com detalhe em sheet | cores saturadas da Apple; usamos a paleta validada abaixo |

## Tokens

Definidos em `src/renderer/tokens.css` para claro e escuro. Escuro é escolhido, não invertido.

### Neutros e destaque

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--canvas` | `#f7f5ef` | `#262522` | fundo da janela (com translucidez, ver abaixo) |
| `--surface` | `#fffefb` | `#302f2b` | lista agrupada, sheets |
| `--surface-sunken` | `#ece9e1` | `#3a3934` | trilho da barra (espaço livre), campos |
| `--surface-hover` | `rgb(31 30 27 / .05)` | `rgb(242 239 232 / .06)` | hover de linha e botão de barra |
| `--separator` | `rgb(31 30 27 / .10)` | `rgb(242 239 232 / .10)` | linhas de 0,5 px entre linhas da lista |
| `--text` | `#1f1e1b` | `#f2efe8` | texto principal |
| `--text-secondary` | `#6b675e` | `#a8a397` | apoio, legendas, metadados |
| `--accent` | `#b4552f` | `#e58a62` | botão principal, foco, seleção, link |
| `--accent-hover` | `#9f4927` | `#ec9b77` | hover do botão principal |
| `--on-accent` | `#fffefb` | `#1f1e1b` | texto sobre o destaque |
| `--segment-system` | `#b9b4a8` | `#6e6a61` | "Sistema e outros" na barra |
| `--popover` | `#fffefb` | `#3a3934` | fundo de listbox e menu |
| `--selection` | `rgb(180 85 47 / .12)` | `rgb(229 138 98 / .18)` | hover do botão silencioso, pílula "Modo simular" |
| `--knob` | `#fffefb` | `#f2efe8` | botão do switch |

### Semânticas

| Token | Claro | Escuro | Ícone Phosphor | Uso |
|---|---|---|---|---|
| `--safe` | `#2f7a4f` | `#7fbf95` | `check-circle` | "seguro", sucesso |
| `--attention` | `#8a5a00` | `#e0b25a` | `warning` | "atenção", em uso recente |
| `--danger` | `#b3261e` | `#f08c80` | `warning-octagon` | ação permanente, erro |

Contraste medido (WCAG, texto normal ≥ 4,5:1) — `npm run check` repete a conta a cada mudança:
texto 15,3 / 13,3; secundário 5,2 / 5,3; destaque sobre superfície 4,9 / 5,9; texto sobre destaque 4,9 / 6,5; seguro 5,2 / 6,2; atenção 5,9 / 6,8; perigo 6,5 / 5,6.

### Cores de categoria

Ordem fixa (a cor segue a categoria, nunca a posição no ranking). A barra desenha os segmentos nesta ordem, separados por 2 px de superfície. Validado com `validate_palette.js` da skill `dataviz` (claro sobre `#f7f5ef`, escuro sobre `#2b2a27`): todas as checagens passam; o ocre claro fica abaixo de 3:1 contra o fundo, por isso a legenda com nome é obrigatória.

| # | Categoria | Token | Claro | Escuro | Ícone |
|---|---|---|---|---|---|
| 1 | Caches de pacotes | `--cat-packages` | `#3d72b8` | `#5a8fd6` | `package` |
| 2 | Docker | `--cat-docker` | `#d0702e` | `#d0702e` | `shipping-container` |
| 3 | node_modules | `--cat-node` | `#2a9a76` | `#2f9f7c` | `tree-structure` |
| 4 | Xcode | `--cat-xcode` | `#c99512` | `#b98a10` | `hammer` |
| 5 | Navegadores de teste | `--cat-browsers` | `#c8648a` | `#c86a8f` | `browsers` |
| 6 | Homebrew | `--cat-homebrew` | `#5f8a2e` | `#6f9a3a` | `beer-stein` |
| 7 | Caches e logs de apps | `--cat-appcaches` | `#6a5cc4` | `#8679de` | `stack` |
| 8 | Lixeira | `--cat-trash` | `#c4473f` | `#dc5e55` | `trash` |

Categoria nova entra no fim da ordem e precisa revalidar a paleta. Nona categoria não ganha cor nova: agrupa em uma existente.

### Tipografia

Família: **Geist** para tudo, **Geist Mono** para caminhos de pasta e comandos. As duas são variáveis (pesos 100–900), vêm de `geist@1.7.2` (Vercel, SIL OFL 1.1) e ficam embarcadas em `src/renderer/fonts/` com a licença: o app não busca nada na rede. Números usam Geist com `font-variant-numeric: tabular-nums` (a Geist tem algarismos tabulares), então colunas de tamanho alinham sem precisar de mono.

A Geist é um pouco mais larga e mais aberta que a SF. Para caber no tamanho de app de Mac sem parecer site: corpo em 13 px com linha de 19 px, pesos intermediários (550 no headline, 450 no footnote) e espaçamento negativo crescente com o tamanho.

| Token | Tamanho/linha | Peso | Espaçamento | Uso |
|---|---|---|---|---|
| `--type-display` | 34/40 | 600 | `--track-display` −0,04em | total "pode ser liberado", total do histórico |
| `--type-title` | 17/22 | 600 | `--track-title` −0,02em | título de sheet, espaço livre do disco |
| `--type-headline` | 13/18 | 550 | `--track-headline` −0,006em | nome de categoria, título da janela |
| `--type-body` | 13/19 | 400 | `--track-body` −0,003em | texto padrão, valores |
| `--type-callout` | 12/16 | 400 | 0 | subtítulo de linha, ajuda, rótulo de grupo (600) |
| `--type-footnote` | 11/14 | 450 | `--track-small` +0,008em | legenda da barra, rodapé, tooltip |
| `--type-mono` | 11/15 Geist Mono | 400 | 0 | caminho de pasta (`~/Library/Caches/pip`), comando oficial |

Regra de uso: texto que a pessoa pode copiar e colar no Terminal vai em mono; o resto é Geist.

### Espaço, raio, sombra, camada

- Espaço (grade de 4): `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 20, `--space-6` 24, `--space-8` 32, `--space-10` 40.
- Raio: `--radius-control` 6 (botões, select), `--radius-check` 4,5 (checkbox), `--radius-group` 10 (lista agrupada), `--radius-popover` 9 (listbox, menu), `--radius-sheet` 12, `--radius-bar` 5, `--radius-icon` 6, `--radius-pill` 999 (switch, pílula).
- Sombra: só no que flutua. `--shadow-sheet` para sheets; `--shadow-popover` (`0 10px 32px -8px` + anel de 0,5 px) para listbox e menu; `--shadow-control` (0,5 px) para controles elevados (botão secundário, select, checkbox, botão do switch).
- Camadas: conteúdo 0, barra de título 10, sheet 40, popover 45, tooltip 50. Sheet, popover e tooltip vivem na top layer do navegador (`<dialog>` e `popover`), então a ordem segue a ordem de abertura.

### Translucidez

- Janela com `vibrancy: 'under-window'` e `visualEffectState: 'followWindow'`. No claro, o `--canvas` é aplicado com 82 % de opacidade (`--canvas-tint`), então o desktop aparece borrado só como temperatura de cor. No escuro, `--canvas-tint` é opaco: com transparência, o material da janela clareia o fundo e o modo escuro vira cinza médio.
- Superfícies (`--surface`, `--popover`) são opacas. Texto nunca fica direto sobre a vibrancy sem o tint.
- `prefers-reduced-transparency: reduce` → `--canvas-tint` vira opaco.
- `prefers-contrast: more` → separadores e bordas de controle sobem para 30 % de opacidade.

## Ícones

Phosphor Icons, peso **regular**, SVG inline gerado por `npm run icons` a partir de `@phosphor-icons/core` (lista em `scripts/icons.mjs`). Lucide é proibido e bloqueado pelo `npm run check`. O traço do checkbox é desenhado à mão (um `path` com `pathLength="1"`) para poder ser animado.

| Contexto | Ícone | Tamanho |
|---|---|---|
| Glifo branco no quadrado colorido da categoria (28 px; 32 px no sheet) | ver tabela de categorias | 16 |
| Linha, botão com texto, estado, item de menu | — | 14–16 |
| Botão só ícone da barra de título | `clock-counter-clockwise`, `arrow-clockwise`, `gear-six` | 18 |
| Menu de ações do item | `dots-three` → `folder-open`, `copy` | 16 / 14 |
| Select | `caret-up-down` | 12 |
| Disclosure e chevron da linha | `caret-right` | 12 |
| Resultado da limpeza | `check-circle`, `hard-drives`, `trash`, `info`, `eye` | 16 |
| Alerta de sheet | `warning-octagon` | 28 |

Ícone decorativo leva `aria-hidden="true"`; botão só ícone leva `aria-label` e tooltip (`data-tip`). Um conceito, um ícone.

## Layout

- Janela: 820 × 700 inicial, mínimo 680 × 560. Conteúdo com largura máxima de 680 px centralizado, margem lateral de 32 px.
- Barra de título de 52 px, área arrastável (`-webkit-app-region: drag`), semáforos em `{ x: 18, y: 18 }`. Controles dentro dela usam `no-drag`.
- Ordem da tela principal: barra de título → resumo do disco (nome, espaço livre, barra, legenda) → 40 px de respiro → destaque "Pode ser liberado com segurança" → lista agrupada → rodapé com o estado da análise.

## Componentes

Todos os interativos estão em `src/renderer/controls.js` (genéricos) e `app.js` (do Respiro). `npm run check` reprova `select`, `details`, `summary` e `input` de checkbox, radio, range, color ou date no renderer; `input` de texto (busca) é permitido.

### Marca em movimento (`loader.js`)
- O anel aberto do ícone (`pathLength` 100: arco de 89, abertura de 11 à direita, ponta redonda, `--accent`) é o indicador de carregamento do app. Em espera ele **respira**: gira uma volta a cada 2,4 s e o arco abre e fecha (89 → 54) a cada 1,2 s.
- `ring(size)`: linha pendente (12 px), botão ocupado (14 px), barra de título (18 px, com trilho `--separator` e o arco crescendo com as categorias prontas). Anéis recriados a cada render seguem o mesmo relógio (`--phase`), sem voltar ao início.
- `hero(texto)`: o anel se forma girando (escala 0,35 → 1,1 → 1, 900 ms), depois abre espaço e o nome "Respiro" se revela da esquerda para a direita, com a frase embaixo.
- Movimento reduzido: anel parado, nome e frase aparecem direto.

### Carregamento (primeira análise)
- Sem resultado salvo, a lista vira uma **lista de verificação** com as 8 categorias na ordem fixa, nas mesmas posições do resultado. Pendente: ícone em cinza a 35 % e anel de 12 px + "Analisando…". Encontrada: o ícone ganha cor e a linha mostra o resumo e o tamanho, no lugar. Ausente: "Não encontrado neste Mac", esmaecida. Nada muda de lugar enquanto analisa.
- No lugar do número "Pode ser liberado" fica o `hero` com "Somando o que dá para liberar sem risco…" (mesmo elemento entre renders, a abertura não recomeça). A seção tem altura mínima; a legenda reserva duas linhas.
- A barra começa com "Ocupado" e "Livre"; cada categoria encontrada se separa do "Ocupado" deslizando.
- No fim, a lista de verificação vira a lista final (ordenada por tamanho, ausentes somem) numa única View Transition.
- Com resultado salvo, a tela fica parada durante a reanálise; só o anel da barra de título e o rodapé mudam, e o resultado novo entra inteiro no fim.
- O anel é o único movimento em loop do app e só existe enquanto algo carrega (fora o brilho das boas-vindas).

### Barra de disco segmentada
- Altura 18 px, raio 5. Segmentos na ordem fixa das categorias, depois "Sistema e outros" (`--segment-system`); o espaço livre é o trilho `--surface-sunken` à direita.
- 2 px de vão entre segmentos (o fundo da janela aparece). Segmento não vazio tem no mínimo 3 px.
- Hover num segmento: os outros caem para 55 % de opacidade e o tooltip mostra "Docker · 12,4 GB".
- Acessível: `role="img"` com `aria-label` em frase. A legenda abaixo é lista de texto: ponto de 8 px + nome + tamanho em `--type-footnote`.

### Destaque "Pode ser liberado com segurança"
- Rótulo em `--type-callout` secundário; número em `--type-display`; botão principal "Revisar e liberar…" à direita, alinhado à base.
- Nada seguro → número e botão somem; fica "Nada seguro para liberar agora."
- Parte que só se mede depois (pnpm) → nota "Mais o que só se mede ao limpar."

### Linha de categoria
- Lista agrupada (`--surface`, raio 10, separador de 0,5 px recuado após o ícone). Altura mínima 60 px.
- Esquerda: quadrado de 28 px na cor da categoria com glifo branco. Centro: nome (`headline`) e subtítulo (`callout`) com o seguro em `--safe` + ícone, ou a nota de estado. Direita: tamanho (tabular), "Limpar" e chevron.
- "Limpar" é botão silencioso (texto `--accent`, sem borda) e **só aparece quando há algo seguro**. Menos caixas na tela, a ação continua a um clique. Na Lixeira a ação é "Esvaziar…" (silencioso perigo) e o subtítulo diz "19 itens · esvaziar apaga para sempre".
- Subtítulo sem nada seguro: "N itens pedem atenção" (âmbar) ou "Nada seguro agora · N em uso" (neutro).
- A linha inteira é um botão que abre o detalhe; "Limpar" é outro botão, nunca aninhado.
- Estados: indisponível ("O Docker está fechado…" + "Abrir Docker"), sem acesso ("Abrir Ajustes"), erro ("Tentar de novo").

### Botões
| Variante | Visual | Uso |
|---|---|---|
| Principal | fundo `--accent`, texto `--on-accent`, 28 px, raio 6 | uma por região: "Revisar e liberar…", "Liberar 12,4 GB" |
| Secundário | fundo `--surface`, anel 0,5 px `--control-border` + `--shadow-control`; hover `--surface-sunken` | "Cancelar", "Fechar" |
| Silencioso | só texto `--accent`, 24 px; hover `--selection` | "Limpar" na linha, "Abrir Docker", "Tentar de novo" |
| Silencioso perigo | só texto `--danger` | "Apagar…" do volume, "Esvaziar…" |
| Destrutivo | fundo `--danger`, texto `--on-accent` | "Apagar volume", "Esvaziar Lixeira" |
| Ícone | 28 × 28 (24 no item), raio 6, hover `--surface-hover` | barra de título, menu do item |
Estados: hover, pressionado (brilho −6 %), foco visível, ocupado ("Liberando…", desabilitado), desabilitado (40 %).

### Checkbox
- `<button role="checkbox" aria-checked>`, 16 × 16, raio 4,5. Desmarcado: `--surface` com anel de 1 px `--control-border`. Marcado: `--accent` e o traço de check se desenha (`stroke-dashoffset`, `--dur-state`). Em alerta de risco, marcado usa `--danger`.
- Nome: `aria-labelledby` aponta para o texto do item; clicar no texto também alterna.
- Teclado: Tab chega, Espaço (ou Enter) alterna.

### Switch
- `<button role="switch" aria-checked>`, 34 × 20, trilho `--surface-sunken`, ligado `--accent`; botão de 16 px (`--knob`) desliza 14 px com `--dur-state` `--ease-out`.
- Nome por `aria-labelledby` (rótulo da linha), descrição por `aria-describedby`. Clicar no rótulo alterna. Espaço ou Enter alterna.

### Select
- Gatilho: botão 26 px com o valor e `caret-up-down`, `aria-haspopup="listbox"`, `aria-expanded`, nome = rótulo da linha + valor.
- Lista: `role="listbox"` num `popover="auto"` ancorado no gatilho (CSS anchor positioning), alinhado pela direita, mesma largura mínima do gatilho. Opção ativa com fundo `--accent` e texto `--on-accent`, como no menu do macOS; a selecionada leva `check`.
- Teclado: ↑/↓ abrem e movem, Home/End, letra pula para a opção, Enter/Espaço escolhem, Esc e Tab fecham. Clique fora fecha. Ao fechar, o foco volta ao gatilho. A opção ativa é anunciada por `aria-activedescendant`.

### Menu
- Gatilho: botão de ícone (`dots-three`) com `aria-haspopup="menu"`. Painel `role="menu"` em `popover="auto"`, itens `role="menuitem"` com ícone de 14 px.
- Aberto pelo teclado, o foco vai ao primeiro item; pelo mouse, o menu recebe o foco sem destacar nada. ↑/↓, Home/End, Enter executa, Esc/Tab/clique fora fecham e devolvem o foco.
- Uso atual: ações do item no detalhe ("Mostrar no Finder", "Copiar caminho", "Ignorar sempre").

### Tooltip
- Um só elemento `role="tooltip"` (`popover="manual"`), ancorado abaixo de quem tem `data-tip`. Fundo `--text`, texto `--canvas`, `--type-footnote`.
- Mouse: aparece depois de `--dur-tooltip-delay` (450 ms). Teclado: aparece no foco visível. Some no clique, ao sair, no blur e com Esc.
- Não substitui nome acessível: o botão já tem `aria-label`; o tooltip é ajuda visual (inclui o atalho, ex.: "Reanalisar ⌘R").

### Controle segmentado
- `role="radiogroup"` com opções `role="radio"`: trilho `--surface-sunken`, raio 7, opção escolhida sobe como `--surface` com `--shadow-control`. Altura 22 px, `--type-callout` 500, contagem opcional em peso 400.
- Teclado: só a opção escolhida entra no Tab; ←/→ (e ↑/↓) movem e escolhem, Home/End nas pontas.
- Uso: filtro do detalhe ("Todos 66 · Seguros 2 · Em uso 64", opções vazias somem) e Aparência nos Ajustes.

### Busca
- `input type="search"` nativo (texto) dentro de um rótulo com `magnifying-glass`: fundo `--surface-sunken`, 26 px, raio 6, foco no contorno do conjunto. Sem o "x" nativo.
- Filtra enquanto digita, sem diferenciar maiúsculas, por nome e pasta. Esc com texto limpa a busca; Esc vazio volta a valer para o sheet.

### Disclosure
- `<button aria-expanded aria-controls>` com `caret-right` que gira 90°. O painel abre animando a altura (`grid-template-rows` 0fr → 1fr, `--dur-collapse`) e fica `inert` quando recolhido, fora do Tab e do VoiceOver.
- Uso: grupo "Protegidos" do detalhe (recolhido por padrão) e "Ver 23 itens" das partes de um comando.

### Sheet único e navegação
- Um `<dialog>` modal de 560 px que desce da barra de título. Telas dentro dele: detalhe → confirmação → resultado; Ajustes; Histórico; confirmação individual.
- Passo com anterior mostra "Voltar" no lugar de "Cancelar"; Esc volta um passo; sem anterior, Esc fecha. Clique no fundo escurecido fecha tudo. Durante a limpeza, Esc e clique fora ficam bloqueados.
- Ao fechar, o foco volta para quem abriu e a lista principal aplica as mudanças pendentes com transição.

### Detalhe da categoria
- Cabeçalho: ícone da categoria, título, frase do que é aquilo.
- Com mais de 6 itens, barra de filtros fixa entre o cabeçalho e a lista (o sheet fica com altura máxima para não pular): segmentado (Todos, Seguros, Atenção, Em uso, com contagem), busca, "Ordenar" (select: Tamanho, Uso mais antigo, Nome) e "Marcar visíveis"/"Desmarcar visíveis".
- Sem filtro, corpo em três grupos com rótulo e contagem:
  - **Seguros** (marcados), **Pedem atenção** (desmarcados, com `warning`; pasta do administrador com `lock-simple`), **Em uso** (recolhido; itens com checkbox desmarcado; bloqueados pelo Docker com `lock-simple` e sem checkbox).
  - Motivo igual para todo o grupo aparece uma vez sob o rótulo e some das linhas.
- Com filtro, busca ou outra ordem: lista única, com as notas em cada item.
- Item: checkbox, nome, metadado (caminho em mono · "usado há 3 meses"), nota, tamanho e menu ··· ("Mostrar no Finder", "Copiar caminho", "Ignorar sempre"). Ignorado sai da lista com a animação de saída.
- Rodapé fixo: "5 itens · 4,1 GB" (ou "valor aparece ao limpar") + "Fechar" + "Limpar selecionados".

### Confirmação de limpeza
- Título com o valor: "Liberar 12,4 GB?". Lista exata, agrupada por método ("Vai para a Lixeira", "Limpo pelo comando oficial" com o comando em mono).
- Nota quando houver Lixeira: "O espaço volta quando você esvaziar a Lixeira."
- "Cancelar" e "Liberar 12,4 GB". Modo simular: botão "Simular" e subtítulo "Modo simular: nada será apagado."
- Foco inicial no principal quando tudo é reversível; em "Cancelar" quando há algo permanente.
- Itens em uso selecionados: aviso âmbar "N itens estão em uso. Projetos vão pedir pnpm install e apps abertos recriam o cache. Tudo vai para a Lixeira: dá para recuperar." e foco inicial em "Voltar".
- Pasta do administrador: selo "senha" no item e aviso "O macOS vai pedir sua senha uma vez para devolvê-los ao seu usuário; depois eles vão para a Lixeira." O botão mostra "Aguardando a senha…".
- Ao confirmar, o mesmo sheet troca de conteúdo para o resultado (ver Movimento).

### Confirmação individual (volume Docker, Lixeira)
- Tela do sheet com `warning-octagon` em `--danger`, nome em destaque, frase do risco e checkbox (variante perigo) "Entendo que os dados serão apagados para sempre", que habilita o botão destrutivo. Foco inicial em "Voltar"/"Cancelar".

### Resultado
- Linhas com ícone: "34 MB removidos pelas ferramentas.", "O espaço livre do disco aumentou 36 MB.", "… foram para a Lixeira.", falhas com o motivo em frase ("Sem permissão: parte dos arquivos pertence ao administrador…"). Os números contam a partir de zero.
- Limpeza que veio do detalhe ganha "Ver categoria": volta ao detalhe e mostra os itens limpos saindo da lista.

### Progresso
- Análise: linha de 2 px sob a barra de título com progresso real (categorias concluídas ÷ total), que some ao terminar; rodapé "Analisando… 3 de 8".
- Limpeza: botão ocupado com anel de 14 px ("Liberando…"); Esc e clique fora ficam bloqueados até o fim.

### Vazio e erro
- Vazio: "Nada para liberar agora." Sem ilustração.
- Erro de categoria: inline na linha. Erro de limpeza: texto `--danger` no próprio alerta, com "Nada foi apagado." quando nada começou.

### Ajustes (⌘,) e Histórico (⌘Y)
- Ajustes em três seções com rótulo (`group-label`), tudo salva na hora:
  - **Geral:** Aparência (segmentado Automático/Claro/Escuro; aplica `nativeTheme.themeSource`, a vibrancy acompanha), Idioma (select: Automático, Português (Brasil), English, Español, cada um no próprio idioma), Analisar ao abrir, Mostrar na barra de menus, Abrir ao iniciar sessão (switches) e Avisar quando o disco tiver menos de (select: Não avisar, 10/15/20 % livre).
  - **Limpeza:** Modo simular (switch), Projetos parados há mais de (select 30/60/90 dias), Itens ignorados (lista com "Mostrar de novo"; vazio: "Nenhum. Use o menu ··· de um item para ignorá-lo.").
  - **Permissões:** Acesso Total ao Disco com status "Concedido" (`check-circle`) ou "Abrir Ajustes do Sistema…", e a frase de que pastas criadas com sudo pedem a senha na hora de limpar.
- Histórico: gráfico do espaço livre no topo, depois total removido em `--type-display`, aumento medido do espaço livre abaixo, lista por data.

### Gráfico do espaço livre (`chart.js`)
- Linha de 2 px em `--chart-line` com área `--chart-fill`; ponto de 8 px com anel `--surface` de 2 px em cada limpeza. Cor validada com o validador da skill `dataviz` contra `--surface` no claro (`#b4552f`) e no escuro (`#d8774e`; o `--accent` do escuro sai da faixa de luminosidade).
- Eixo Y com três linhas de grade (0, meio, teto "redondo" 1/2/5 × 10ⁿ) em `--separator`; rótulos e datas em `--text-secondary`, `--type-footnote`, dígitos tabulares. Texto nunca na cor da série.
- Segmentado 30 dias / 90 dias / 1 ano ao lado do título "Espaço livre".
- Hover e setas (Home/End) mostram cruz pontilhada, ponto vazado e dica (valor em `--type-headline`, data, "Limpeza" com bolinha). Tabela `sr-only` com todas as amostras. Menos de duas amostras: frase explicando que o gráfico se completa com o tempo.

### Boas-vindas (`welcome.js`)
- `<dialog>` em tela cheia sobre a janela, só no primeiro uso (`prefs.onboarded`), fundo `--canvas`, área de arrastar de 44 px no topo, "Pular" no canto direito.
- Cinco passos, coluna de 460 px centralizada: arte → título (30/36, `--track-display`) → texto (15/22, `--text-secondary`) → controles. Rodapé: pontos (o atual vira pílula de 20 px em `--accent`), "Voltar" e o botão principal.
  1. **Marca:** anel de 104 px se formando sobre um brilho radial (`--accent-glow`) que respira; seletor de idioma.
  2. **O que ele acha:** as 8 categorias em cartões (4 × 2) entrando em cascata, com a análise real ao vivo (anel → tamanho ou "Não encontrado").
  3. **Seguro por padrão:** três linhas de exemplo; "Cache do npm" voa para a Lixeira em loop, "Documentos" e "Container rodando" ficam com cadeado. Quatro garantias com ícone.
  4. **Permissões:** selo com `shield-check`; cartão com o status real do Acesso Total ao Disco (atualiza ao voltar dos Ajustes do Sistema), barra de menus e abrir ao iniciar.
  5. **Pronto:** o anel fecha num círculo e aparece um visto; frase com o valor real encontrado (ou "a análise termina em instantes").
- Troca de passo: sai para o lado (`--dur-exit`) e o próximo entra do outro (`--dur-enter`). Teclado: Enter no botão principal (já focado), ←/→. Esc não fecha. Movimento reduzido: tudo parado, só troca.

### Barra de menus (`tray.js`)
- Ícone template de 18 pt desenhado em código (o mesmo anel do logo) com o espaço livre ao lado em dígitos tabulares. Disco abaixo do limite: o anel deixa de ser template e fica `--danger`.
- Menu nativo: "X livres de Y", aviso de pouco espaço, "Dá para liberar X · análise há…", Abrir Respiro, Analisar agora, Ajustes…, Encerrar Respiro.

## Movimento

Princípio: anima a **causa e o efeito** de uma ação (abriu, mudou, saiu, liberou). Curto, desacelerando, sem quique. No máximo duas coisas se movem juntas.

| Token | Valor | Com "reduzir movimento" |
|---|---|---|
| `--dur-response` | 120 ms | igual (só cor) |
| `--dur-state` | 220 ms | 120 ms, só opacidade |
| `--dur-enter` | 320 ms | 0 |
| `--dur-exit` | 160 ms | 100 ms, só opacidade |
| `--dur-collapse` | 240 ms | 0 |
| `--dur-number` | 700 ms | 0 (valor final direto) |
| `--dur-tooltip-delay` | 450 ms | igual |
| `--ease-out` | `cubic-bezier(.22, 1, .36, 1)` | — |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | — |
| `--ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` | — |
| `--ease-sheet` | `cubic-bezier(.32, .72, 0, 1)` (parecida com a dos sheets do macOS) | — |
| `--distance-sheet` | 10 px | 0 |
| `--distance-item` | 6 px | 0 |
| `--scale-sheet` / `--scale-popover` | 0,985 / 0,97 | 1 |

| O quê | Como | Tempo e curva |
|---|---|---|
| Sheet abre / fecha | opacidade + desce 10 px + escala 0,985 → 1; fundo escurece junto. Fecha no caminho inverso, mais rápido (CSS `@starting-style` + `transition-behavior: allow-discrete`) | abre `--dur-state` `--ease-sheet`; fecha `--dur-exit` `--ease-in` |
| Troca de tela no mesmo sheet (detalhe → confirmação → resultado, Voltar, Ajustes ↔ Histórico) | conteúdo atual some, a altura do sheet acompanha, o novo entra subindo 6 px (`motion.js › swap`) | `--dur-exit`, depois `--dur-collapse` + `--dur-state` |
| Expandir grupo / partes | altura 0fr → 1fr e opacidade; caret gira 90° | `--dur-collapse` `--ease-out` |
| Barra de disco atualiza | largura de cada segmento anima de onde estava; na primeira análise cresce do zero | `--dur-enter` `--ease-out` |
| Lista de categorias reordena ou perde um item | View Transition com nome por linha (`row-<id>`): linhas deslizam para o novo lugar, a que sai some | `--dur-enter` `--ease-out`; saída `--dur-exit` |
| Itens saindo depois da limpeza | some, depois a linha encolhe até 0 (`motion.js › leave`) | `--dur-collapse` + `--dur-exit` `--ease-in-out` |
| Números ao liberar | espaço livre e total seguro contam do valor anterior ao novo; no resultado, de zero (`motion.js › countTo`, cúbica de saída) | `--dur-number` |
| Popover (select, menu) | opacidade + escala 0,97 → 1 a partir do canto do gatilho | abre `--dur-state` `--ease-out`; fecha `--dur-exit` |
| Checkbox / switch | traço do check se desenha; botão do switch desliza | `--dur-state` `--ease-out` |
| Progresso da análise | largura real; some com fade ao terminar | `--dur-enter` / `--dur-state` |
| Lista de verificação | ícone ganha cor e o texto troca no lugar; no fim, uma View Transition vira a lista final | `--dur-state`; `--dur-enter` |
| Placeholder do número | respira de opacidade enquanto espera (desligado com movimento reduzido) | 1,4 s `--ease-in-out`, alternado |
| Spinner | gira enquanto a categoria é analisada | 900 ms linear |
| Controle segmentado | fundo e sombra da opção escolhida | `--dur-response` |

Regras: nada em loop além do spinner e do placeholder, e só enquanto a análise existe; nada bloqueia clique esperando animação; com sheet aberto a lista atualiza sem View Transition (evita capturar a top layer). `prefers-reduced-motion: reduce` vale desde a carga e quando muda com o app aberto: os tokens mudam no CSS e o JS lê os tokens na hora (`motion.js › token`), então tudo que se desloca, cresce ou conta vira fade curto ou troca direta.

## Instalador (.dmg)

- Janela de 640 × 440 sem barra de ferramentas, barra lateral nem barra de status, visão de ícones sem grade.
- Fundo `#f7f5ef` (o `--canvas` claro), seta fina `#c4bdb0` entre os ícones e a frase "Arraste o Respiro para Aplicativos" em Geist 13 px `#6b675e`, centrada a 318 px do topo. Nada mais.
- Ícones de 112 px: Respiro em (180, 196), atalho "Aplicativos" em (460, 196); a seta ocupa de 276 a 363 px na mesma altura. Nomes em 12 px embaixo.
- Fundo Retina: `scripts/dmg-background.js` desenha em 2x (1280 × 880) com a Geist embutida, o `sips` gera o 1x e o `tiffutil -cathidpicheck` junta os dois em `.background/background.tiff`.
- Sempre claro: com imagem de fundo, o Finder trata a janela como modo claro e desenha os nomes em preto, também no modo escuro.
- Volume "Respiro" com o ícone do app (`.VolumeIcon.icns` + atributo de ícone personalizado). O layout é gravado pelo Finder via AppleScript durante `npm run release`; o ícone do volume entra por último, porque o Finder o apaga ao gravar o layout.

## Escrita

- Português do Brasil, voz ativa, frases de até 12 palavras. Tom calmo: sem pressa, sem alarme, sem "turbinar", "otimizar", "purgar", "artefatos".
- Números: unidades decimais como o Finder (1 GB = 1.000.000.000 bytes), vírgula decimal, uma casa abaixo de 100 ("12,4 GB"), nenhuma a partir de 100 ("245 GB"). Abaixo de 1 GB usa MB sem casa.
- Datas relativas: "hoje", "ontem", "há 3 dias", "há 2 meses".
- Termo técnico vem com explicação curta na primeira vez: "cache (arquivos que a ferramenta baixa de novo quando precisa)", "volume (onde um container guarda dados, como um banco)".
- Comando só aparece na confirmação e no detalhe, em mono, para quem quer conferir.

| Situação | Texto |
|---|---|
| Destaque | Pode ser liberado com segurança |
| Botão principal | Revisar e liberar… |
| Análise | Analisando Docker… 3 de 8 |
| Pós-limpeza | 12,4 GB removidos pelas ferramentas. O espaço livre do disco aumentou 11,9 GB. 3,1 GB foram para a Lixeira. |
| Ganho menor que o removido | A diferença é de arquivos que projetos ainda usam (o APFS compartilha cópias entre pastas) ou de espaço que volta depois, como no Docker Desktop. |
| Docker Desktop | O Docker Desktop pode levar alguns minutos para devolver esse espaço ao macOS. |
| Protegido | Projeto ativo, fica de fora. |
| Instalador | Arraste o Respiro para Aplicativos |
| Sem acesso | Para medir a Lixeira, o Respiro precisa de Acesso Total ao Disco. |

## Acessibilidade

- Contraste: texto ≥ 4,5:1, controles e foco ≥ 3:1, medidos pelo `npm run check`.
- Foco: anel de 2 px `--accent` com afastamento de 2 px em `:focus-visible`, nunca removido.
- Teclado: Tab percorre barra de título → destaque → linhas; Enter abre detalhe; Espaço marca item; Esc fecha popover, depois sheet, e devolve o foco a quem abriu; ⌘R reanalisa; ⌘, ajustes; ⌘Y histórico.
- Componentes próprios seguem os padrões WAI-ARIA: checkbox, switch, listbox (com `aria-activedescendant`), menu (foco itinerante) e disclosure (`aria-expanded` + painel `inert`). Teclas de cada um estão na seção Componentes.
- VoiceOver: barra com frase completa; ícones decorativos ocultos; status da análise e resultado da limpeza em região `aria-live="polite"`; botões só ícone com nome; número que conta é anunciado pelo resumo final, não a cada quadro.
- Zoom do texto (⌘+) não quebra layout: medidas de texto em px escalam com o zoom do Electron.
- Cor nunca sozinha: seguro, atenção e protegido têm ícone e palavra.
