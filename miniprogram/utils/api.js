const { apiBaseUrl } = require('../config/env')
const baseUrl = String(apiBaseUrl || '').replace(/\/$/, '')
const SESSION_KEY = `family-menu-session:${baseUrl}`
let loginPromise = null

function request(action, data, token) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}/api/${action}`, method: 'POST', data,
      header: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeout: 15000,
      success(response) {
        const result = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300 && result.ok) return resolve(result.data)
        const error = new Error((result.error && result.error.message) || '服务请求失败，请重试')
        error.code = result.error && result.error.code
        reject(error)
      },
      fail() { reject(new Error('连接不到菜单服务，请检查网络或家里的电脑是否开机')) }
    })
  })
}

function ensureLogin() {
  if (loginPromise) return loginPromise
  const saved = wx.getStorageSync(SESSION_KEY)
  if (saved && saved.token && saved.expiresAt > Date.now() + 60000) return Promise.resolve(saved.token)
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success(result) { result.code ? resolve(result.code) : reject(new Error('微信登录失败，请重试')) },
      fail() { reject(new Error('微信登录失败，请重试')) }
    })
  }).then((code) => request('login', { code })).then((session) => {
    wx.setStorageSync(SESSION_KEY, session)
    return session.token
  }).finally(() => { loginPromise = null })
  return loginPromise
}

async function call(action, payload = {}) {
  if (!/^[a-zA-Z]+$/.test(action) || action === 'login') throw new Error('无效操作')
  const token = await ensureLogin()
  try { return await request(action, payload, token) }
  catch (error) {
    if (error.code !== 'AUTH_EXPIRED') throw error
    // Another concurrent request may already have refreshed the old token.
    const current = wx.getStorageSync(SESSION_KEY)
    if (!current || current.token === token) wx.removeStorageSync(SESSION_KEY)
    const renewed = await ensureLogin()
    return request(action, payload, renewed)
  }
}

module.exports = { call }
