import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import sharedConfig from '../../vitest.shared'

export default defineConfig({
  test: {
    testTimeout: 20000,
    include: sharedConfig.test?.include,
    includeSource: sharedConfig.test?.includeSource,
    environment: 'jsdom',
    env: {
      ...loadEnv('', process.cwd(), ''),
      ...loadEnv('development', process.cwd(), ''),
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
