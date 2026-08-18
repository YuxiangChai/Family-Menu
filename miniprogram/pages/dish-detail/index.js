const api = require('../../utils/api')
const cart = require('../../utils/cart')

Page({
  data: { loading: true, error: '', dish: null, mainIngredients: [], seasonings: [], added: false },
  onLoad(options) { this.dishId = options.id; this.loadDish() },
  async loadDish() {
    this.setData({ loading: true, error: '' })
    try {
      const dish = await api.call('getDish', { dishId: this.dishId })
      this.setData({
        loading: false,
        dish,
        mainIngredients: (dish.ingredients || []).filter((item) => item.type === 'main'),
        seasonings: (dish.ingredients || []).filter((item) => item.type !== 'main')
      })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  addToCart() {
    cart.addDish(this.data.dish)
    this.setData({ added: true })
    wx.showToast({ title: '已加入今晚菜单', icon: 'success' })
  },
  goCart() { wx.navigateTo({ url: '/pages/cart/index' }) }
})
