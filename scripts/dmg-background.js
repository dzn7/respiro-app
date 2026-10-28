// Fundo da janela do instalador (UI.md › Instalador): 640×440 em 1x e 2x, com a Geist embarcada.
// Uso: electron scripts/dmg-background.js <pasta de saída>  →  background@2x.png (o 1x sai dele com sips).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

export const WIDTH = 640;
export const HEIGHT = 440;
const out = process.argv.at(-1) ?? '.';
// Página em data: não lê file://; a fonte vai embutida.
const font = readFileSync(fileURLToPath(new URL('../src/renderer/fonts/Geist-Variable.woff2', import.meta.url))).toString('base64');

// Cores fixas do modo claro: com imagem de fundo, o Finder sempre desenha os nomes em preto.
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url("data:font/woff2;base64,${font}") format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: #f7f5ef; overflow: hidden; -webkit-font-smoothing: antialiased; }
svg { position: absolute; inset: 0; }
p { position: absolute; left: 0; right: 0; top: 318px; margin: 0; text-align: center; font: 400 13px/18px Geist, sans-serif; letter-spacing: -0.003em; color: #6b675e; }
</style>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" stroke="#c4bdb0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M276 196 H 362"/><path d="M354 188 L 363 196 L 354 204"/>
</svg>
<p>Arraste o Respiro para Aplicativos</p>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH * 2, height: HEIGHT * 2, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  win.webContents.setZoomFactor(2);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))');
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH * 2, height: HEIGHT * 2 });
  writeFileSync(join(out, 'background@2x.png'), image.toPNG());
  app.quit();
});
