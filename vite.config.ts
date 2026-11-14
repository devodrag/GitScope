import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  build: {
    target: ['es2022', 'safari16'],
    rollupOptions: {
      onwarn(warning, handler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.id?.includes('/node_modules/') && warning.message.includes('"use client"')) return
        handler(warning)
      },
    },
  },
})
