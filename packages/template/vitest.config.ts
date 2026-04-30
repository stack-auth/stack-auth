import { fileURLToPath } from 'node:url' // THIS_LINE_PLATFORM template
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

const tanstackStartServerContextStub = fileURLToPath(new URL('./src/tanstack-start-server-context.default.ts', import.meta.url)) // THIS_LINE_PLATFORM template

export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: {
        "@stackframe/tanstack-start/tanstack-start-server-context": tanstackStartServerContextStub, // THIS_LINE_PLATFORM template
      },
    },
  }),
)
