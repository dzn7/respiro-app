// .app e .dmg em dist/. Ícone: logo.jpg → build/icon.png (scripts/icon.js) → .icns com sips e iconutil.
// Instalador: fundo de scripts/dmg-background.js, layout pelo Finder (AppleScript), ícone do volume com SetFile.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version, productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
/** @param {string} cmd @param {string[]} args */
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' });

const tmp = mkdtempSync(join(tmpdir(), 'respiro-icon-'));
sh(/** @type {string} */ (/** @type {unknown} */ (electron)), [join(root, 'scripts/icon.js')]);
const iconset = join(tmp, 'icon.iconset');
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = String(size * scale);
    sh('/usr/bin/sips', ['-z', px, px, join(root, 'build/icon.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
}
sh('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')]);

const why = 'O Respiro procura pastas node_modules de projetos parados aqui. Nada é apagado sem a sua confirmação.';
const [appDir] = await packager({
  dir: root, out: join(root, 'dist'), overwrite: true, platform: 'darwin', arch, prune: true, asar: true,
  name: productName, appBundleId: 'br.com.thalena.respiro', appVersion: version, appCategoryType: 'public.app-category.utilities',
  icon: join(root, 'build/icon.icns'), darwinDarkModeSupport: true,
  ignore: [/^\/(dist|build|docs|test|scripts|node_modules|\.agents|\.claude)(\/|$)/, /\.md$/, /^\/(tsconfig\.json|\.gitignore|logo\.jpg|package-lock\.json)$/],
  extendInfo: {
    NSDocumentsFolderUsageDescription: why,
    NSDesktopFolderUsageDescription: why,
    NSDownloadsFolderUsageDescription: why,
    NSAppleEventsUsageDescription: 'O Respiro pede ao Finder para esvaziar a Lixeira quando você confirma.',
  },
});

// ---------- Instalador (UI.md › Instalador) ----------
// Janela 640×440 sem barra de ferramentas, fundo Retina, ícones de 112 px alinhados com a seta do fundo.
const dmg = join(root, 'dist', `${productName}-${version}-${arch}.dmg`);
const rw = join(tmp, 'rw.dmg');
const staging = join(tmp, 'dmg');
const LINK = 'Aplicativos';
const WINDOW = { left: 200, top: 140, width: 640, height: 440, titlebar: 28 };
mkdirSync(join(staging, '.background'), { recursive: true });
sh(/** @type {string} */ (/** @type {unknown} */ (electron)), [join(root, 'scripts/dmg-background.js'), tmp]);
sh('/usr/bin/sips', ['-z', String(WINDOW.height), String(WINDOW.width), join(tmp, 'background@2x.png'), '--out', join(tmp, 'background.png')]);
sh('/usr/bin/tiffutil', ['-cathidpicheck', join(tmp, 'background.png'), join(tmp, 'background@2x.png'), '-out', join(staging, '.background/background.tiff')]);
execFileSync('/bin/cp', ['-R', join(appDir, `${productName}.app`), staging]);
execFileSync('/bin/ln', ['-s', '/Applications', join(staging, LINK)]);
// Folga de 40 MB: sem ela a imagem nasce cheia e o ícone do volume e o .DS_Store não cabem.
const megabytes = Number(execFileSync('/usr/bin/du', ['-sm', staging], { encoding: 'utf8' }).split('\t')[0]) + 40;
sh('/usr/bin/hdiutil', ['create', '-volname', productName, '-srcfolder', staging, '-size', `${megabytes}m`, '-fs', 'HFS+', '-format', 'UDRW', '-ov', rw]);

const attached = execFileSync('/usr/bin/hdiutil', ['attach', '-readwrite', '-noverify', '-noautoopen', rw], { encoding: 'utf8' });
const volume = /** @type {string} */ (attached.match(/\/Volumes\/.+$/m)?.[0].trim());
const disk = volume.slice('/Volumes/'.length);
try {
  const { left, top, width, height, titlebar } = WINDOW;
  execFileSync('/usr/bin/osascript', ['-e', `
    tell application "Finder"
      tell disk "${disk}"
        open
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set the bounds of container window to {${left}, ${top}, ${left + width}, ${top + height + titlebar}}
        set opts to the icon view options of container window
        set arrangement of opts to not arranged
        set icon size of opts to 112
        set text size of opts to 12
        set label position of opts to bottom
        set shows item info of opts to false
        set shows icon preview of opts to false
        set background picture of opts to file ".background:background.tiff"
        set position of item "${productName}.app" of container window to {180, 196}
        set position of item "${LINK}" of container window to {460, 196}
        close
        open
        update without registering applications
        delay 1
        close
      end tell
    end tell`], { stdio: 'pipe', timeout: 90_000 });
  // Ícone do volume por último: o Finder apaga .VolumeIcon.icns ao gravar o layout.
  copyFileSync(join(root, 'build/icon.icns'), join(volume, '.VolumeIcon.icns'));
  sh('/usr/bin/SetFile', ['-c', 'icnC', join(volume, '.VolumeIcon.icns')]);
  sh('/usr/bin/SetFile', ['-a', 'C', volume]);
  execFileSync('/bin/sync');
} finally {
  sh('/usr/bin/hdiutil', ['detach', volume, '-quiet']);
}
sh('/usr/bin/hdiutil', ['convert', rw, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', '-o', dmg]);
console.log(`app: ${join(appDir, `${productName}.app`)}\ndmg: ${dmg}`);
