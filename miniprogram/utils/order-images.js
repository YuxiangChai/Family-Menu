const DEFAULT_DISH_IMAGE = '/images/dish-placeholder.png'

function sharePoster(path) {
  if (typeof wx.showShareImageMenu !== 'function') { wx.previewImage({ urls: [path], current: path }); return }
  wx.showShareImageMenu({ path, needShowEntrance: false, fail: (error) => {
    if (/cancel/i.test(error.errMsg || '')) return
    wx.showToast({ title: '请在手机微信分享，或长按图片保存', icon: 'none' })
    wx.previewImage({ urls: [path], current: path })
  } })
}

module.exports = { DEFAULT_DISH_IMAGE, sharePoster }
