import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { defineConfig } from 'vite'

import { relayRequest, type RelayOutcome } from './shared/relay-core'

/**
 * 本地开发用的 /api/relay 中间件，与 Cloudflare Pages Function 共享同一份核心逻辑，
 * 保证 `pnpm dev` 无需 wrangler 即可完整检测四个平台。
 */
function relayDevPlugin(): Plugin {
  return {
    name: 'live-checker-relay-dev',
    configureServer(server) {
      server.middlewares.use('/api/relay', ((
        req: Connect.IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        if (req.method !== 'GET') {
          next()
          return
        }
        void (async () => {
          const requestUrl = new URL(req.url ?? '/', 'http://localhost')
          const payload: RelayOutcome | { ok: true; probe: true } =
            requestUrl.searchParams.get('probe') === '1'
              ? { ok: true, probe: true }
              : await relayRequest(requestUrl.searchParams.get('u'))
          const status = payload.ok
            ? 200
            : payload.error === 'MISSING_URL'
              || payload.error === 'INVALID_URL'
              || payload.error === 'DISALLOWED_TARGET'
              ? 400
              : 502
          res.statusCode = status
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(payload))
        })()
      }) as Connect.NextHandleFunction)
    },
  }
}

export default defineConfig({
  // 相对基准路径，同时兼容 Cloudflare Pages 根路径与 GitHub Pages 子路径部署。
  base: './',
  plugins: [react(), tailwindcss(), relayDevPlugin()],
})
