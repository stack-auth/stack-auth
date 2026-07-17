import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react() as any],
    test: {
      environment: 'node',
      testTimeout: process.env.CI ? 60_000 : 30_000,
      setupFiles: [
        // load-env must come first so env vars are populated before setup.ts
        // (and the helpers it imports) is evaluated. See load-env.ts for why
        // this is a setupFile rather than a globalSetup.
        "./tests/load-env.ts",
        "./tests/setup.ts",
      ],
      snapshotSerializers: ["./tests/snapshot-serializer.ts"],
    },
  }),
)
