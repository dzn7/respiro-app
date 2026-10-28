// Screenshot da janela real depois da análise.
// npm run shot -- --theme=dark --state=main|sheet|confirm|prefs --out=/caminho.png [--fresh]
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

const STEPS = {
  main: '',
  sheet: "document.querySelector('.row-main')?.click()",
  confirm: "document.getElementById('btn-free')?.click()",
  prefs: "document.getElementById('btn-prefs')?.click()",
  history: "document.getElementById('btn-history')?.click()",
};

app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
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
