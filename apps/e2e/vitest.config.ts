import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [react() as any],
    test: {
      environment: 'node',
      testTimeout: process.env.CI ? 60_000 : 30_000,
      // Perf benchmarks (`*.perf.test.ts`) are excluded from the default run. They send their
      // requests strictly sequentially and report per-operation latency, so running them next to
      // the rest of the suite is bad in both directions: they are slowed down by everything else
      // sharing the backend (which makes them flake against their own timeout), and their
      // measurements stop meaning anything. Set HEXCLAVE_RUN_PERF_TESTS to run them; CI does that
      // in a dedicated step with a single worker.
      exclude: [
        ...configDefaults.exclude,
        ...(process.env.HEXCLAVE_RUN_PERF_TESTS ? [] : ["**/*.perf.test.{js,ts,jsx,tsx}"]),
      ],
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
