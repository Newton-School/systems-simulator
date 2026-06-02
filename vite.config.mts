import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const rendererRoot = resolve(__dirname, 'src/renderer')
const sourceRoot = resolve(__dirname, 'src')

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react({})],
  resolve: {
    alias: {
      '@renderer': resolve(rendererRoot, 'src')
    }
  },
  server: {
    fs: {
      allow: [sourceRoot]
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
