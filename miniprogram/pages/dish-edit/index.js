const api = require('../../utils/api')

function emptyDish() {
  return {
    name: '', categoryId: '', description: '', imageFileId: '',
    defaultServings: 2, cookingTime: 20, enabled: true,
    ingredients: [
      { name: '', quantity: '', unit: '', type: 'main', note: '' },
      { name: '', quantity: '', unit: '', type: 'seasoning', note: '' }
    ],
    steps: ['']
  }
}

Page({
  data: { loading: true, error: '', saving: false, uploading: false, navTitle: '编辑菜品', dish: emptyDish(), categories: [], categoryNames: [], categoryIndex: 0 },
  onLoad(options) {
    this.dishId = options.id || ''
    this.setData({ navTitle: this.dishId ? '编辑菜品' : '新增菜品' })
    this.loadForm()
  },
  async loadForm() {
    this.setData({ loading: true, error: '' })
    try {
      const menu = await api.call('listMenu', { includeDisabled: true })
      let dish = emptyDish()
      if (this.dishId) dish = await api.call('getDish', { dishId: this.dishId })
      else if (menu.categories[0]) dish.categoryId = menu.categories[0]._id
      const categoryIndex = Math.max(0, menu.categories.findIndex((item) => item._id === dish.categoryId))
      this.setData({
        loading: false, dish, categories: menu.categories,
        categoryNames: menu.categories.map((item) => item.name), categoryIndex
      })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  updateField(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`dish.${field}`]: event.detail.value })
  },
  changeEnabled(event) { this.setData({ 'dish.enabled': event.detail.value }) },
  changeCategory(event) {
    const categoryIndex = Number(event.detail.value)
    this.setData({ categoryIndex, 'dish.categoryId': this.data.categories[categoryIndex]._id })
  },
  updateIngredient(event) {
    const index = Number(event.currentTarget.dataset.index)
    const field = event.currentTarget.dataset.field
    this.setData({ [`dish.ingredients[${index}].${field}`]: event.detail.value })
  },
  setIngredientType(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ [`dish.ingredients[${index}].type`]: event.currentTarget.dataset.type })
  },
  addIngredient() {
    const ingredients = [...this.data.dish.ingredients, { name: '', quantity: '', unit: '', type: 'main', note: '' }]
    this.setData({ 'dish.ingredients': ingredients })
  },
  removeIngredient(event) {
    if (this.data.dish.ingredients.length <= 1) return
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ 'dish.ingredients': this.data.dish.ingredients.filter((_, itemIndex) => itemIndex !== index) })
  },
  updateStep(event) { this.setData({ [`dish.steps[${Number(event.currentTarget.dataset.index)}]`]: event.detail.value }) },
  addStep() { this.setData({ 'dish.steps': [...this.data.dish.steps, ''] }) },
  removeStep(event) {
    if (this.data.dish.steps.length <= 1) return
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ 'dish.steps': this.data.dish.steps.filter((_, itemIndex) => itemIndex !== index) })
  },
  async chooseImage() {
    if (this.data.uploading) return
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
      const tempFilePath = result.tempFiles[0].tempFilePath
      if (result.tempFiles[0].size > 3 * 1024 * 1024) {
        wx.showToast({ title: '请选择小于 3MB 的图片', icon: 'none' })
        return
      }
      const detectedSuffix = ((tempFilePath.match(/\.([a-zA-Z0-9]+)$/) || [])[1] || '').toLowerCase()
      const suffix = ['jpg', 'jpeg', 'png', 'webp'].includes(detectedSuffix) ? detectedSuffix : 'jpg'
      this.setData({ uploading: true })
      const base64 = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({ filePath: tempFilePath, encoding: 'base64', success: (read) => resolve(read.data), fail: reject })
      })
      const upload = await api.call('uploadDishImage', { extension: suffix, base64 })
      this.setData({ 'dish.imageFileId': upload.fileID, uploading: false })
    } catch (error) {
      this.setData({ uploading: false })
      if (!String(error.errMsg || '').includes('cancel')) wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
    }
  },
  async saveDish() {
    if (this.data.saving) return
    const dish = this.data.dish
    if (!dish.name.trim() || !dish.categoryId) { this.setData({ error: '请填写菜名并选择分类' }); return }
    if (!dish.ingredients.some((item) => item.name.trim())) { this.setData({ error: '至少填写一种原料' }); return }
    if (!dish.steps.some((step) => step.trim())) { this.setData({ error: '至少填写一个制作步骤' }); return }
    this.setData({ saving: true, error: '' })
    try {
      await api.call('saveDish', { dish: { ...dish, _id: this.dishId || undefined } })
      wx.showToast({ title: '菜品已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { this.setData({ saving: false, error: error.message }) }
  }
})
