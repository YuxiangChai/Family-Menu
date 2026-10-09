const http = require('node:http')
const { Store } = require('./store')
const { Auth } = require('./auth')
const { Media } = require('./media')
const { Service } = require('./service')
const { fail } = require('../cloudfunctions/menuService/lib/validation')

const STATUSES = { ACTIVE_MENU_BUSY: 409, MENU_CLOSED: 409, ORDER_CONFLICT: 409, AUTH_EXPIRED: 401, UNAUTHORIZED: 403, ACCOUNT_DISABLED: 403, FORBIDDEN: 403, NOT_FOUND: 404, RATE_LIMITED: 429, LOGIN_UNAVAILABLE: 503, SERVER_NOT_CONFIGURED: 503 }
const PUBLIC_ERRORS = new Set([...Object.keys(STATUSES), 'BAD_REQUEST', 'LOGIN_FAILED', 'INVITE_NOT_CONFIGURED', 'INVALID_INVITE_CODE', 'NOTIFICATION_NOT_CONFIGURED'])

async function readBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) fail('BAD_REQUEST', '请求内容过大')
    chunks.push(chunk)
  }
  let data
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { fail('BAD_REQUEST', '请求格式不正确') }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('BAD_REQUEST', '请求格式不正确')
  return data
}

function createApp(config, options = {}) {
  const store = new Store(config.dataDir)
  const auth = new Auth(store, config, options.exchangeCode)
  const media = new Media(store, config.publicUrl)
  const service = new Service(store, media)
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(value))
    }
    try {
      const url = new URL(request.url, 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/health') {
        store.db.prepare('SELECT 1').get()
        return json(200, { ok: true, service: 'family-menu', wechatConfigured: Boolean(config.appId && config.appSecret) })
      }
      if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
        const file = media.read(url)
        response.writeHead(200, { 'Content-Type': file.mime })
        return response.end(file.content)
      }
      if (request.method !== 'POST' || !/^\/api\/[a-zA-Z]+$/.test(url.pathname)) fail('NOT_FOUND', '接口不存在')
      const action = url.pathname.slice(5)
      const peer = request.socket.remoteAddress || 'unknown'
      // Do not trust forwarded headers: Cloudflare Tunnel is expected to connect locally.
      if (!store.rateLimit(`http:${peer}`, 300, 60000)) fail('RATE_LIMITED', '请求过于频繁，请稍后再试')
      if (action === 'login') {
        if (!store.rateLimit(`login:${peer}`, 30, 60000)) fail('RATE_LIMITED', '登录过于频繁，请稍后再试')
        return json(200, { ok: true, data: await auth.login(await readBody(request)) })
      }
      const identity = auth.resolve(request.headers.authorization)
      const body = await readBody(request)
      const data = service.dispatch(action, identity, body)
      return json(200, { ok: true, data })
    } catch (error) {
      if (response.destroyed || response.headersSent) return
      // Never log login codes, session tokens, AppSecret, request bodies or upstream URLs.
      const known = PUBLIC_ERRORS.has(error.code)
      if (!known) console.error('Internal request failure')
      json(known ? (STATUSES[error.code] || 400) : 500, { ok: false, error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时不可用，请稍后重试' } })
    }
  })
  server.requestTimeout = 20000
  server.headersTimeout = 10000
  server.on('close', () => store.close())
  return { server, store, service, auth }
}

module.exports = { createApp }
