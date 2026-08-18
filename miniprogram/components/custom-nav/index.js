Component({
  properties: {
    title: { type: String, value: '' }
  },
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    totalHeight: 64
  },
  lifetimes: {
    attached() {
      let statusBarHeight = 20
      let navBarHeight = 44
      try {
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const capsule = wx.getMenuButtonBoundingClientRect()
        statusBarHeight = windowInfo.statusBarHeight || statusBarHeight
        if (capsule && capsule.height && capsule.top) {
          navBarHeight = capsule.height + Math.max(0, capsule.top - statusBarHeight) * 2
        }
      } catch (_error) {}
      this.setData({ statusBarHeight, navBarHeight, totalHeight: statusBarHeight + navBarHeight })
    }
  },
  methods: {
    goBack() {
      if (getCurrentPages().length > 1) {
        wx.navigateBack({ delta: 1 })
        return
      }
      wx.switchTab({ url: '/pages/index/index' })
    }
  }
})
