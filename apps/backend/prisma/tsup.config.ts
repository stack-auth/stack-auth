import { defineConfig } from 'tsup';

// tsup config to build the self-hosting seed script so it can be
// run in the Docker container with no extra dependencies.
export default defineConfig({
  entry: ['prisma/seed.ts'],
  format: ['cjs'],
  outDir: 'dist',
  target: 'node22',
  platform: 'node',
  noExternal: ['@stackframe/stack-shared', '@prisma/client', '@prisma/extension-accelerate', 'jose', 'yup', 'json-diff'],
  clean: true
});
