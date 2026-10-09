const { randomUUID } = require('node:crypto')
const { fail } = require('../cloudfunctions/menuService/lib/validation')

const FIELD_TYPES = {
  creatorName: ['thing', 'name'], dishNames: ['thing'], remark: ['thing'],
  createdAt: ['time', 'date'], dinerCount: ['number'], orderId: ['character_string'], status: ['phrase']
}

function readNotificationConfig(env) {
  const templateId = String(env.WX_ORDER_TEMPLATE_ID || '').trim()
  let fields
  try { fields = JSON.parse(env.WX_ORDER_TEMPLATE_FIELDS || '{}') }
  catch { throw new Error('WX_ORDER_TEMPLATE_FIELDS 必须是 JSON 字段映射') }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('消息字段映射格式不正确')
  for (const [key, source] of Object.entries(fields)) {
    const type = /^(thing|name|time|date|number|character_string|phrase)\d+$/.exec(key)?.[1]
    if (typeof source !== 'string' || !Object.hasOwn(FIELD_TYPES, source) || !FIELD_TYPES[source].includes(type)) throw new Error(`消息字段 ${key} 与内容类型不匹配`)
  }
  const state = env.WX_MESSAGE_STATE || 'formal'
  if (!['developer', 'trial', 'formal'].includes(state)) throw new Error('WX_MESSAGE_STATE 只能是 developer、trial 或 formal')
  return { templateId, fields, state, configured: Boolean(templateId && Object.values(fields).includes('dishNames')) }
}

function shorten(value, max) {
  const characters = Array.from(String(value))
  return characters.length > max ? characters.slice(0, max - 1).join('') + '…' : characters.join('')
}

function templateData(order, fields) {
  const values = {
    creatorName: order.creatorName || '家人',
    dishNames: order.items.map((item) => `${item.name}×${item.servings}`).join('、'),
    remark: order.remark || '无特别备注',
    createdAt: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(order.createdAt)),
    dinerCount: order.dinerCount, orderId: order._id.replace(/-/g, '').slice(0, 32), status: '待确认'
  }
  return Object.fromEntries(Object.entries(fields).map(([key, source]) => {
    let value = values[source]
    if (key.startsWith('thing')) value = shorten(value, 20)
    if (key.startsWith('name')) value = Array.from(String(value)).slice(0, /[\u4e00-\u9fff]/.test(value) ? 10 : 20).join('')
    return [key, { value }]
  }))
}

class Notifications {
  constructor(store, config, transport) {
    this.store = store
    this.config = config
    this.settings = config.notifications || { configured: false, templateId: '', fields: {}, state: 'formal' }
    this.transport = transport || this.sendWechat.bind(this)
    this.stopped = false
    // An interrupted send may already have reached WeChat. Do not blindly send it twice.
    store.db.prepare("UPDATE notification_outbox SET status='failed', error_code='SEND_UNCERTAIN' WHERE status='sending'").run()
  }

  preference(openid) {
    return this.store.db.prepare('SELECT * FROM notification_preferences WHERE openid=?').get(openid)
  }

  status(openid) {
    const preference = this.preference(openid)
    return {
      configured: this.settings.configured,
      templateId: this.settings.configured ? this.settings.templateId : '',
      enabled: Boolean(preference?.enabled && preference.template_id === this.settings.templateId && this.settings.configured),
      unreadCount: this.store.db.prepare('SELECT count(*) AS count FROM notifications WHERE recipient_openid=? AND read_at IS NULL').get(openid).count
    }
  }

  subscribe(openid, event) {
    if (!this.settings.configured) fail('NOTIFICATION_NOT_CONFIGURED', '管理员尚未配置微信订阅消息模板；仍可查看小程序内消息')
    if (event.templateId !== this.settings.templateId || !['accept', 'reject', 'ban'].includes(event.result)) fail('BAD_REQUEST', '订阅结果不正确')
    if (!this.store.rateLimit(`subscribe:${openid}`, 10, 60000)) fail('RATE_LIMITED', '操作过于频繁，请稍后重试')
    // This is only a client-reported intent. WeChat is the authority for actual send permission.
    const enabled = event.result === 'accept'
    this.store.db.prepare(`INSERT INTO notification_preferences VALUES (?, ?, ?)
      ON CONFLICT(openid) DO UPDATE SET enabled=excluded.enabled, template_id=excluded.template_id`)
      .run(openid, Number(enabled), this.settings.templateId)
    return this.status(openid)
  }

  disable(openid) {
    this.store.db.prepare('UPDATE notification_preferences SET enabled=0 WHERE openid=?').run(openid)
    return this.status(openid)
  }

