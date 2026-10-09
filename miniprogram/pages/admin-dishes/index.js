const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', dishes: [] },
  onShow() { return this.loadDishes() },
  onUnload() { this.generation = (this.generation || 0) + 1 },
  async loadDishes() {
    const generation = this.generation = (this.generation || 0) + 1
    this.setData({ loading: !this.loaded, error: '' })
    try {
      const result = await api.call('listMenu', { includeDisabled: true })
      if (generation !== this.generation) return
      this.loaded = true
      const categoryMap = {}
      result.categories.forEach((item) => { categoryMap[item._id] = item.name })
      const dishes = result.dishes.map((dish) => ({ ...dish, displayInitial: dish.name.slice(0, 1), categoryName: categoryMap[dish.categoryId] || '未分类' }))
      this.setData({ loading: false, ...(JSON.stringify(dishes) !== JSON.stringify(this.data.dishes) ? { dishes } : {}) })
    } catch (error) {
      if (generation !== this.generation) return
      const revoked = ['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(error.code)
      if (revoked) this.loaded = false
      this.setData({ loading: false, error: error.message, ...(revoked ? { dishes: [] } : {}) })
    }
  },
  addDish() { wx.navigateTo({ url: '/pages/dish-edit/index' }) },
  editDish(event) { wx.navigateTo({ url: `/pages/dish-edit/index?id=${event.currentTarget.dataset.id}` }) },
  toggleDish(event) {
    const id = event.currentTarget.dataset.id
    const enabled = event.currentTarget.dataset.enabled !== true
    const verb = enabled ? '上架' : '下架'
    wx.showModal({
      title: `${verb}这道菜？`,
      content: enabled ? '上架后家庭成员可以在菜单看到它。' : '已有订单会保留菜品快照，不受下架影响。',
      confirmColor: '#B94732',
      success: async (result) => {
        if (!result.confirm) return
        try { await api.call('toggleDish', { dishId: id, enabled }); wx.showToast({ title: `已${verb}`, icon: 'success' }); this.loadDishes() }
        catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
      }
    })
  }
})
