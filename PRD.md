# Respiro — PRD

## Problema

Quem desenvolve no Mac perde dezenas de gigabytes para caches de pacotes, imagens e volumes do Docker, `node_modules` esquecidos, DerivedData do Xcode e navegadores de teste. O Armazenamento do macOS mostra tudo isso como "Dados do Sistema" ou "Desenvolvedor", sem dizer o que é seguro apagar. A pessoa acaba rodando `rm -rf` em pastas que não conhece ou desiste e compra disco.

## Público

Dev em macOS (Apple Silicon ou Intel) que usa Node, Docker, Xcode, Homebrew ou Python. Sabe o que é um cache, mas não quer pesquisar onde cada ferramenta guarda o seu nem qual comando limpa sem quebrar nada.

## Objetivo

Abrir o app e, em um segundo, ver quanto do disco está ocupado, o que ocupa e quanto dá para liberar com segurança. Liberar com dois cliques, sem risco de apagar dado pessoal, código ou banco de dados.

## O que o Respiro não faz

- Não mapeia o disco inteiro (treemap, arquivos grandes, duplicados).
- Não toca em documentos, fotos, código-fonte, configurações, Keychain, `~/.ssh`, `.env` nem em pastas do sistema.
- Não desinstala apps, não limpa snapshots do Time Machine, backups de iPhone, Mail ou Fotos.
- Não usa `sudo` no terminal nem apaga nada como root. A senha de administrador só aparece no diálogo do macOS para devolver ao usuário uma pasta criada com sudo (S11).
- Não roda limpeza agendada nem fica na barra de menus.
- Não envia dados para fora da máquina (sem telemetria, sem rede).

## Funcionalidades

Prioridade: **P0** sem isso não lança; **P1** lança junto; **P2** depois.

### P0 — Estado do disco
Total, ocupado e livre do volume de inicialização, numa barra única segmentada por categoria, com "Sistema e outros" e "Livre".
- Aceite: barra e números aparecem em até 1 s após abrir, mesmo antes da análise terminar.
- Aceite: soma dos segmentos = ocupado; nenhuma categoria contada duas vezes.

### P0 — Análise por categoria
Detecta o que existe na máquina. Categoria ausente não aparece.

| Categoria | Origem | Como limpa |
|---|---|---|
| Caches de pacotes | pnpm store, metadados do pnpm, npm, yarn, bun, pip | `pnpm store prune`, `npm cache clean --force`, `yarn cache clean`, `bun pm cache rm`, `pip3 cache purge`; metadados do pnpm e cache do bun sem CLI vão para a Lixeira |
| Docker | containers parados, imagens sem uso, cache de build, volumes sem uso | `docker container rm`, `docker image rm`, `docker builder prune -a -f`, `docker volume rm` (um por vez) |
| node_modules | projetos sob a pasta pessoal sem atividade há mais de 30 dias (ajustável) | Lixeira |
| Xcode | DerivedData, simuladores indisponíveis, cache do Xcode | DerivedData e cache para a Lixeira; simuladores com `xcrun simctl delete unavailable` |
| Navegadores de teste | revisões do Playwright que nenhuma instalação usa | Lixeira (mesma regra do coletor do Playwright: `.links` + `browsers.json`) |
| Homebrew | downloads em cache e versões antigas | `brew cleanup --prune=all` (prévia com `-n`) |
| Caches e logs de apps | `~/Library/Caches` e `~/Library/Logs`, sem `com.apple.*` e sem o que já está em outra categoria | Lixeira |
| Lixeira | `~/.Trash` | Finder esvazia (permanente) |

- Aceite: cada categoria mostra espaço ocupado, quanto é seguro liberar e um botão de limpar.
- Aceite: lista ordenada por tamanho ocupado.
- Aceite: quando a ferramenta não deixa saber o ganho antes (ex.: `pnpm store prune`), o app diz isso em vez de inventar número e mostra o valor medido depois.

### P0 — "Pode ser liberado com segurança"
Total em destaque = soma dos itens seguros de todas as categorias.
- Aceite: inclui só itens seguros (regras abaixo); itens de atenção, volumes Docker e a Lixeira ficam fora do total.

### P0 — Detalhe da categoria
Sheet com cada item: nome, tamanho, data do último uso quando houver, e o motivo de estar protegido ou exigir atenção.
- Aceite: itens seguros vêm marcados; itens de atenção vêm desmarcados; itens protegidos não são selecionáveis.
- Aceite: "Mostrar no Finder" para itens com caminho.

### P0 — Confirmação e limpeza
- Aceite: antes de apagar, mostra a lista exata, o método de cada item (Lixeira ou comando) e o total.
- Aceite: depois, mostra o que as ferramentas removeram, quanto o espaço livre do disco aumentou de fato (medido antes/depois), o que foi para a Lixeira e o que falhou, com o motivo.
- Aceite: quando o disco ganha bem menos do que foi removido, explica por quê (arquivos compartilhados por clones do APFS, disco virtual do Docker).

### P0 — Modo simular
- Aceite: com o modo ativo, o mesmo fluxo roda e termina em "Seriam liberados X. Nada foi apagado." Nenhum processo de limpeza é iniciado e nenhum arquivo muda.

### P1 — Abertura instantânea e análise em segundo plano
- Aceite: último resultado salvo aparece ao abrir, com "Atualizado há…"; a nova análise roda em segundo plano com progresso discreto e substitui categoria por categoria.

