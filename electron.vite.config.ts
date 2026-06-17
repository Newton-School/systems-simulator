import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'

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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({})]
  },
  preload: {
    plugins: [externalizeDepsPlugin({})]
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react({}), rendererCspPlugin()]
  }
})
