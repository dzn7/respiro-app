// logo.jpg (squircle sobre fundo cinza) → build/icon.png 1024 com fundo transparente, na grade do macOS (corpo 824 px).
// Roda com Electron porque nativeImage lê, recorta e redimensiona sem dependência extra.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, nativeImage } from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const BODY = 824;
const CANVAS = 1024;

app.whenReady().then(() => {
  const logo = nativeImage.createFromPath(`${root}logo.jpg`);
  const { width, height } = logo.getSize();
  const px = logo.toBitmap(); // BGRA
  const bright = (/** @type {number} */ x, /** @type {number} */ y) => {
    const i = (y * width + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 3 > 200;
  };
  // Borda clara do squircle no meio de cada lado; o fundo e a sombra são mais escuros.
  const mid = Math.floor(height / 2);
  const left = [...Array(width).keys()].find((x) => bright(x, mid)) ?? 0;
  const right = width - 1 - ([...Array(width).keys()].find((x) => bright(width - 1 - x, mid)) ?? 0);
  const top = [...Array(height).keys()].find((y) => bright(Math.floor(width / 2), y)) ?? 0;
  const side = right - left + 1;
  // Raio do canto pela diagonal: o primeiro ponto claro fica a r·(1 − 1/√2) do canto.
  const inset = [...Array(side).keys()].find((d) => bright(left + d, top + d)) ?? 0;
  const radius = inset / (1 - Math.SQRT1_2);

  const body = logo.crop({ x: left, y: top, width: side, height: side }).resize({ width: BODY, height: BODY, quality: 'best' });
  const src = body.toBitmap();
  const out = Buffer.alloc(CANVAS * CANVAS * 4);
  const r = (radius * BODY) / side + 1;
  const offset = (CANVAS - BODY) / 2;
  for (let y = 0; y < BODY; y++) {
    for (let x = 0; x < BODY; x++) {
      // Cobertura do canto arredondado com 1 px de suavização.
      const dx = Math.max(r - x - 0.5, x + 0.5 - (BODY - r), 0);
      const dy = Math.max(r - y - 0.5, y + 0.5 - (BODY - r), 0);
      const alpha = Math.min(1, Math.max(0, r - Math.hypot(dx, dy) + 0.5));
      const s = (y * BODY + x) * 4;
      const d = ((y + offset) * CANVAS + (x + offset)) * 4;
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(src[s + c] * alpha);
      out[d + 3] = Math.round(255 * alpha);
    }
  }
  writeFileSync(`${root}build/icon.png`, nativeImage.createFromBitmap(out, { width: CANVAS, height: CANVAS }).toPNG());
  console.log(`icon.png: squircle ${side}px em (${left}, ${top}), raio ${Math.round(radius)}px`);
  app.quit();
});
