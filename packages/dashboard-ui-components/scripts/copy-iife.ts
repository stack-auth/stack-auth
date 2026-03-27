import * as fs from 'node:fs';
import * as path from 'node:path';

const src = path.resolve(__dirname, '../dist/dashboard-ui-components.global.js');
const srcMap = src + '.map';
const destDir = path.resolve(__dirname, '../../../apps/dashboard/public');
const dest = path.join(destDir, 'dashboard-ui-components.iife.js');
const destMap = dest + '.map';

if (!fs.existsSync(src)) {
  console.warn('[copy-iife] IIFE bundle not found at', src, '— skipping');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-iife] Copied IIFE bundle to', dest);

if (fs.existsSync(srcMap)) {
  fs.copyFileSync(srcMap, destMap);
  console.log('[copy-iife] Copied source map to', destMap);
}
