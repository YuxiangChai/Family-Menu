const { readConfig } = require('./config')
const { createApp } = require('./http')

const config = readConfig()
const { server } = createApp(config)
server.listen(config.port, config.host, () => {
  console.log(`Family Menu listening on ${config.host}:${config.port}`)
  if (!config.appId || !config.appSecret) console.log('微信登录尚未配置：请填写 server/.env 中的 WX_APP_ID 和 WX_APP_SECRET')
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close()
  setTimeout(() => process.exit(1), 10000).unref()
})
