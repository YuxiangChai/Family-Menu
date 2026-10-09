const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', members: [], selected: null, nickname: '', enabled: true, saving: false },
  onShow() { if (!this.data.selected) return this.loadMembers() },
  onUnload() { this.generation = (this.generation || 0) + 1 },
  onPullDownRefresh() {
    if (this.data.selected || this.data.saving) { wx.stopPullDownRefresh(); return }
    this.loadMembers().finally(() => wx.stopPullDownRefresh())
  },
  async loadMembers() {
    const generation = this.generation = (this.generation || 0) + 1
    this.setData({ loading: !this.loaded, error: '' })
    try {
      const result = await api.call('listFamilyMembers')
      if (generation !== this.generation) return
      this.loaded = true
      this.setData({ loading: false,
        ...(JSON.stringify(result.members) !== JSON.stringify(this.data.members) ? { members: result.members } : {}) })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      if (revoked) this.loaded = false
      this.setData({ loading: false, error: error.message,
        ...(revoked ? { members: [], selected: null, nickname: '', enabled: true } : {}) })
    }
  },
  editMember(event) {
    if (this.data.saving) return
    const selected = this.data.members.find((member) => member._id === event.currentTarget.dataset.id)
    if (selected) this.setData({ selected, nickname: selected.nickname, enabled: selected.enabled })
  },
  onNickname(event) { this.setData({ nickname: event.detail.value }) },
  editNickname() {
    if (this.data.saving) return
    wx.showModal({
      title: '修改家人的称呼', editable: true, content: this.data.nickname,
      placeholderText: '填写 1 到 20 个字', confirmText: '应用称呼',
      success: (result) => { if (result.confirm) this.onNickname({ detail: { value: result.content || '' } }) }
    })
  },
  onEnabled(event) { this.setData({ enabled: event.detail.value }) },
  async closeEditor() {
    if (this.data.saving || !this.data.selected) return
    const member = this.data.selected
    const changed = this.data.nickname.trim() !== member.nickname || (!member.isAdmin && this.data.enabled !== member.enabled)
    if (changed && !await this.confirm('放弃未保存的修改？', '成员属性还没有保存。')) return
    this.setData({ selected: null })
  },
  confirm(title, content) {
    return new Promise((resolve) => wx.showModal({ title, content, success: (result) => resolve(result.confirm), fail: () => resolve(false) }))
  },
  async saveMember() {
    if (this.data.saving || !this.data.selected) return
    const member = this.data.selected
    const nickname = this.data.nickname.trim()
    if (!nickname || Array.from(nickname).length > 20) { wx.showToast({ title: '称呼请填写 1 到 20 个字', icon: 'none' }); return }
    const payload = { memberId: member._id, nickname }
    if (!member.isAdmin) payload.enabled = this.data.enabled
    const enabledChanged = !member.isAdmin && payload.enabled !== member.enabled
    // Capture the form and lock it before awaiting confirmation, preventing double submission.
    this.setData({ saving: true })
    try {
      if (enabledChanged) {
        const effect = payload.enabled === false ? '停用后不能查看菜单或订单，也不能通过邀请码重新加入；可在这里恢复。' : '恢复后可以正常查看、下单和分享。'
        if (!await this.confirm('保存账号状态？', `${nickname}：${payload.enabled === false ? '停用' : '启用'}。${effect}`)) return
      }
      await api.call('updateFamilyMember', payload)
      this.setData({ selected: null })
      wx.showToast({ title: '成员属性已保存', icon: 'success' })
      await this.loadMembers()
    } catch (error) { wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' }) }
    finally { this.setData({ saving: false }) }
  }
})
