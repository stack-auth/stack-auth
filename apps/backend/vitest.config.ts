import { resolve } from 'path'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    },
    envDir: __dirname,
    envPrefix: 'STACK_',
    env: {
      loadEnvFiles: ['.env', '.env.development', '.env.local']
    }
  }),
)
