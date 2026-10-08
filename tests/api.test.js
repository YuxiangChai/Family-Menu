const test = require('node:test')
const assert = require('node:assert/strict')

test('HTTP 客户端并发只登录一次，过期重登且不绕过家庭权限', async () => {
  const cache = new Map()
  let logins = 0
  let exchanges = 0
  let expire = false
  let denied = false
  const calls = []
  global.wx = {
    getStorageSync: (key) => cache.get(key),
    setStorageSync: (key, value) => cache.set(key, value),
    removeStorageSync: (key) => cache.delete(key),
    login({ success }) { logins++; queueMicrotask(() => success({ code: `code-${logins}` })) },
    request(options) {
      calls.push(options)
      queueMicrotask(() => {
        if (options.url.endsWith('/login')) {
          exchanges++
          return options.success({ statusCode: 200, data: { ok: true, data: { token: `token-${exchanges}`, expiresAt: Date.now() + 3600000 } } })
        }
        if (expire) { expire = false; return options.success({ statusCode: 401, data: { ok: false, error: { code: 'AUTH_EXPIRED', message: '过期' } } }) }
        if (denied) return options.success({ statusCode: 403, data: { ok: false, error: { code: 'UNAUTHORIZED', message: '尚未加入家庭' } } })
        options.success({ statusCode: 200, data: { ok: true, data: { authorized: true } } })
      })
    }
  }
  const api = require('../miniprogram/utils/api')
  const profiles = await Promise.all([api.call('getProfile'), api.call('getProfile')])
  assert.equal(profiles[0].authorized, true)
  assert.equal(logins, 1)
  assert.equal(exchanges, 1)
  assert(calls.filter((item) => !item.url.endsWith('/login')).every((item) => item.header.Authorization === 'Bearer token-1'))
  expire = true
  await api.call('getProfile')
  assert.equal(logins, 2)
  denied = true
  await assert.rejects(api.call('listMenu'), { code: 'UNAUTHORIZED' })
  assert.equal(logins, 2)
  await assert.rejects(api.call('../login'), /无效/)
})
