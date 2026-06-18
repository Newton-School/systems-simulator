import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const rendererRoot = resolve(projectRoot, 'src/renderer')
const sourceRoot = resolve(projectRoot, 'src')

const createRendererCsp = (isDevelopment: boolean): string => {
  const connectSrc = ["'self'"]

  if (isDevelopment) {
    connectSrc.push(
      'http://localhost:*',
      'http://127.0.0.1:*',
      'ws://localhost:*',
      'ws://127.0.0.1:*'
    )
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:"
  ].join('; ')
}

const rendererCspPlugin = (): PluginOption => ({
  name: 'renderer-csp',
  transformIndexHtml(_html, ctx) {
    return [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: createRendererCsp(Boolean(ctx?.server))
        },
        injectTo: 'head'
      }
    ]
  }
})

const manualChunks = (id: string): string | undefined => {
  if (id.includes('node_modules/reactflow')) {
    return 'reactflow'
  }

  if (id.includes('node_modules/lucide-react')) {
    return 'icons'
  }

  if (
    id.includes('node_modules/react/') ||
    id.includes('node_modules/react-dom/') ||
    id.includes('node_modules/scheduler/')
  ) {
    return 'react-vendor'
  }

  return undefined
}

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react({}), rendererCspPlugin()],
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
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  }
})
