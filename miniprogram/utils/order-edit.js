const cart = require('./cart')

async function startOrderEdit(orderId, navigate = true) {
  try {
    await cart.start({ orderId })
    if (navigate) wx.navigateTo({ url: '/pages/cart/index' })
    return true
  } catch (error) {
    if (error.code !== 'ACTIVE_MENU_BUSY') throw error
    wx.showModal({ title: '家里已有当前菜单', content: '请先完成这份共享菜单，再修改其他订单。',
      confirmText: '查看当前菜单', success: (result) => { if (result.confirm) wx.navigateTo({ url: '/pages/cart/index' }) } })
    return false
  }
}
module.exports = { startOrderEdit }
