---
name: respiro-revisao
description: Revisar uma tela do Respiro (visual, UX, acessibilidade, modo claro e escuro) antes de encerrar uma mudança de interface ou no QA.
---

# Revisão de tela

Gere evidência antes de opinar:
```
npm run verify
npm run shot -- --theme=light --out=<scratch>/light.png
npm run shot -- --theme=dark  --out=<scratch>/dark.png
npm run shot -- --theme=light --state=sheet --out=<scratch>/sheet.png
```
Abra as imagens. Responda cada linha com sim, não ou N/A e a evidência. Qualquer "não" volta para correção.

## Visual
- [ ] Hierarquia: o olho cai primeiro no estado do disco, depois no total seguro, depois na lista?
- [ ] Só tokens; destaque terracota apenas em ação principal, foco e seleção?
- [ ] Sem card dentro de card, sem bordas sobrando, sem gradiente, brilho ou ícone com cara de IA?
- [ ] Alinhamentos na grade de 4; números tabulares alinhados à direita?
- [ ] Escuro parece escolhido (sombras, separadores e cores de categoria do modo escuro)?

## UX
- [ ] Na primeira abertura dá para entender o que liberar sem ler parágrafo?
- [ ] Confirmação mostra lista exata, método e total; modo simular deixa claro que nada foi apagado?
- [ ] Estados carregando, vazio, erro e sem acesso têm texto do `UI.md`?
- [ ] Texto curto, pt-BR, sem jargão sem explicação, números como "12,4 GB"?

## Acessibilidade
- [ ] `npm run check` passou o contraste dos tokens?
- [ ] Tab percorre tudo em ordem, foco visível, Esc fecha sheet e devolve foco?
- [ ] VoiceOver (⌘F5): barra lida como frase, botões só ícone com nome, resultado anunciado?
- [ ] `prefers-reduced-motion` e `prefers-reduced-transparency` respeitados?

Saída: tabela curta com o que passou, o que falhou (com print e arquivo:linha) e o que não foi verificado.
