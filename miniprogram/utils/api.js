function call(action, payload = {}) {
  return wx.cloud.callFunction({
    name: 'menuService',
    data: { action, ...payload }
  }).then((response) => {
    const result = response.result || {}
    if (!result.ok) {
      const error = new Error((result.error && result.error.message) || '请求失败，请稍后重试')
      error.code = result.error && result.error.code
      throw error
    }
    return result.data
  })
}

module.exports = { call }
