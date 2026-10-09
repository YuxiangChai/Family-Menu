const api = require('../../utils/api')
const cart = require('../../utils/cart')
const { todayText } = require('../../utils/format')
const { stablePictures } = require('../../utils/stable-media')

Page({
  data: {
    loading: true, error: '', unauthorized: false, joining: false, inviteCode: '', nickname: '',
    today: todayText(), member: null, categories: [], dishes: [], visibleDishes: [], sections: [],
    activeCategory: '', keyword: '', cartCount: 0, editOrderId: '', activeMenuId: '', menuReady: false, changingDishId: '', syncError: '', menuRefreshError: ''
  },
  onLoad() { this.loadMenu() },
  onShow() { this.visible = true; clearInterval(this.timer); this.refreshActive(); this.timer = setInterval(() => this.refreshActive(), 5000) },
  onHide() { this.visible = false; clearInterval(this.timer) },
  onUnload() { this.onHide() },
  applyActive() {
    const draft = cart.getDraft()
    const values = { cartCount: cart.countCart(), editOrderId: draft.editOrderId, activeMenuId: draft.menuId, menuReady: true, syncError: '' }
    const patch = {}
    for (const [key, value] of Object.entries(values)) if (this.data[key] !== value) patch[key] = value
    const selected = new Set(cart.getCart().map((item) => item.dishId))
    // Only update selected flags; do not resend or remount the dish/image lists.
    this.data.visibleDishes.forEach((dish, index) => {
      const value = selected.has(dish._id)
      if (dish.selected !== value) patch[`visibleDishes[${index}].selected`] = value
    })
    this.data.sections.forEach((section, sectionIndex) => section.dishes.forEach((dish, index) => {
      const value = selected.has(dish._id)
      if (dish.selected !== value) patch[`sections[${sectionIndex}].dishes[${index}].selected`] = value
    }))
    if (Object.keys(patch).length) this.setData(patch)
  },
  async refreshActive() {
    // Wait for membership verification; a first-time visitor must see the invite form.
    if (!this.menuLoaded || this.data.unauthorized || this.syncing || this.data.changingDishId) return
    this.syncing = true
    try { await cart.refresh(); if (this.visible) this.applyActive() }
    catch (error) {
      if (!this.visible) return
      if (['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)) {
        this.menuLoaded = false
        this.menuGeneration = (this.menuGeneration || 0) + 1
        this.setData({ loading: false, error: error.message, member: null, dishes: [], visibleDishes: [], sections: [], categories: [], menuReady: false, activeMenuId: '', cartCount: 0 })
      } else this.setData({ syncError: error.message, menuReady: false })
    }
    finally { this.syncing = false }
  },
  onPullDownRefresh() { this.loadMenu().finally(() => wx.stopPullDownRefresh()) },
  async loadMenu() {
    const generation = this.menuGeneration = (this.menuGeneration || 0) + 1
    this.setData({ loading: !this.menuLoaded, error: '', menuRefreshError: '' })
    try {
      const profile = await api.call('getProfile')
      if (generation !== this.menuGeneration) return
      getApp().globalData.profile = profile
      if (!profile.authorized) {
        this.menuLoaded = false
        this.setData({ loading: false, unauthorized: true, member: null, dishes: [], visibleDishes: [], sections: [], categories: [], menuReady: false })
        return
      }
      const result = await api.call('listMenu')
      if (generation !== this.menuGeneration) return
      const dishes = stablePictures(result.dishes, this.data.dishes, '_id').map((dish) => ({ ...dish, displayInitial: dish.name.slice(0, 1) }))
      const categories = result.categories
        .filter((category) => dishes.some((dish) => dish.categoryId === category._id))
        .map((category, index) => ({ ...category, anchorId: `menu-section-${index}` }))
      this.menuLoaded = true
      this.setData({
        loading: false,
        unauthorized: false,
        member: result.member,
        categories,
        dishes,
        activeCategory: categories.some((item) => item._id === this.data.activeCategory) ? this.data.activeCategory : categories[0]?._id || '',
        ...this.filteredMenu(dishes, categories)
      })
      await this.refreshActive()
    } catch (error) {
      if (generation !== this.menuGeneration) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      if (revoked) this.menuLoaded = false
      this.setData({ loading: false,
        ...(this.menuLoaded ? { menuRefreshError: error.message || '菜单更新失败' } : { error: error.message || '菜单加载失败' }),
        ...(revoked ? { member: null, dishes: [], visibleDishes: [], sections: [], categories: [], menuReady: false } : {}) })
    }
  },
  onInviteCodeInput(event) { this.setData({ inviteCode: event.detail.value }) },
  onNicknameInput(event) { this.setData({ nickname: event.detail.value }) },
  async joinFamily() {
    if (this.data.joining) return
    if (this.data.inviteCode.trim().replace(/[\s-]+/g, '').length < 8) {
      wx.showToast({ title: '请输入完整邀请码', icon: 'none' })
      return
    }
    this.setData({ joining: true })
    try {
      await api.call('joinFamily', {
        inviteCode: this.data.inviteCode,
        nickname: this.data.nickname
      })
      getApp().globalData.profile = null
      wx.showToast({ title: '欢迎回家', icon: 'success' })
      this.setData({ inviteCode: '', unauthorized: false })
      await this.loadMenu()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 2600 })
    } finally {
      this.setData({ joining: false })
    }
  },
  onSearch(event) { this.setData({ keyword: event.detail.value }); this.applyFilters() },
  selectCategory(event) {
    const { id, anchor } = event.currentTarget.dataset
    this.setData({ activeCategory: id })
    wx.pageScrollTo({ selector: `#${anchor}`, offsetTop: -176, duration: 280 })
  },
  filteredMenu(dishes = this.data.dishes, categories = this.data.categories) {
    const keyword = this.data.keyword.trim().toLowerCase()
    const selected = new Set(cart.getCart().map((item) => item.dishId))
    const visibleDishes = dishes.map((dish) => ({ ...dish, selected: selected.has(dish._id) })).filter((dish) => {
      const text = `${dish.name} ${dish.description || ''}`.toLowerCase()
      return !keyword || text.includes(keyword)
    })
    const sections = categories
      .map((category) => ({ ...category, dishes: visibleDishes.filter((dish) => dish.categoryId === category._id) }))
      .filter((section) => section.dishes.length)
    return { visibleDishes, sections }
  },
  applyFilters() {
    const filtered = this.filteredMenu()
    if (JSON.stringify(filtered.visibleDishes) !== JSON.stringify(this.data.visibleDishes) || JSON.stringify(filtered.sections) !== JSON.stringify(this.data.sections)) this.setData(filtered)
  },
  openDish(event) { wx.navigateTo({ url: `/pages/dish-detail/index?id=${event.currentTarget.dataset.id}` }) },
  async addDish(event) {
    if (!this.data.menuReady || this.data.changingDishId) return
    const dish = this.data.dishes.find((item) => item._id === event.currentTarget.dataset.id)
    if (!dish) return
    const selected = event.currentTarget.dataset.selected === true || event.currentTarget.dataset.selected === 'true'
    this.setData({ changingDishId: dish._id })
    try {
      await cart.selectDish(dish._id, !selected, this.data.activeMenuId)
      this.applyActive()
      wx.showToast({ title: selected ? '已从全家菜单移除' : '已加入全家菜单', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
      await cart.refresh().then(() => this.applyActive()).catch((refreshError) => this.setData({ menuReady: false, syncError: refreshError.message }))
    }
    finally { this.setData({ changingDishId: '' }) }
  },
  openCart() { wx.navigateTo({ url: '/pages/cart/index' }) }
})
