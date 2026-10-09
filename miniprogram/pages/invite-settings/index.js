const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    statusReady: false,
    error: '',
    configured: false,
    customCode: '',
    currentCode: '',
    saving: false
  },
  onLoad() { return this.loadStatus() },
  onUnload() { this.generation = (this.generation || 0) + 1 },
  async loadStatus() {
    const generation = this.generation = (this.generation || 0) + 1
    this.setData({ loading: !this.data.statusReady, error: '' })
    try {
      const result = await api.call('getInviteStatus')
      if (generation !== this.generation) return
      this.setData({ loading: false, statusReady: true, configured: result.configured })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      this.setData({ loading: false, error: error.message,
        ...(revoked ? { statusReady: false, configured: false, currentCode: '', customCode: '' } : {}) })
    }
  },
  onCodeInput(event) { this.setData({ customCode: event.detail.value }) },
  generateCode() { this.confirmReplace('') },
  saveCustomCode() {
    const code = this.data.customCode.trim().replace(/[\s-]+/g, '')
    if (!/^[A-Za-z0-9]{8,32}$/.test(code)) {
      wx.showToast({ title: '请填写 8 到 32 位字母或数字', icon: 'none' })
      return
    }
    this.confirmReplace(this.data.customCode)
  },
  confirmReplace(inviteCode) {
    if (this.data.loading || this.data.error || this.data.saving) return
    if (!this.data.configured) {
      this.performSet(inviteCode)
      return
    }
    wx.showModal({
      title: '更换家庭邀请码？',
      content: '更换后，之前的邀请码会立即失效，已经加入的家人不受影响。',
      confirmColor: '#B94732',
      success: (result) => { if (result.confirm) this.performSet(inviteCode) }
    })
  },
  async performSet(inviteCode) {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const result = await api.call('setInviteCode', { inviteCode })
      this.setData({ configured: true, currentCode: result.inviteCode, customCode: '' })
      wx.showToast({ title: '邀请码已更新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 2600 })
    } finally {
      this.setData({ saving: false })
    }
  },
  copyCode() {
    if (!this.data.currentCode) return
    wx.setClipboardData({ data: this.data.currentCode })
  }
})
