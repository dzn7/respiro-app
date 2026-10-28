@AGENTS.md

## Só para o Claude Code
- Hooks em `.claude/settings.json`: depois de editar, `scripts/hook.mjs` roda as regras do projeto no arquivo e o typecheck; ao encerrar, roda `npm run verify` se algo em `src/`, `test/` ou `scripts/` mudou. Falha volta como mensagem: corrija antes de encerrar.
- Skills em `.claude/skills` (link para `.agents/skills`).
