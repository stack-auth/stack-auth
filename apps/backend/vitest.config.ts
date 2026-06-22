import { resolve } from 'path'
import { loadEnv } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import sharedConfig from '../../vitest.shared'

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      testTimeout: 60000,
      hookTimeout: 60000,
      env: {
        ...loadEnv('', process.cwd(), ''),
        ...loadEnv('development', process.cwd(), ''),
      },
      setupFiles: ['./vitest.setup.ts'],
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        'next/headers': resolve(__dirname, './src/lib/next-compat/headers.tsx'),
        'next/navigation': resolve(__dirname, './src/lib/next-compat/navigation.tsx'),
        'next/server': resolve(__dirname, './src/lib/next-compat/server.tsx'),
      }
    },
    envDir: __dirname,
    envPrefix: ['HEXCLAVE_', 'STACK_'],
  })
)
