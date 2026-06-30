import { execSync } from 'node:child_process';
import path from 'node:path';
import createJsLibraryTsupConfig from '../../configs/tsdown/js-library.ts';

const pkgDir = path.resolve(import.meta.dirname);

export default createJsLibraryTsupConfig({
  barrelFiles: ["src/index.ts"],
  onSuccess: () => {
    execSync('pnpm run build-iife && pnpm run copy-iife', { cwd: pkgDir, stdio: 'inherit' });
  },
});
