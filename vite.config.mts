import { dirname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import {
  callLlmGradeAPI,
  resolveProviderConfig,
  type LlmGradeRequest
} from './src/engine/analysis/llmGrader.js'

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

const LLM_GRADING_STATUS_PATH = '/api/llm/grading-status'
const LLM_GRADING_PATH = '/api/llm/grade-justification'
const MAX_LLM_REQUEST_BYTES = 64 * 1024

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function isLlmGradeRequest(value: unknown): value is LlmGradeRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<LlmGradeRequest>
  return (
    typeof request.studentAnswer === 'string' &&
    Array.isArray(request.scaleNumbers) &&
    request.scaleNumbers.every((number) => typeof number === 'number') &&
    typeof request.prompt === 'object' &&
    request.prompt !== null
  )
}

/**
 * Local-only LLM proxy. This is registered through `configureServer`, so it is
 * never part of a production Vite build and provider keys stay in Node.
 */
const llmDevelopmentProxyPlugin = (
  environment: Record<string, string | undefined>
): PluginOption => ({
  name: 'local-llm-grading-proxy',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url === LLM_GRADING_STATUS_PATH && request.method === 'GET') {
        const config = resolveProviderConfig(environment)
        sendJson(
          response,
          200,
          config ? { configured: true, providerId: config.providerId } : { configured: false }
        )
        return
      }

      if (request.url !== LLM_GRADING_PATH || request.method !== 'POST') {
        next()
        return
      }

      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
        if (body.length > MAX_LLM_REQUEST_BYTES) request.destroy()
      })
      request.on('error', () => sendJson(response, 400, { error: 'Invalid grading request.' }))
      request.on('end', async () => {
        if (body.length > MAX_LLM_REQUEST_BYTES) {
          sendJson(response, 413, { error: 'Grading request is too large.' })
          return
        }

        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          sendJson(response, 400, { error: 'Invalid grading request.' })
          return
        }
        if (!isLlmGradeRequest(payload)) {
          sendJson(response, 400, { error: 'Invalid grading request.' })
          return
        }

        const config = resolveProviderConfig(environment)
        if (!config) {
          sendJson(response, 503, { error: 'No local LLM grading provider is configured.' })
          return
        }
        try {
          sendJson(response, 200, { ok: true, data: await callLlmGradeAPI(config, payload) })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'LLM grading failed.'
          console.error(`[local-llm-grading] (${config.providerId}) error:`, message)
          sendJson(response, 502, { error: 'LLM grading request failed.' })
        }
      })
    })
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

export default defineConfig(({ mode }) => {
  // `loadEnv` is used only by the Node dev server. No values are injected into
  // the browser bundle because none use the `VITE_` public prefix.
  const environment = { ...process.env, ...loadEnv(mode, projectRoot, '') }

  return {
    root: rendererRoot,
    base: './',
    plugins: [react({}), rendererCspPlugin(), llmDevelopmentProxyPlugin(environment)],
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
  }
})
