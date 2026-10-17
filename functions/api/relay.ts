// Cloudflare Pages Function：GET /api/relay?u=<encodeURIComponent(上游URL)>
// 仅做域名白名单转发（见 shared/relay-core.ts），全部检测逻辑在浏览器端。
// 部署到 Cloudflare Pages 时自动生效；部署到 GitHub Pages 时此文件不参与构建。

import { relayRequest } from '../../shared/relay-core'

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS })
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const requestUrl = new URL(context.request.url)
  if (requestUrl.searchParams.get('probe') === '1') {
    return json({ ok: true, probe: true })
  }
  const outcome = await relayRequest(requestUrl.searchParams.get('u'))
  if (outcome.ok) return json(outcome)
  const clientError = outcome.error === 'MISSING_URL'
    || outcome.error === 'INVALID_URL'
    || outcome.error === 'DISALLOWED_TARGET'
  return json(outcome, clientError ? 400 : 502)
}
