const api = require('../../utils/api')
const cart = require('../../utils/cart')

Page({
  data: { loading: true, error: '', dish: null, heroSrc: '', mainIngredients: [], seasonings: [], added: false, changing: false, menuReady: false, pageReady: false, heroReady: false },
  onLoad(options) { this.dishId = options.id; return this.loadDish() },
  onReady() { this.setData({ pageReady: true }) },
  onShow() { this.visible = true; clearInterval(this.timer); this.refreshMenu(); this.timer = setInterval(() => this.refreshMenu(), 5000) },
  onHide() { this.visible = false; clearInterval(this.timer) },
  onUnload() { this.onHide(); this.loadGeneration = (this.loadGeneration || 0) + 1 },
  async refreshMenu() {
    if (this.syncing || this.data.changing) return
    this.syncing = true
    try { await cart.refresh(); if (this.visible) this.setData({ added: cart.getCart().some((item) => item.dishId === this.dishId), menuReady: true, menuId: cart.getDraft().menuId }) }
    catch (error) { if (this.visible) this.setData({ menuReady: false }) }
    finally { this.syncing = false }
  },
  async loadDish() {
    const generation = this.loadGeneration = (this.loadGeneration || 0) + 1
    this.setData({ loading: true, error: '', heroReady: false })
    try {
      const dish = await api.call('getDish', { dishId: this.dishId })
      if (generation !== this.loadGeneration) return
      wx.setNavigationBarTitle?.({ title: dish.name })
      const heroSrc = dish.imageFileId ? await this.preloadHero(dish.imageFileId) : ''
      if (generation !== this.loadGeneration) return
      this.setData({
        loading: false,
        dish,
        heroSrc,
        heroReady: true,
        mainIngredients: (dish.ingredients || []).filter((item) => item.type === 'main'),
        seasonings: (dish.ingredients || []).filter((item) => item.type !== 'main')
      })
    } catch (error) { if (generation === this.loadGeneration) this.setData({ loading: false, error: error.message }) }
  },
  preloadHero(src) {
    return new Promise((resolve) => {
      wx.getImageInfo({ src, success: (image) => resolve(image.path || src), fail: () => resolve('') })
    })
  },
  onHeroError() { this.setData({ heroSrc: '' }) },
  async addToCart() {
    if (!this.data.dish || this.data.changing || !this.data.menuReady) return
    const selected = this.data.added
    this.setData({ changing: true })
    try {
      await cart.selectDish(this.dishId, !selected, this.data.menuId)
      this.setData({ added: cart.getCart().some((item) => item.dishId === this.dishId), menuId: cart.getDraft().menuId })
      wx.showToast({ title: selected ? '已从全家菜单移除' : '已加入全家菜单', icon: 'success' })
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
    finally { this.setData({ changing: false }); this.refreshMenu() }
  },
  goCart() { wx.navigateTo({ url: '/pages/cart/index' }) }
})
