import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default defineConfig({
  test: {
    testTimeout: 20000,
    include: sharedConfig.test?.include,
    includeSource: sharedConfig.test?.includeSource,
    environmentOptions: {
      env: {
        loadEnvFiles: ['.env', '.env.development', '.env.local']
      }
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  envDir: __dirname,
  envPrefix: 'STACK_',
})
