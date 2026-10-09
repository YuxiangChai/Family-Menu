const api = require('../../utils/api')
const { dateTime } = require('../../utils/format')

Page({
  data: { loading: true, loadingMore: false, error: '', status: null, notifications: [], nextOffset: null, subscribing: false },
  onShow() { this.loadMessages() },
  onPullDownRefresh() { this.loadMessages().finally(() => wx.stopPullDownRefresh()) },
  async loadMessages(more = false) {
    more = more === true
    if (more && (this.data.loadingMore || this.data.nextOffset == null)) return
    const generation = this.generation = (this.generation || 0) + 1
    const offset = more ? this.data.nextOffset : 0
    this.setData(more ? { loadingMore: true, error: '' } : { loading: true, loadingMore: false, error: '' })
    try {
      const [status, result] = await Promise.all([api.call('getNotificationStatus'), api.call('listNotifications', { offset })])
      if (generation !== this.generation) return
      const notifications = result.notifications.map((item) => ({ ...item, timeText: dateTime(item.createdAt), itemText: item.items.map((dish) => `${dish.name} × ${dish.servings}`).join('、') }))
      this.setData({ loading: false, loadingMore: false, status, notifications: more ? [...this.data.notifications, ...notifications] : notifications, nextOffset: result.nextOffset })
    } catch (error) { if (generation === this.generation) this.setData({ loading: false, loadingMore: false, error: error.message }) }
  },
  loadMore() { this.loadMessages(true) },
  subscribe() {
    if (this.data.subscribing || !this.data.status?.configured) return
    if (!wx.requestSubscribeMessage) { wx.showToast({ title: '请更新微信后在手机上订阅', icon: 'none' }); return }
    const templateId = this.data.status.templateId
    this.setData({ subscribing: true })
    // Invoke synchronously from the user's tap, not after an asynchronous API request.
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: async (result) => {
        const choice = result[templateId]
        try {
          if (!['accept', 'reject', 'ban'].includes(choice)) throw new Error('订阅未完成，请在微信手机端重试')
          const status = await api.call('recordSubscription', { templateId, result: choice })
          this.setData({ status })
          wx.showToast({ title: choice === 'accept' ? '已申请下次点菜提醒' : '未开启微信提醒', icon: 'none' })
        } catch (error) { wx.showToast({ title: error.message || '同步失败，请重新订阅', icon: 'none' }) }
        finally { this.setData({ subscribing: false }) }
      },
      fail: () => {
        this.setData({ subscribing: false })
        wx.showToast({ title: '请在手机微信里重试订阅', icon: 'none' })
      }
    })
  },
  async disable() {
    if (this.data.subscribing) return
    this.setData({ subscribing: true })
    try { this.setData({ status: await api.call('disableNotifications') }) }
    catch (error) { wx.showToast({ title: error.message || '关闭失败，请重试', icon: 'none' }) }
    finally { this.setData({ subscribing: false }) }
  },
  openOrder(event) {
    const { id, orderId } = event.currentTarget.dataset
    api.call('markNotificationRead', { notificationId: id }).catch(() => {})
    wx.navigateTo({ url: `/pages/order-detail/index?id=${orderId}` })
  }
})
