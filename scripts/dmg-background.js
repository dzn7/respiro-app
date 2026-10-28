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

const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

// Cores fixas do modo claro: com imagem de fundo, o Finder sempre desenha os nomes em preto.
// Ícones do Finder em {180, 196} e {460, 196} (release.mjs), 112 px; o nome sai uns 16 px abaixo.
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Geist; src: url("data:font/woff2;base64,${font}") format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: #f7f5ef; overflow: hidden; -webkit-font-smoothing: antialiased; font-family: Geist, sans-serif; color: #1f1e1b; }
svg { position: absolute; inset: 0; }
h1 { position: absolute; left: 0; right: 0; top: 30px; margin: 0; text-align: center; font: 600 17px/22px Geist; letter-spacing: -0.02em; }
.lead { position: absolute; left: 0; right: 0; top: 54px; margin: 0; text-align: center; font: 400 13px/18px Geist; color: #6b675e; }
ol { position: absolute; left: 48px; right: 48px; top: 338px; margin: 0; padding: 0; list-style: none; display: grid; gap: 9px; font: 400 12px/16px Geist; color: #6b675e; }
li { display: flex; align-items: center; gap: 10px; }
li b { display: grid; place-items: center; flex: none; width: 17px; height: 17px; border-radius: 50%; box-shadow: inset 0 0 0 1px #c4bdb0; font: 500 10px/1 Geist; color: #6b675e; }
li em { font-style: normal; color: #1f1e1b; }
.foot { position: absolute; left: 0; right: 0; bottom: 18px; margin: 0; text-align: center; font: 450 11px/14px Geist; letter-spacing: 0.008em; color: #8a857a; }
</style>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <rect x="394" y="130" width="132" height="132" rx="30" stroke="#d3ccbf" stroke-width="1.5" stroke-dasharray="5 6"/>
  <path d="M262 178 C 296 140, 344 140, 376 176" stroke="#c4bdb0" stroke-width="2" stroke-dasharray="1 7"/>
  <path d="M366 174 L 377 177 L 375 166" stroke="#c4bdb0" stroke-width="2"/>
  <line x1="48" y1="318" x2="592" y2="318" stroke="#e4dfd5" stroke-width="1"/>
</svg>
<h1>Instalar o Respiro</h1>
<p class="lead">Arraste o ícone até a pasta Aplicativos.</p>
<ol>
  <li><b>1</b><span>Solte o Respiro no quadro tracejado.</span></li>
  <li><b>2</b><span>Na primeira abertura: <em>Ajustes do Sistema › Privacidade e Segurança › Abrir Mesmo Assim</em>.</span></li>
</ol>
<p class="foot">Respiro ${version} · Apple Silicon</p>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH * 2, height: HEIGHT * 2, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  win.webContents.setZoomFactor(2);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))');
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: WIDTH * 2, height: HEIGHT * 2 });
  writeFileSync(join(out, 'background@2x.png'), image.toPNG());
  app.quit();
});
