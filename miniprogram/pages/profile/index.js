const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', profile: null },
  onShow() { return this.loadProfile() },
  onUnload() { this.generation = (this.generation || 0) + 1 },
  async loadProfile() {
    const generation = this.generation = (this.generation || 0) + 1
    this.setData({ loading: !this.data.profile, error: '' })
    try {
      const profile = await api.call('getProfile')
      if (generation !== this.generation) return
      getApp().globalData.profile = profile
      this.setData({ loading: false, ...(JSON.stringify(profile) !== JSON.stringify(this.data.profile) ? { profile } : {}) })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      if (revoked) getApp().globalData.profile = null
      this.setData({ loading: false, error: error.message, ...(revoked ? { profile: null } : {}) })
    }
  },
  copyOpenid() { wx.setClipboardData({ data: this.data.profile.openid }) },
  openAdminDishes() { wx.navigateTo({ url: '/pages/admin-dishes/index' }) },
  openInviteSettings() { wx.navigateTo({ url: '/pages/invite-settings/index' }) },
  openFamilyMembers() { wx.navigateTo({ url: '/pages/family-members/index' }) },
})
