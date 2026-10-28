// Hook do Claude Code. PostToolUse: regras + typecheck no arquivo editado.
// Stop: npm run verify se src/, test/ ou scripts/ mudaram desde a última verificação.
// Silencioso quando passa; exit 2 devolve a falha ao agente.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stamp = join(root, '.claude/.last-verify');
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    return '';
  } catch (/** @type {any} */ e) {
    return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(0, 30).join('\n') || String(e);
  }
}

/** @param {string} dir @returns {number} */
const newest = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).reduce((max, e) => {
  const p = join(dir, e.name);
  return Math.max(max, e.isDirectory() ? newest(p) : statSync(join(root, p)).mtimeMs);
}, 0);

if (input.hook_event_name === 'PostToolUse') {
  const file = relative(root, input.tool_input?.file_path ?? '');
  if (!/^(src|test|scripts)\//.test(file)) process.exit(0);
  const out = [run('node', ['scripts/check.mjs', file]), /\.(m?js|cjs)$/.test(file) ? run('npx', ['tsc', '-p', '.', '--pretty', 'false']) : '']
    .filter(Boolean).join('\n');
  if (out) { console.error(out); process.exit(2); }
} else if (input.hook_event_name === 'Stop' && !input.stop_hook_active) {
  let last = 0;
  try { last = statSync(stamp).mtimeMs; } catch { /* nunca verificado */ }
  if (Math.max(newest('src'), newest('test'), newest('scripts')) <= last) process.exit(0);
  const out = run('npm', ['run', '--silent', 'verify']);
  if (out) { console.error(`npm run verify falhou:\n${out}`); process.exit(2); }
  writeFileSync(stamp, new Date().toISOString());
}
