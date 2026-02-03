import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react() as any],
    test: {
      environment: 'node',
      testTimeout: process.env.CI ? 50_000 : 30_000,
      globalSetup: './tests/global-setup.ts',
      setupFiles: [
        "./tests/setup.ts",
      ],
      snapshotSerializers: ["./tests/snapshot-serializer.ts"],
      poolMatchGlobs: [
        ['**/tests/backend/endpoints/api/v1/external-db-sync*.test.ts', 'forks'],
      ],
      poolOptions: {
        forks: {
          maxForks: 1,
          minForks: 1,
        },
        threads: {
          maxThreads: 8,
          minThreads: 1,
        },
      },
    },
  }),
)
