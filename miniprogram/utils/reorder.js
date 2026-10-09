const api = require('./api')
const cart = require('./cart')

async function reorder(orderId) {
  const draft = await api.call('prepareReorder', { orderId })
  if (!draft.items.length) {
    wx.showToast({ title: '这些菜已下架，请重新选菜', icon: 'none' })
    return false
  }
  const confirmed = await new Promise((resolve) => wx.showModal({
    title: '再点一次？',
    content: `${draft.unavailable.length ? `已跳过下架菜：${draft.unavailable.join('、')}。` : ''}将这些菜放入全家共享的当前菜单，不会直接下单，也不会替换已有菜单。`,
    confirmText: '载入菜单', success: (result) => resolve(result.confirm), fail: () => resolve(false)
  }))
  if (!confirmed) return false
  try { await cart.start({ sourceOrderId: orderId }) }
  catch (error) {
    if (error.code !== 'ACTIVE_MENU_BUSY') throw error
    wx.showModal({ title: '家里已有当前菜单', content: '请先完成当前菜单，再点这一单。',
      confirmText: '查看当前菜单', success: (result) => { if (result.confirm) wx.navigateTo({ url: '/pages/cart/index' }) } })
    return false
  }
  wx.showToast({ title: '已载入全家当前菜单', icon: 'success' })
  wx.switchTab({ url: '/pages/index/index' })
  return true
}
module.exports = { reorder }
