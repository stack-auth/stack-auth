import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'node',
      testTimeout: 30_000,
      globalSetup: './tests/global-setup.ts',
      setupFiles: [
        "./tests/setup.ts",
      ],
      snapshotSerializers: ["./tests/snapshot-serializer.ts"],
    },
  }),
)
