---
name: respiro-categoria
description: Adicionar um novo tipo de cache ou categoria ao analisador do Respiro (ex. uv, Gradle, Cypress), ou mudar como uma categoria limpa. Inclui o checklist de segurança obrigatório.
---

# Nova categoria ou item

## Pesquisa antes do código
- Onde a ferramenta guarda o cache? Prefira o caminho que a própria CLI informa (`pnpm store path`, `pip3 cache dir`, `brew --cache`).
- Existe comando oficial de limpeza? Tem prévia (`-n`, `--dry-run`)? O que ele apaga exatamente? Leia a doc ou o `--help` instalado; anote a fonte no PR.
- O que pode estar em uso agora (processo aberto, projeto ativo, container rodando)?

## Código
1. Item novo de categoria existente: edite o arquivo dela em `src/main/categories/`. Categoria nova: crie `src/main/categories/<id>.js` exportando `{ id, name, blurb, icon, scan }` e registre em `src/main/scan.js` (ordem = ordem de cor no `UI.md`). Nona categoria não existe: agrupe.
2. `scan()` só lê. Devolve `null` quando a ferramenta não existe na máquina. Cada item: `{ id, name, size, freeable, safe, note?, lastUsed?, path?, action }`.
3. `action` é `{ kind: 'trash', path }` ou `{ kind: 'cmd', key, arg? }`. Comando novo entra na tabela `COMMANDS` de `src/main/cleaner.js`; raiz nova de Lixeira entra em `trashRoots()` do mesmo arquivo.
4. Proteção revalidada na hora de limpar: acrescente a checagem em `recheck()` do `cleaner.js` quando o estado pode mudar entre análise e limpeza.

## Checklist de segurança (todos sim)
- [ ] Apaga só via `cleaner.js`; `npm run check` passa.
- [ ] Usa comando oficial quando existe; Lixeira só sem comando ou sem CLI.
- [ ] Nada fora da pasta de cache da ferramenta pode cair na ação (teste com caminho vizinho e link simbólico).
- [ ] Item em uso, recente ou com dado do usuário: `safe: false` com `note` explicando, ou protegido (`action: null`).
- [ ] Volume, banco ou dado que não volta: nunca em lote; confirmação individual.
- [ ] `freeable` é medido; se a ferramenta não deixa saber antes, `freeable: null` e o resultado mede depois.
- [ ] Teste em `test/` cobrindo o parser e a regra de proteção.
- [ ] `PRD.md` (tabela de categorias) e `UI.md` (cor e ícone) atualizados.

Prova: `npm run verify` e uma análise real (`npm start`) mostrando a categoria com números conferidos por `du -sk`.
