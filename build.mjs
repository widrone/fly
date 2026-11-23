// Builds the whole app into docs/index.html (the folder GitHub Pages serves).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';

const r = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100'],
  write: false,
  legalComments: 'inline', // keeps three.js's MIT notice
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
mkdirSync('docs/fonts', { recursive: true });
writeFileSync('docs/index.html', html);
for (const w of [600, 700, 800]) {
  const f = `nunito-latin-${w}-normal.woff2`;
  copyFileSync(`node_modules/@fontsource/nunito/files/${f}`, `docs/fonts/${f}`);
}
console.log('built docs/index.html', (html.length / 1024).toFixed(0), 'KB');
