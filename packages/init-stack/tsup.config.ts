import { defineConfig, Options } from 'tsup';

const config: Options = {
  entryPoints: ['src/index.ts'],
  sourcemap: true,
  clean: false,
  dts: true,
  outDir: 'dist',
  format: ['esm'],
  banner: {
    js: '#!/usr/bin/env node',
  },
};

export default defineConfig(config);
