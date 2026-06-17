import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(projectRoot, 'src/renderer')
const sourceRoot = resolve(projectRoot, 'src')

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
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true
  }
})
