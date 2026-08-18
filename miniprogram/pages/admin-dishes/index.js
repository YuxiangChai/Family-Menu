const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', dishes: [] },
  onShow() { this.loadDishes() },
  async loadDishes() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.call('listMenu', { includeDisabled: true })
      const categoryMap = {}
      result.categories.forEach((item) => { categoryMap[item._id] = item.name })
      this.setData({ loading: false, dishes: result.dishes.map((dish) => ({ ...dish, displayInitial: dish.name.slice(0, 1), categoryName: categoryMap[dish.categoryId] || '未分类' })) })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
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