### P1 — Filtros no detalhe
- Aceite: categoria com mais de 6 itens mostra filtro (Todos, Seguros, Atenção, Em uso, com contagem), busca por nome ou pasta, ordenação (tamanho, uso mais antigo, nome) e "Marcar visíveis".

### P1 — Itens em uso limpáveis
- Aceite: projeto ativo, app ou Xcode aberto e Playwright em uso podem ser marcados no grupo "Em uso". Nunca vêm marcados, não entram no total seguro e a confirmação avisa o efeito (reinstalar dependências, cache recriado).

### P1 — Pastas do administrador
- Aceite: pasta criada com sudo (dono root) aparece em "Pedem atenção" com cadeado. Ao limpar, o macOS pede a senha uma vez; o app devolve a pasta ao usuário (`chown`) e só então a manda para a Lixeira. Senha recusada: nada muda.

### P1 — Ajustes
- Aceite: Aparência (Automático, Claro, Escuro), Analisar ao abrir, Modo simular, Projetos parados há mais de, Itens ignorados (com "Mostrar de novo") e Acesso Total ao Disco com status e atalho para os Ajustes do Sistema.

### P1 — Histórico
- Aceite: lista de limpezas com data, total liberado e total enviado à Lixeira; soma acumulada.

### P1 — Docker Desktop
- Aceite: depois de limpar Docker, avisa em uma frase que o disco virtual do Docker Desktop pode levar alguns minutos para devolver o espaço ao macOS.

### P1 — Acesso Total ao Disco só se necessário
- Aceite: o app só pede quando a leitura de `~/.Trash` falha por permissão, explica por que e abre o painel certo dos Ajustes.

### P1 — Integração macOS
Vibrancy, semáforos integrados à barra de título, fonte do sistema, claro e escuro automáticos, ⌘R reanalisa, ⌘, abre Preferências.

### P2 — Depois
Puppeteer e Cypress, cache do `uv`, `iOS DeviceSupport`, escolha de pastas para buscar projetos, assinatura e notarização.

## Regras de segurança (obrigatórias)

S1. Todo código que apaga passa por `src/main/cleaner.js`. Nenhum outro arquivo de `src/` chama `rm`, `unlink`, `trashItem` ou comando de limpeza. O `npm run check` bloqueia.
S2. Comando oficial primeiro. Pasta só vai para a Lixeira quando não existe comando oficial ou a ferramenta não está instalada.
S3. Nada é apagado direto do disco pelo app. Itens manuais vão para a Lixeira (`shell.trashItem`). Exclusão permanente só acontece por comando oficial da ferramenta ou ao esvaziar a Lixeira com confirmação própria.
S4. O renderer nunca envia caminho nem comando. Envia o id do item; o processo principal resolve o item a partir da última análise e revalida antes de agir.
S5. Caminho para a Lixeira precisa estar dentro da raiz permitida da categoria, não pode ser link simbólico e não pode ser a própria raiz.
S6. Comandos vêm de uma tabela fixa em `cleaner.js`, rodam com `execFile` (sem shell) e argumentos validados.
S7. Nunca entram na seleção automática nem no total seguro: projetos com atividade nos últimos 30 dias, revisões do Playwright em uso, DerivedData com o Xcode aberto, caches de app aberto. Só saem por escolha explícita no detalhe, com aviso na confirmação, e vão para a Lixeira. Containers em execução, imagens usadas e volumes ligados continuam bloqueados (o Docker recusa).
S8. Volumes Docker podem ter bancos de dados: aparecem um a um, com aviso, e cada um exige confirmação individual. Nunca em lote.
S9. Caches e logs de apps tocados nos últimos 7 dias são "atenção" (o app pode estar usando) e ficam fora do total seguro.
S10. Proteção é revalidada no momento da limpeza, não só na análise: o que entrou como seguro e ficou ativo nesse meio-tempo não sai.
S11. Senha de administrador só pelo diálogo nativo do macOS (`osascript … with administrator privileges`), uma vez por limpeza, só para `chown -R` de caminhos que passaram por `trashRule`, e só depois da confirmação. Nada é apagado como root.

## Limites conhecidos

- **Clones do APFS.** pnpm e bun clonam arquivos do store para `node_modules`. Apagar uma cópia não devolve blocos que outra ainda usa. No QA, `pnpm store prune` removeu 3,7 GB do store e o disco ganhou 0,16 GB. Por isso o app mede o espaço livre antes e depois e mostra os dois números, e os `node_modules` instalados por pnpm/bun aparecem sem valor previsto.
- **Docker Desktop.** O espaço volta para o disco virtual na hora e para o macOS alguns minutos depois.
- **Lixeira.** Item enviado à Lixeira só libera espaço quando ela é esvaziada.
- **Espaço purgável.** O "livre" vem de `statfs` e não soma o espaço purgável que o Finder conta; pode sair menor que o do Finder.

## Métricas de sucesso

| Métrica | Meta | Como medir |
|---|---|---|
| Tempo até ver o disco | ≤ 1 s | abertura com cache salvo, medido no QA |
| Tempo da análise completa | ≤ 20 s num Mac com 50 GB de caches | log do scan no QA |
| Arquivos indevidos apagados | 0 | testes do `cleaner` + comparação de caminhos protegidos antes/depois da limpeza real |
| Precisão do valor removido | diferença ≤ 10 % entre o que o app informa e o `du` antes/depois | histórico vs `du` |
| Honestidade do ganho real | todo resultado mostra o aumento medido do espaço livre do disco | `statfs` antes/depois de cada limpeza |
| Primeira limpeza sem ler instrução | fluxo abrir → revisar → liberar em ≤ 3 cliques | QA |
