const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', profile: null },
  onShow() { this.loadProfile() },
  async loadProfile() {
    this.setData({ loading: true, error: '' })
    try {
      const profile = await api.call('getProfile')
      getApp().globalData.profile = profile
      this.setData({ loading: false, profile })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  copyOpenid() { wx.setClipboardData({ data: this.data.profile.openid }) },
  openAdminDishes() { wx.navigateTo({ url: '/pages/admin-dishes/index' }) },
  openInviteSettings() { wx.navigateTo({ url: '/pages/invite-settings/index' }) }
})
