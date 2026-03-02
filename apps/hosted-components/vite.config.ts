import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 8105,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['@stackframe/react', '@stackframe/stack-shared'],
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
