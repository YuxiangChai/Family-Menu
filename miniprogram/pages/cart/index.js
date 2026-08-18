const api = require('../../utils/api')
const cartStore = require('../../utils/cart')

Page({
  data: { items: [], dinerCount: 2, remark: '', submitting: false, error: '' },
  onShow() { this.setData({ items: cartStore.getCart(), error: '' }) },
  changeServings(event) {
    const index = Number(event.currentTarget.dataset.index)
    const delta = Number(event.currentTarget.dataset.delta)
    const items = this.data.items.map((item) => ({ ...item }))
    items[index].servings = Math.max(1, Math.min(20, items[index].servings + delta))
    cartStore.saveCart(items)
    this.setData({ items })
  },
  removeItem(event) {
    const index = Number(event.currentTarget.dataset.index)
    const items = this.data.items.filter((_, itemIndex) => itemIndex !== index)
    cartStore.saveCart(items)
    this.setData({ items })
    wx.showToast({ title: '已从今晚菜单移除', icon: 'none' })
  },
  onDinerCount(event) { this.setData({ dinerCount: event.detail.value }) },
  onRemark(event) { this.setData({ remark: event.detail.value }) },
  addMore() { wx.navigateBack() },
  async submitOrder() {
    if (this.data.submitting || !this.data.items.length) return
    const dinerCount = Number(this.data.dinerCount)
    if (!Number.isInteger(dinerCount) || dinerCount < 1 || dinerCount > 20) {
      this.setData({ error: '就餐人数请填写 1 到 20 的整数' })
      return
    }
    this.setData({ submitting: true, error: '' })
    try {
      const result = await api.call('createOrder', {
        payload: {
          dinerCount,
          remark: this.data.remark,
          items: this.data.items.map((item) => ({ dishId: item.dishId, servings: item.servings })),
          idempotencyKey: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        }
      })
      cartStore.saveCart([])
      wx.showToast({ title: result.duplicated ? '订单已提交' : '点菜成功', icon: 'success' })
      setTimeout(() => wx.switchTab({ url: '/pages/orders/index' }), 700)
    } catch (error) {
      this.setData({ submitting: false, error: error.message || '提交失败，请重试' })
    }
  }
})
