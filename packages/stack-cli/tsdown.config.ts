import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = {
  entry: ['src/index.ts'],
  sourcemap: true,
  clean: false,
  dts: true,
  outDir: 'dist',
  format: {
    esm: {
      outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    },
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
};

export default defineConfig(config);