  enqueue(order) {
    const members = this.store.db.prepare('SELECT openid FROM family_members WHERE enabled=1 AND openid<>?').all(order.creatorOpenid)
    for (const { openid } of members) {
      const notification = { _id: randomUUID(), orderId: order._id, creatorName: order.creatorName,
        items: order.items.map(({ name, servings }) => ({ name, servings })), dinerCount: order.dinerCount, createdAt: order.createdAt }
      this.store.db.prepare('INSERT INTO notifications VALUES (?, ?, ?, ?, NULL, ?)')
        .run(notification._id, order._id, openid, order.createdAt, JSON.stringify(notification))
      const preference = this.preference(openid)
      if (this.settings.configured && preference?.enabled && preference.template_id === this.settings.templateId) {
        this.store.db.prepare("INSERT INTO notification_outbox VALUES (?, ?, ?, ?, 'queued', NULL, ?)")
          .run(randomUUID(), notification._id, openid, this.settings.templateId, order.createdAt)
      }
    }
  }

  list(openid, event) {
    const offset = event.offset ?? 0
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) fail('BAD_REQUEST', '消息分页标识不正确')
    const rows = this.store.db.prepare('SELECT data, read_at FROM notifications WHERE recipient_openid=? ORDER BY created_at DESC, id DESC LIMIT 31 OFFSET ?').all(openid, offset)
    return { notifications: rows.slice(0, 30).map((row) => ({ ...JSON.parse(row.data), read: Boolean(row.read_at) })), nextOffset: rows.length > 30 ? offset + 30 : null }
  }

  markRead(openid, id) {
    const row = this.store.db.prepare('SELECT recipient_openid FROM notifications WHERE id=?').get(id)
    if (!row || row.recipient_openid !== openid) fail('NOT_FOUND', '消息不存在')
    this.store.db.prepare('UPDATE notifications SET read_at=COALESCE(read_at, ?) WHERE id=?').run(new Date().toISOString(), id)
    return { read: true }
  }

  start() {
    if (!this.settings.configured) return
    this.stopped = false
    this.timer = setInterval(() => this.wake(), 10000)
    this.timer.unref()
    this.wake()
  }
  stop() { this.stopped = true; clearInterval(this.timer) }
  wake() { if (!this.stopped && this.settings.configured) this.flush().catch(() => {}) }

  async flush() {
    if (this.running || this.stopped || !this.settings.configured) return
    this.running = true
    try {
      const jobs = this.store.db.prepare("SELECT * FROM notification_outbox WHERE status='queued' ORDER BY updated_at LIMIT 10").all()
      for (const job of jobs) {
        if (this.stopped) break
        const preference = this.preference(job.recipient_openid)
        if (!this.store.member(job.recipient_openid)?.enabled || !preference?.enabled || preference.template_id !== job.template_id || job.template_id !== this.settings.templateId) {
          this.finish(job.id, 'failed', 'SUBSCRIPTION_INACTIVE')
          continue
        }
        const notification = this.store.db.prepare('SELECT order_id FROM notifications WHERE id=?').get(job.notification_id)
        const order = this.store.get('orders', notification.order_id)
        const claimed = this.store.db.prepare("UPDATE notification_outbox SET status='sending' WHERE id=? AND status='queued'").run(job.id)
        if (!claimed.changes) continue
        try {
          const result = await this.transport({ touser: job.recipient_openid, template_id: job.template_id,
            page: `pages/order-detail/index?id=${encodeURIComponent(order._id)}`,
            miniprogram_state: this.settings.state, lang: 'zh_CN', data: templateData(order, this.settings.fields) })
          if (this.stopped) break
          if (result?.errcode === 0) this.finish(job.id, 'sent', null)
          else {
            const code = Number.isInteger(result?.errcode) ? String(result.errcode) : 'INVALID_RESPONSE'
            this.finish(job.id, 'failed', code)
            if (result?.errcode === 43101) this.disable(job.recipient_openid)
          }
        } catch {
          if (!this.stopped) this.finish(job.id, 'failed', 'SEND_UNCERTAIN')
        }
      }
    } finally { this.running = false }
  }

  finish(id, status, code) {
    this.store.db.prepare('UPDATE notification_outbox SET status=?, error_code=?, updated_at=? WHERE id=?')
      .run(status, code, new Date().toISOString(), id)
  }

  async postWechat(url, payload) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('WeChat unavailable')
    return response.json()
  }

  async accessToken() {
    if (this.token && this.tokenExpiresAt > Date.now() + 60000) return this.token
    const result = await this.postWechat('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential', appid: this.config.appId, secret: this.config.appSecret, force_refresh: false
    })
    if (result.errcode || typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('WeChat credential unavailable')
    this.token = result.access_token
    this.tokenExpiresAt = Date.now() + result.expires_in * 1000
    return this.token
  }

  async sendWechat(payload) {
    let result = await this.postWechat(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(await this.accessToken())}`, payload)
    if ([40001, 40014, 42001].includes(result.errcode)) {
      this.token = null
      result = await this.postWechat(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(await this.accessToken())}`, payload)
    }
    return result
  }
}

module.exports = { Notifications, readNotificationConfig, templateData }
