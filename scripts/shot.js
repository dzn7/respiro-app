// Screenshot da janela real depois da análise.
// npm run shot -- --theme=dark --state=main|sheet|confirm|prefs|history|explore|explore-large|explore-dupes|welcome --out=/caminho.png [--fresh]
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, nativeTheme } from 'electron';

/** @param {string} key @param {string} fallback */
const arg = (key, fallback) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const out = arg('out', join(process.cwd(), 'respiro.png'));
const view = arg('state', 'main');
nativeTheme.themeSource = /** @type {'light' | 'dark' | 'system'} */ (arg('theme', 'system'));
if (process.argv.includes('--fresh')) process.env.RESPIRO_DATA = mkdtempSync(join(tmpdir(), 'respiro-shot-'));

/** Espera um seletor aparecer (o mapa da pasta pessoal pode levar minutos na primeira vez). @param {string} sel */
const wait = (sel) => `new Promise((ok) => { const t = setInterval(() => { if (document.querySelector(${JSON.stringify(sel)})) { clearInterval(t); ok(); } }, 300); })`;
/** Abre o Explorar e escolhe a aba pelo índice. @param {number} tab */
const explore = (tab) => `document.getElementById('btn-explore').click(); document.querySelectorAll('#explore .seg-option')[${tab}].click();`;

const STEPS = {
  main: '',
  sheet: "document.querySelector('.row-main')?.click()",
  confirm: "document.getElementById('btn-free')?.click()",
  prefs: "document.getElementById('btn-prefs')?.click()",
  history: "document.getElementById('btn-history')?.click()",
  explore: `${explore(0)} ${wait('#explore .treemap .tm-tile')}`,
  'explore-large': `${explore(1)} ${wait('#explore .x-row')}`,
  'explore-dupes': explore(2),
  // Com --fresh: boas-vindas no passo 2 (cartões das categorias).
  welcome: "document.querySelector('#welcome [data-primary]')?.click()",
};

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    // A preferência salva do app troca o tema no início; o do screenshot vence.
    nativeTheme.themeSource = /** @type {'light' | 'dark' | 'system'} */ (arg('theme', 'system'));
    const js = (/** @type {string} */ code) => win.webContents.executeJavaScript(code);
    const until = Date.now() + 240_000;
    while (Date.now() < until && !(await js("document.getElementById('footer').textContent.startsWith('Atualizado')"))) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await js(STEPS[/** @type {keyof typeof STEPS} */ (view)] ?? '');
    await new Promise((r) => setTimeout(r, 800));
    // screencapture mostra a vibrancy de verdade; sem permissão de gravação de tela, cai no capturePage.
    const id = win.getMediaSourceId().split(':')[1];
    execFile('/usr/sbin/screencapture', ['-x', '-o', `-l${id}`, out], async (err) => {
      if (err) writeFileSync(out, (await win.webContents.capturePage()).toPNG());
      console.log(`shot: ${out}`);
      app.quit();
    });
  });
});

await import('../src/main/main.js');
