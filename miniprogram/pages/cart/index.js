const cart = require('../../utils/cart')

Page({
  data: { items: [], menuId: '', editOrderId: '', dinerCount: 2, remark: '', isAdmin: false,
    loading: true, submitting: false, changing: false, error: '' },
  onShow() {
    this.visible = true
    clearInterval(this.timer)
    this.timer = setInterval(() => this.refreshMenu(), 5000)
    return this.refreshMenu()
  },
  onHide() { this.visible = false; clearInterval(this.timer) },
  onUnload() { this.onHide() },
  async refreshMenu() {
    if (this.refreshing || this.data.changing || this.data.submitting) return
    this.refreshing = true
    try {
      await cart.refresh()
      if (!this.visible) return
      const details = cart.getDraft()
      const navTitle = details.editOrderId ? '修改订单' : '当前菜单'
      if (this.navTitle !== navTitle) { this.navTitle = navTitle; wx.setNavigationBarTitle?.({ title: navTitle }) }
      if (this.data.menuId && details.menuId !== this.data.menuId) {
        this.dirtyDiners = this.dirtyRemark = false
        this.setData({ error: '家人已提交或结束上一份菜单，正在显示当前菜单。' })
      }
      const values = { items: cart.getCart(), ...details, loading: false,
        ...(this.dirtyDiners ? { dinerCount: this.data.dinerCount } : {}),
        ...(this.dirtyRemark ? { remark: this.data.remark } : {}) }
      const patch = {}
      for (const [key, value] of Object.entries(values)) if (JSON.stringify(this.data[key]) !== JSON.stringify(value)) patch[key] = value
      if (Object.keys(patch).length) this.setData(patch)
    } catch (error) { if (this.visible) this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  async removeItem(event) {
    if (this.data.changing || this.data.submitting) return
    const dishId = event.currentTarget.dataset.id
    this.setData({ changing: true, error: '' })
    try {
      await cart.selectDish(dishId, false, this.data.menuId)
      this.setData({ items: cart.getCart() })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ changing: false }) }
  },
  onDinerCount(event) { this.dirtyDiners = true; this.setData({ dinerCount: event.detail.value }) },
  onRemark(event) { this.dirtyRemark = true; this.setData({ remark: event.detail.value }) },
  async saveDetails() {
    if (!this.data.menuId || this.data.submitting || this.data.changing) return false
    const changes = {}
    if (this.dirtyDiners) {
      const number = Number(this.data.dinerCount)
      if (!Number.isInteger(number) || number < 1 || number > 20) { this.setData({ error: '就餐人数请填写 1 到 20 的整数' }); return false }
      changes.dinerCount = number
    }
    if (this.dirtyRemark) changes.remark = this.data.remark
    if (!Object.keys(changes).length) return true
    this.setData({ changing: true, error: '' })
    try {
      await cart.change(this.data.menuId, changes)
      this.dirtyDiners = this.dirtyRemark = false
      return true
    } catch (error) { this.setData({ error: error.message }); return false }
    finally { this.setData({ changing: false }) }
  },
  addMore() { if (!this.data.submitting) wx.switchTab({ url: '/pages/index/index' }) },
  async submitOrder() {
    if (this.data.submitting || this.data.changing || !this.data.menuId) return
    const menuId = this.data.menuId
    if (!await this.saveDetails()) return
    if (this.data.submitting) return
    this.setData({ submitting: true, error: '' })
    try {
      const result = await cart.submit(menuId)
      this.dirtyDiners = this.dirtyRemark = false
      wx.redirectTo({ url: `/pages/order-detail/index?id=${result.orderId}&poster=1` })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ submitting: false }) }
  },
  cancelEdit() {
    if (!this.data.isAdmin || !this.data.menuId || this.data.changing || this.data.submitting) return
    const menuId = this.data.menuId
    wx.showModal({ title: '结束全家的当前菜单？', content: '会清空这份共享菜单的未提交选择。历史订单不会删除或改变。',
      confirmText: '结束菜单', confirmColor: '#b94732', success: async (result) => {
        if (!result.confirm) return
        this.setData({ changing: true })
        try { await cart.cancel(menuId); this.dirtyDiners = this.dirtyRemark = false }
        catch (error) { this.setData({ error: error.message }) }
        finally { this.setData({ changing: false }); this.refreshMenu() }
      } })
  },
  reloadEdit() { this.refreshMenu() }
})
