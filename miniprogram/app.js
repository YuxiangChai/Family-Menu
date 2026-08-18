const { cloudEnvId } = require('./config/env')

App({
  onLaunch() {
    this.globalData = {
      env: cloudEnvId,
      profile: null
    }
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true
      })
    }
  }
})
