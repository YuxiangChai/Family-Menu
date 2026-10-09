const api = require('../../utils/api')
const { dateTime, orderDateTime } = require('../../utils/format')
const { reorder } = require('../../utils/reorder')
const { startOrderEdit } = require('../../utils/order-edit')
const { generatePoster, posterLayout } = require('../../utils/order-poster')
const { sharePoster } = require('../../utils/order-images')
const { imageKey } = require('../../utils/stable-media')

function posterKey(order) {
  return JSON.stringify([order._id, order.creatorName, order.dinerCount, order.createdAt, order.updatedAt, order.remark,
    (order.items || []).map((item) => [item.dishId, item.name, imageKey(item.imageFileId)])])
}

Page({
  data: { loading: true, refreshing: false, error: '', order: null, canEdit: false, copying: false, editing: false,
    generating: false, sharing: false, posterPath: '', posterAspect: 100, posterCurrent: false, posterError: '' },
  onLoad(options) { this.orderId = options.id },
  onReady() { this.ready = true; if (this.data.order && !this.data.loading) this.generateImage() },
  onShow() { return this.loadOrder() },
  onHide() { this.generation = (this.generation || 0) + 1; this.setData({ generating: false, sharing: false, refreshing: false }) },
  onUnload() { this.generation = (this.generation || 0) + 1 },
  async loadOrder() {
    const generation = this.generation = (this.generation || 0) + 1
    this.setData({ loading: !this.data.order, refreshing: true, error: '', generating: false })
    try {
      const result = await api.call('getOrder', { orderId: this.orderId })
      if (generation !== this.generation) return
      const order = { ...result.order, ...orderDateTime(result.order.createdAt), updatedText: dateTime(result.order.updatedAt),
        ingredientSummary: (result.order.ingredientSummary || []).map((item) => ({ ...item, sourcesText: (item.sources || []).join('、') })) }
      const current = !!this.data.posterPath && this.posterKey === posterKey(order)
      const layout = !this.data.posterPath ? posterLayout(order) : null
      this.setData({ loading: false, refreshing: false, order, canEdit: Boolean(result.canEdit), posterCurrent: current,
        ...(layout ? { posterAspect: layout.height / layout.width * 100 } : {}) }, () => { if (this.ready && !current) this.generateImage() })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)
      this.setData({ loading: false, refreshing: false, error: error.message, canEdit: false,
        ...(revoked ? { order: null, posterPath: '', posterCurrent: false } : {}) })
    }
  },
  async generateImage() {
    if (!this.data.order || this.data.generating) return
    const generation = this.generation
    const order = this.data.order, key = posterKey(order)
    this.setData({ generating: true, posterCurrent: false, posterError: '' })
    try {
      const result = await generatePoster(this, order, () => generation === this.generation)
      if (generation === this.generation) {
        this.posterKey = key
        this.setData({ posterPath: result.path, posterCurrent: true,
          ...(result.height && result.width ? { posterAspect: result.height / result.width * 100 } : {}) })
      }
    } catch (error) { if (generation === this.generation) this.setData({ posterError: error.message || '图片生成失败，请重试' }) }
    finally { if (generation === this.generation) this.setData({ generating: false }) }
  },
  previewImage() { if (this.data.posterPath) wx.previewImage({ urls: [this.data.posterPath], current: this.data.posterPath }) },
  async shareImage() {
    if (!this.data.posterPath || !this.data.posterCurrent || this.data.generating || this.data.sharing || this.data.refreshing || this.data.error) return
    const generation = this.generation
    this.setData({ sharing: true })
    try {
      const result = await api.call('getOrder', { orderId: this.orderId })
      if (generation !== this.generation) return
      const poster = await generatePoster(this, result.order, () => generation === this.generation)
      if (generation !== this.generation) return
      this.posterKey = posterKey(result.order)
      this.setData({ posterPath: poster.path, posterCurrent: true,
        ...(poster.height && poster.width ? { posterAspect: poster.height / poster.width * 100 } : {}), canEdit: Boolean(result.canEdit), order: {
        ...result.order, ...orderDateTime(result.order.createdAt), updatedText: dateTime(result.order.updatedAt),
        ingredientSummary: (result.order.ingredientSummary || []).map((item) => ({ ...item, sourcesText: (item.sources || []).join('、') }))
      } })
      sharePoster(poster.path)
    } catch (error) {
      if (generation !== this.generation) return
      if (['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)) this.setData({ order: null, posterPath: '', posterCurrent: false, canEdit: false, error: error.message })
      wx.showToast({ title: error.message || '获取最新菜单失败，请重试', icon: 'none' })
    }
    finally { if (generation === this.generation) this.setData({ sharing: false }) }
  },
  async editOrder() {
    if (!this.data.canEdit || this.data.editing || this.data.refreshing || this.data.error) return
    this.setData({ editing: true })
    try { await startOrderEdit(this.orderId) }
    catch (error) { wx.showToast({ title: error.message || '载入失败，请重试', icon: 'none' }) }
    finally { this.setData({ editing: false }) }
  },
  async copyOrder() {
    if (this.data.copying) return
    this.setData({ copying: true })
    try { await reorder(this.orderId) }
    catch (error) { wx.showToast({ title: error.message || '复制失败，请重试', icon: 'none' }) }
    finally { this.setData({ copying: false }) }
  }
})
