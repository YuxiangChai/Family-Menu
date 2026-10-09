// Keep destination content out of the view tree while the native tab bar fades.
// onReady only means first rendering, not completion of the native route animation.
const FALLBACK_DELAY = 1000
const normalize = (path) => String(path || '').replace(/^\//, '').split('?')[0]

Component({
  options: { virtualHost: true, styleIsolation: 'apply-shared' },
  properties: { route: { type: String, value: '' } },
  data: { routeReady: false },
  lifetimes: {
    attached() {
      this.active = true
      this.observeRoute()
    },
    ready() {
      this.renderReady = true
      if (this.routeDone) this.reveal()
      else this.scheduleFallback()
    },
    detached() { this.active = false; this.stopWaiting() }
  },
  pageLifetimes: {
    hide() { this.active = false; this.stopWaiting() },
    show() {
      this.active = true
      if (this.data.routeReady) return
      if (this.routeDone && this.renderReady) { this.reveal(); return }
      this.observeRoute()
      if (this.renderReady) this.scheduleFallback()
    }
  },
  methods: {
    observeRoute() {
      if (this.observer || this.data.routeReady) return
      const watchId = this.watchId = (this.watchId || 0) + 1
      try {
        const performance = wx.getPerformance?.()
        if (!performance?.createObserver) return
        this.observer = performance.createObserver((list) => {
          if (watchId !== this.watchId || !this.active || this.data.routeReady) return
          const entries = list.getEntries()
          if (entries.some((entry) => entry.name === 'route' && normalize(entry.path) === normalize(this.properties.route))) {
            this.routeDone = true
            if (this.renderReady) this.reveal()
          }
        })
        this.observer.observe({ entryTypes: ['navigation'] })
      } catch (_error) {
        this.observer?.disconnect?.()
        this.observer = null
      }
    },
    scheduleFallback() {
      // Some clients/devtools do not emit route performance entries.
      // Do not leave the page empty when the signal is unavailable.
      if (this.data.routeReady || !this.active || this.waitTimer) return
      const watchId = this.watchId
      this.waitTimer = setTimeout(() => {
        if (watchId !== this.watchId) return
        this.waitTimer = null
        this.reveal()
      }, FALLBACK_DELAY)
    },
    reveal() {
      if (!this.active || !this.renderReady || this.data.routeReady) return
      this.stopWaiting()
      this.setData({ routeReady: true })
    },
    stopWaiting() {
      this.watchId = (this.watchId || 0) + 1
      clearTimeout(this.waitTimer)
      this.waitTimer = null
      this.observer?.disconnect?.()
      this.observer = null
    }
  }
})
