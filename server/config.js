const path = require('node:path')

function readConfig(env = process.env) {
  const port = Number(env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口')
  const publicUrl = new URL(env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && local)) {
    throw new Error('PUBLIC_BASE_URL 必须使用 HTTPS（本机调试除外）')
  }
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL 只填写域名和可选端口，不带路径、账号或参数')
  }
  return {
    port, host: env.HOST || '127.0.0.1', publicUrl: publicUrl.origin,
    dataDir: path.resolve(env.MENU_DATA_DIR || path.join(__dirname, 'data')),
    appId: env.WX_APP_ID || '', appSecret: env.WX_APP_SECRET || ''
  }
}

module.exports = { readConfig }
