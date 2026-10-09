const api = require('../../utils/api')
const { orderDateTime } = require('../../utils/format')
const { reorder } = require('../../utils/reorder')
const { generatePoster } = require('../../utils/order-poster')
const { sharePoster } = require('../../utils/order-images')

Page({
  data: { loading: true, refreshing: false, loadingMore: false, error: '', orders: [], isAdmin: false, nextCursor: null, copyingId: '', sharingId: '' },
  onHide() { this.shareGeneration = (this.shareGeneration || 0) + 1; this.setData({ sharingId: '' }) },
  onUnload() { this.shareGeneration = (this.shareGeneration || 0) + 1 },
  onShow() { return this.loadOrders() },
  onPullDownRefresh() { this.loadOrders().finally(() => wx.stopPullDownRefresh()) },
  async loadOrders(more = false) {
    more = more === true
    if (more && (this.data.refreshing || this.data.loadingMore || !this.data.nextCursor)) return
    const cursor = more ? this.data.nextCursor : null
    const generation = this.generation = (this.generation || 0) + 1
    this.setData(more ? { loadingMore: true, error: '' } : { loading: !this.loaded, refreshing: true, loadingMore: false, error: '' })
    try {
      // Revalidate all previously loaded pages atomically, preserving scroll height.
      const fetched = []
      let next = cursor, result, pages = 0
      const targetPages = more ? 1 : this.pagesLoaded || 1
      do {
        result = await api.call('listOrders', { scope: 'history', ...(next ? { cursor: next } : {}) })
        if (generation !== this.generation) return
        fetched.push(...result.orders)
        next = result.nextCursor
        pages++
      } while (next && pages < targetPages)
      const orders = fetched.map((order) => ({
        ...order,
        ...orderDateTime(order.createdAt),
        previewItems: (order.items || []).slice(0, 4),
        remainingCount: Math.max(0, (order.items || []).length - 4)
      }))
      const combined = more ? [...this.data.orders, ...orders] : orders
      const unique = combined.filter((order, index) => combined.findIndex((item) => item._id === order._id) === index)
      this.loaded = true
      this.pagesLoaded = more ? (this.pagesLoaded || 1) + pages : pages
      this.setData({ loading: false, refreshing: false, loadingMore: false,
        ...(JSON.stringify(unique) === JSON.stringify(this.data.orders) ? {} : { orders: unique }),
        isAdmin: result.isAdmin, nextCursor: next })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      if (revoked) { this.loaded = false; this.pagesLoaded = 0 }
      this.setData({ loading: false, refreshing: false, loadingMore: false, error: error.message,
        ...(revoked ? { orders: [], isAdmin: false, nextCursor: null } : {}) })
    }
  },
  loadMore() { return this.loadOrders(true) },
  onReachBottom() { this.loadMore() },
  async copyOrder(event) {
    if (this.data.copyingId || this.data.sharingId) return
    const orderId = event.currentTarget.dataset.id
    this.setData({ copyingId: orderId })
    try { await reorder(orderId) }
    catch (error) { wx.showToast({ title: error.message || '复制失败，请重试', icon: 'none' }) }
    finally { this.setData({ copyingId: '' }) }
  },
  async shareOrder(event) {
    if (this.data.sharingId || this.data.copyingId) return
    const orderId = event.currentTarget.dataset.id
    const generation = this.shareGeneration = (this.shareGeneration || 0) + 1
    this.setData({ sharingId: orderId })
    try {
      const { order } = await api.call('getOrder', { orderId })
      if (generation !== this.shareGeneration) return
      const image = await generatePoster(this, order, () => generation === this.shareGeneration)
      if (generation === this.shareGeneration) sharePoster(image.path)
    } catch (error) {
      if (generation === this.shareGeneration) wx.showToast({ title: error.message || '图片生成失败，请重试', icon: 'none' })
    } finally { if (generation === this.shareGeneration) this.setData({ sharingId: '' }) }
  },
  openOrder(event) { wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` }) }
})
