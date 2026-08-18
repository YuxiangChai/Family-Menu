const api = require('../../utils/api')
const cart = require('../../utils/cart')
const { todayText } = require('../../utils/format')

Page({
  data: {
    loading: true, error: '', unauthorized: false, joining: false, inviteCode: '', nickname: '',
    today: todayText(), member: null, categories: [], dishes: [], visibleDishes: [], sections: [],
    activeCategory: '', keyword: '', cartCount: 0
  },
  onLoad() { this.loadMenu() },
  onShow() { this.setData({ cartCount: cart.countCart() }) },
  onPullDownRefresh() { this.loadMenu().finally(() => wx.stopPullDownRefresh()) },
  async loadMenu() {
    this.setData({ loading: true, error: '', unauthorized: false })
    try {
      const profile = await api.call('getProfile')
      getApp().globalData.profile = profile
      if (!profile.authorized) {
        this.setData({ loading: false, unauthorized: true })
        return
      }
      const result = await api.call('listMenu')
      const dishes = result.dishes.map((dish) => ({ ...dish, displayInitial: dish.name.slice(0, 1) }))
      const categories = result.categories
        .filter((category) => dishes.some((dish) => dish.categoryId === category._id))
        .map((category, index) => ({ ...category, anchorId: `menu-section-${index}` }))
      this.setData({
        loading: false,
        member: result.member,
        categories,
        dishes,
        activeCategory: categories.length ? categories[0]._id : ''
      })
      this.applyFilters()
    } catch (error) {
      this.setData({ loading: false, error: error.message || '菜单加载失败' })
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
  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase()
    const visibleDishes = this.data.dishes.filter((dish) => {
      const text = `${dish.name} ${dish.description || ''}`.toLowerCase()
      return !keyword || text.includes(keyword)
    })
    const sections = this.data.categories
      .map((category) => ({ ...category, dishes: visibleDishes.filter((dish) => dish.categoryId === category._id) }))
      .filter((section) => section.dishes.length)
    this.setData({ visibleDishes, sections })
  },
  openDish(event) { wx.navigateTo({ url: `/pages/dish-detail/index?id=${event.currentTarget.dataset.id}` }) },
  addDish(event) {
    const dish = this.data.dishes.find((item) => item._id === event.currentTarget.dataset.id)
    if (!dish) return
    cart.addDish(dish)
    this.setData({ cartCount: cart.countCart() })
    wx.showToast({ title: '已加入今晚菜单', icon: 'success' })
  },
  openCart() { wx.navigateTo({ url: '/pages/cart/index' }) }
})
