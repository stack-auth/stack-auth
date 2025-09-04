import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths() as any],
  test: {
    pool: 'threads',
    maxWorkers: 8,
    include: ['**/*.test.{js,ts,jsx,tsx}'],
    includeSource: ['**/*.{js,ts,jsx,tsx}'],
  },
})
