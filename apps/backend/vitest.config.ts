import { resolve } from 'path'
import { loadEnv } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      testTimeout: 20000,
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
)
