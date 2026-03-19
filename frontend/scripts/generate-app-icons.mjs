/**
 * Renders resources/app-icon.svg → PWA + Android + iOS PNGs.
 * Uses an isolated npm folder for sharp so Node 18 works (no full frontend npm i needed).
 * Alternative: brew install librsvg && uses rsvg-convert if sharp unavailable.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { execFileSync, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isolated = join(root, '.icon-gen-deps');
const svgPath = join(root, 'resources', 'app-icon.svg');
const publicIcons = join(root, 'public', 'assets', 'icons');
const androidRes = join(root, 'android', 'app', 'src', 'main', 'res');
const iosAppIcon = join(
  root,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset',
  'AppIcon-512@2x.png'
);

if (!existsSync(svgPath)) {
  console.error('Missing', svgPath);
  process.exit(1);
}

const svg = readFileSync(svgPath);

function hasRsvg() {
  try {
    execFileSync('which', ['rsvg-convert'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    /* not in frontend/node_modules */
  }
  const pkg = join(isolated, 'package.json');
  const sharpEntry = join(isolated, 'node_modules', 'sharp', 'lib', 'index.js');
  if (!existsSync(sharpEntry)) {
    mkdirSync(isolated, { recursive: true });
    writeFileSync(
      pkg,
      JSON.stringify({ name: 'ub-icon-gen', private: true, dependencies: { sharp: '0.33.5' } }, null, 2)
    );
    console.log('Installing sharp in frontend/.icon-gen-deps (one-time, ~30s)…');
    execSync('npm install --no-fund --no-audit', { cwd: isolated, stdio: 'inherit' });
  }
  if (!existsSync(sharpEntry)) {
    return null;
  }
  return (await import(pathToFileURL(sharpEntry).href)).default;
}

let sharp = await loadSharp();
if (!sharp && !hasRsvg()) {
  console.error(
    'Could not set up icon rendering.\n' +
      '  Option A: brew install librsvg   then re-run npm run icons\n' +
      '  Option B: Use Node 20+ and cd frontend && npm install && npm run icons'
  );
  process.exit(1);
}

async function toPng(w, h, outFile) {
  if (sharp) {
    await sharp(svg).resize(w, h).png().toFile(outFile);
    return;
  }
  execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), svgPath, '-o', outFile], {
    stdio: 'inherit',
  });
}

mkdirSync(publicIcons, { recursive: true });

console.log(sharp ? 'Using sharp' : 'Using rsvg-convert');

const sizes = {
  'icon-48x48.png': 48,
  'icon-72x72.png': 72,
  'icon-96x96.png': 96,
  'icon-144x144.png': 144,
  'icon-192x192.png': 192,
  'icon-384x384.png': 384,
  'icon-512x512.png': 512,
  'apple-touch-icon.png': 180,
};

for (const [name, w] of Object.entries(sizes)) {
  await toPng(w, w, join(publicIcons, name));
  console.log(' ', name);
}

const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const d of Object.keys(fg)) {
  const dir = join(androidRes, 'mipmap-' + d);
  if (!existsSync(dir)) continue;
  await toPng(fg[d], fg[d], join(dir, 'ic_launcher_foreground.png'));
  await toPng(legacy[d], legacy[d], join(dir, 'ic_launcher.png'));
  await toPng(legacy[d], legacy[d], join(dir, 'ic_launcher_round.png'));
  console.log(' android', d);
}

if (existsSync(dirname(iosAppIcon))) {
  await toPng(1024, 1024, iosAppIcon);
  console.log(' ios AppIcon-512@2x.png');
}

console.log('Done.');
