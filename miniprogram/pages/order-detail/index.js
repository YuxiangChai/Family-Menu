const api = require('../../utils/api')
const { STATUS, dateTime } = require('../../utils/format')

const ACTIONS = {
  pending: [{ status: 'confirmed', label: '确认这份订单', primary: true }, { status: 'cancelled', label: '取消订单' }],
  confirmed: [{ status: 'cooking', label: '开始制作', primary: true }, { status: 'cancelled', label: '取消订单' }],
  cooking: [{ status: 'completed', label: '标记为已完成', primary: true }, { status: 'cancelled', label: '取消订单' }],
  completed: [], cancelled: []
}

Page({
  data: { loading: true, error: '', order: null, isAdmin: false, actions: [], updating: false },
  onLoad(options) { this.orderId = options.id; this.loadOrder() },
  async loadOrder() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.call('getOrder', { orderId: this.orderId })
      const ingredientSummary = (result.order.ingredientSummary || []).map((item) => ({
        ...item,
        sourcesText: (item.sources || []).join('、')
      }))
      const order = {
        ...result.order,
        ingredientSummary,
        statusText: STATUS[result.order.status] || result.order.status,
        statusClass: `status-${result.order.status}`,
        timeText: dateTime(result.order.createdAt)
      }
      this.setData({ loading: false, updating: false, order, isAdmin: result.isAdmin, actions: result.isAdmin ? ACTIONS[order.status] : [] })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  changeStatus(event) {
    const status = event.currentTarget.dataset.status
    const isCancel = status === 'cancelled'
    wx.showModal({
      title: isCancel ? '取消这份订单？' : '确认更新状态？',
      content: isCancel ? '取消后不能恢复，请确认已和家人沟通。' : `订单将变为“${STATUS[status]}”。`,
      confirmColor: isCancel ? '#A2362B' : '#B94732',
      success: (result) => { if (result.confirm) this.performStatusUpdate(status) }
    })
  },
  async performStatusUpdate(status) {
    if (this.data.updating) return
    this.setData({ updating: true })
    try {
      await api.call('updateOrderStatus', { orderId: this.orderId, status })
      wx.showToast({ title: '状态已更新', icon: 'success' })
      await this.loadOrder()
    } catch (error) {
      this.setData({ updating: false })
      wx.showToast({ title: error.message, icon: 'none' })
    }
  }
})
