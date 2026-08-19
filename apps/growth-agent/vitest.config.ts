import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

// The root vitest.workspace.ts globs `apps/*`, so this file is all it takes for the workspace run
// to pick up this app; there was no config here before because the app shipped no tests. No new
// dependency is involved — vitest and vite-tsconfig-paths both resolve from the hoisted workspace
// root.
//
// `#lib/...` / `#connections/...` specifiers resolve through this package's `imports` field in
// package.json, which Vite handles natively, so no alias config is needed.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      // Exclude the eve build/dev scratch directories: `.eve/dev-runtime/snapshots/**` holds
      // verbatim copies of this app's source, and without this vitest would collect and run every
      // snapshotted copy of a test file alongside the real one.
      exclude: ['**/node_modules/**', '**/dist/**', '.eve/**', '.output/**'],
    },
  }),
)
