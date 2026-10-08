const { randomBytes, createHash } = require('node:crypto')
const { fail, cleanText } = require('../cloudfunctions/menuService/lib/validation')

function hashToken(token) { return createHash('sha256').update(token).digest('hex') }

async function exchangeCode(config, code) {
  if (!config.appId || !config.appSecret) fail('SERVER_NOT_CONFIGURED', '服务器尚未配置微信 AppID 和 AppSecret')
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, js_code: code, grant_type: 'authorization_code' }).toString()
  let data
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('upstream')
    data = await response.json()
  } catch { fail('LOGIN_UNAVAILABLE', '暂时无法连接微信登录服务，请稍后重试') }
  if (data.errcode || typeof data.openid !== 'string' || !data.openid) fail('LOGIN_FAILED', '微信登录失败，请重新打开小程序')
  return data.openid
}

class Auth {
  constructor(store, config, exchange = exchangeCode) { this.store = store; this.config = config; this.exchange = exchange }
  async login(payload) {
    const code = cleanText(payload.code, 200)
    if (!code) fail('BAD_REQUEST', '缺少微信登录凭证')
    const openid = await this.exchange(this.config, code)
    if (typeof openid !== 'string' || !openid) fail('LOGIN_FAILED', '微信登录失败')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    this.store.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    this.store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), openid, expiresAt)
    return { token, expiresAt }
  }
  resolve(header) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header || '')
    if (!token) fail('AUTH_EXPIRED', '请重新登录')
    const tokenHash = hashToken(token[1])
    const session = this.store.db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now())
    if (!session) fail('AUTH_EXPIRED', '登录已过期，请重新登录')
    return { openid: session.openid, tokenHash }
  }
}

module.exports = { Auth, hashToken }
