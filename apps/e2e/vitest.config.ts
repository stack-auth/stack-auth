import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    testTimeout: 20_000,
    globalSetup: './tests/global-setup.ts',
    setupFiles: [
      "./tests/setup.ts",
      "./tests/js/setup.ts",
    ],
    snapshotSerializers: ["./tests/snapshot-serializer.ts"],
  },
})
