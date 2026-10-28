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
| Caches de pacotes | pnpm store, metadados do pnpm, npm, yarn, bun, pip, uv, Go (módulos e build), Cargo (downloads, fontes, git), Gradle (cache e versões do wrapper), Maven, CocoaPods, pub (Dart/Flutter) | `pnpm store prune`, `npm cache clean --force`, `yarn cache clean`, `bun pm cache rm`, `pip3 cache purge`, `uv cache prune`, `go clean -modcache` / `-cache`, `pod cache clean --all`, `dart pub cache clean --force`; sem CLI (Cargo, Gradle, Maven, metadados do pnpm) vão para a Lixeira |
| Docker | containers parados, imagens sem uso, cache de build, volumes sem uso | `docker container rm`, `docker image rm`, `docker builder prune -a -f`, `docker volume rm` (um por vez); no Docker Desktop, "Devolver espaço ao macOS" roda `docker run --rm --privileged --pid=host docker/desktop-reclaim-space` |
| Projetos | pastas geradas ao lado do arquivo do projeto (`node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.parcel-cache`, `dist`, `build` com `package.json`; `target` com `Cargo.toml`; `.venv`/`venv` com `pyproject.toml`/`requirements.txt`) e worktrees do git, sob a pasta pessoal, parados há mais de 30 dias (ajustável) | Lixeira; `target` com `cargo clean --manifest-path`; worktree com `git worktree remove` (S12) |
| Xcode e Android | DerivedData, simuladores indisponíveis, cache do Xcode, DeviceSupport antigo (fica o mais novo de cada aparelho), AVDs e system images do Android | Lixeira; simuladores com `xcrun simctl delete unavailable`; AVD com `avdmanager delete avd -n`; system image sem AVD com `sdkmanager --uninstall` |
| Navegadores de teste | revisões do Playwright que nenhuma instalação usa; versões do Cypress e do Puppeteer (a mais nova fica em uso) | Lixeira (Playwright: mesma regra do coletor dele, `.links` + `browsers.json`) |
| Homebrew | downloads em cache e versões antigas | `brew cleanup --prune=all` (prévia com `-n`) |
| Caches de apps e editores | `~/Library/Caches` e `~/Library/Logs` (sem `com.apple.*` e sem o que já está em outra categoria), versões obsoletas de extensões do VS Code, Insiders, Cursor e Windsurf (`.obsolete` fora do `extensions.json`), caches e logs de versões antigas das IDEs JetBrains | Lixeira |
| Lixeira | `~/.Trash` | Finder esvazia (permanente) |

- Aceite: cada categoria mostra espaço ocupado, quanto é seguro liberar e um botão de limpar.
- Aceite: lista ordenada por tamanho ocupado.
- Aceite: quando a ferramenta não deixa saber o ganho antes (ex.: `pnpm store prune`, `uv cache prune`), o app diz isso em vez de inventar número e mostra o valor medido depois.
- Aceite: `dist` e `build` só são seguros quando o git os ignora; fora do git pedem atenção; versionados não aparecem (são código).
- Aceite: continuam 8 categorias (paleta validada); ecossistema novo entra numa categoria existente.

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
- Aceite: Aparência (Automático, Claro, Escuro), Idioma, Analisar ao abrir, Mostrar na barra de menus, Avisar quando o disco tiver menos de (10/15/20 % ou não avisar), Abrir ao iniciar sessão, Modo simular, Projetos parados há mais de, Itens ignorados (com "Mostrar de novo") e Acesso Total ao Disco com status e atalho para os Ajustes do Sistema.

### P1 — Idiomas
- Aceite: português (Brasil), inglês e espanhol; "Automático" segue o macOS (fora desses três, inglês). Troca na hora, inclusive o menu do app e o da barra de menus. Pedidos de permissão do macOS (`InfoPlist.strings`) nos três idiomas.
- Aceite: o main devolve chaves de mensagem, não texto; a análise salva vale em qualquer idioma.

### P1 — Boas-vindas
- Aceite: no primeiro uso, cinco passos em tela cheia: marca e idioma; o que ele acha (a análise real, ao vivo); seguro por padrão; permissões (status real do Acesso Total ao Disco, barra de menus, abrir ao iniciar); pronto (com o valor encontrado). Teclado (Enter, ←/→), "Pular" sempre visível, movimento reduzido respeitado.

### P1 — Carregamento com a marca
- Aceite: onde algo carrega aparece o anel do Respiro em movimento, não um espaço vazio: primeira análise (anel com o nome), linhas pendentes, reanálise (anel com o progresso na barra de título) e botão de limpeza em andamento.

### P1 — Barra de menus
- Aceite: ícone com o anel e o espaço livre (dígitos tabulares), menu com livre/total, quanto dá para liberar e de quando é a análise, Abrir, Analisar agora, Ajustes e Encerrar.
- Aceite: com a barra ligada, fechar a janela mantém o app rodando e o tira do Dock; abrir volta ao Dock.
- Aceite: abaixo do limite escolhido, o anel fica colorido e o macOS recebe no máximo um aviso por dia.

### P1 — Histórico
- Aceite: lista de limpezas com data, total liberado e total enviado à Lixeira; soma acumulada.
- Aceite: gráfico do espaço livre (30 dias, 90 dias, 1 ano) com ponto em cada limpeza, dica no hover e nas setas, tabela para leitor de tela. Amostra a cada 6 h e depois de cada limpeza; guarda um ano.

### P1 — Docker Desktop
- Aceite: depois de limpar Docker, avisa em uma frase que o disco virtual do Docker Desktop pode levar alguns minutos para devolver o espaço ao macOS e oferece "Devolver espaço ao macOS", com confirmação e ganho medido.

### P1 — Acesso Total ao Disco só se necessário
- Aceite: o app só pede quando a leitura de `~/.Trash` falha por permissão, explica por que e abre o painel certo dos Ajustes.

### P1 — Integração macOS
Vibrancy, semáforos integrados à barra de título, fonte do sistema, claro e escuro automáticos, ⌘R reanalisa, ⌘, abre Preferências.

### P2 — Depois
Escolha de pastas para buscar projetos, assinatura e notarização (necessárias para a notificação do macOS chegar sempre), atualização automática.

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
S12. Git só com `git -C <repositório principal> worktree remove <worktree>`, sem `--force`: o git recusa se houver mudança. Worktree travada ou com mudanças não tem ação. Nada que descarte trabalho (reset, clean, checkout, branch -D) entra na tabela. Worktree com `.env` avisa que arquivos ignorados saem junto e não vão para a Lixeira.

## Limites conhecidos

- **Clones do APFS.** pnpm, bun e uv clonam arquivos do store para `node_modules`. Apagar uma cópia não devolve blocos que outra ainda usa. No QA, `pnpm store prune` removeu 3,7 GB do store e o disco ganhou 0,16 GB. Por isso o app mede o espaço livre antes e depois e mostra os dois números, e os `node_modules` instalados por pnpm/bun aparecem sem valor previsto.
- **Docker Desktop.** O espaço volta para o disco virtual na hora e para o macOS alguns minutos depois.
- **Lixeira.** Item enviado à Lixeira só libera espaço quando ela é esvaziada.
- **uv.** O cache do uv pode passar de 100 GB; `uv cache prune` tira só o que nenhum ambiente alcança, e o ganho real aparece depois. `.venv` criado pelo uv aparece sem valor previsto.
- **Notificações.** App sem assinatura pode não receber notificação do macOS; o aviso de disco cheio também aparece no anel colorido da barra de menus.
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
