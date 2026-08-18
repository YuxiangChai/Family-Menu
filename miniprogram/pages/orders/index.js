const api = require('../../utils/api')
const { STATUS, dateTime, todayText } = require('../../utils/format')

Page({
  data: { loading: true, error: '', orders: [], isAdmin: false, today: todayText() },
  onShow() { this.loadOrders() },
  onPullDownRefresh() { this.loadOrders().finally(() => wx.stopPullDownRefresh()) },
  async loadOrders() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.call('listOrders')
      const orders = result.orders.map((order) => ({
        ...order,
        statusText: STATUS[order.status] || order.status,
        statusClass: `status-${order.status}`,
        timeText: dateTime(order.createdAt),
        itemText: (order.items || []).map((item) => `${item.name} × ${item.servings}`).join('、')
      }))
      this.setData({ loading: false, orders, isAdmin: result.isAdmin })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  openOrder(event) { wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }) }
})
