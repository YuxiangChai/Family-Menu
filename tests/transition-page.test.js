const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../miniprogram')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function setup(mode = 'supported') {
  let definition, time = 0, timerId = 0
  const timers = new Map(), observers = []
  const performance = {
    createObserver(callback) {
      const observer = { callback, disconnected: false, observe(options) {
        this.options = options
        if (mode === 'observe-error') throw new Error('not supported')
      }, disconnect() { this.disconnected = true } }
      observers.push(observer)
      return observer
    }
  }
  vm.runInNewContext(read('components/transition-page/index.js'), {
    Component: (component) => { definition = component },
    wx: mode === 'unsupported' ? {} : { getPerformance: () => performance },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: time + delay }); return id },
    clearTimeout(id) { timers.delete(id) }
  })
  const component = { ...definition.methods, data: { ...definition.data },
    properties: { route: 'pages/family-members/index' }, patches: [],
    setData(patch) { this.patches.push(patch); Object.assign(this.data, patch) } }
  const life = (name) => definition.lifetimes[name].call(component)
  const pageLife = (name) => definition.pageLifetimes[name].call(component)
  const emit = (entries, observer = observers.at(-1)) => observer.callback({ getEntries: () => entries })
  const tick = (ms) => {
    time += ms
    for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback() }
  }
  return { component, life, pageLife, observers, emit, tick, timers }
}
const route = { name: 'route', path: '/pages/family-members/index?from=profile', duration: 350 }

test('onReady 不提前显示二级页；只有本页 route 完成信号才显示，返回不再次清空', () => {
  const { component, life, pageLife, observers, emit, timers, tick } = setup()
  life('attached'); life('ready')
  assert.equal(component.data.routeReady, false)
  assert.deepEqual([...observers[0].options.entryTypes], ['navigation'])
  emit([{ name: 'firstRender', path: route.path }, { name: 'appLaunch', path: route.path },
    { name: 'route', path: 'pages/dish-detail/index' }])
  assert.equal(component.data.routeReady, false)
  emit([route])
  assert.equal(component.data.routeReady, true)
  assert.equal(observers[0].disconnected, true)
  assert.equal(timers.size, 0)
  pageLife('hide'); pageLife('show'); tick(2000)
  assert.equal(component.data.routeReady, true)
  assert.equal(component.patches.length, 1)
  assert.equal(observers.length, 1)
})

test('动画信号早于组件 ready 时，等两者都就绪再显示', () => {
  const { component, life, emit } = setup()
  life('attached'); emit([route])
  assert.equal(component.data.routeReady, false)
  life('ready')
  assert.equal(component.data.routeReady, true)
})

test('无性能 API、观察失败或无信号时有有界兼容等待，不永久空屏', () => {
  for (const mode of ['unsupported', 'observe-error', 'supported']) {
    const { component, life, tick, observers, timers } = setup(mode)
    life('attached'); life('ready'); tick(999)
    assert.equal(component.data.routeReady, false, mode)
    tick(1)
    assert.equal(component.data.routeReady, true, mode)
    assert.equal(timers.size, 0)
    for (const observer of observers) assert.equal(observer.disconnected, true)
  }
})

test('隐藏和卸载清理等待；返回等待中的页面时迟到的旧观察回调不能提前显示', () => {
  const { component, life, pageLife, emit, tick, observers, timers } = setup()
  life('attached'); life('ready')
  const old = observers[0]
  pageLife('hide')
  assert.equal(old.disconnected, true)
  assert.equal(timers.size, 0)
  emit([route], old); tick(2000)
  assert.equal(component.data.routeReady, false)
  pageLife('show')
  emit([route], old)
  assert.equal(component.data.routeReady, false)
  emit([route])
  assert.equal(component.data.routeReady, true)
  life('detached')
  assert.equal(timers.size, 0)

  const pending = setup()
  pending.life('attached'); pending.life('ready'); pending.life('detached')
  pending.emit([route]); pending.tick(2000)
  assert.equal(pending.component.data.routeReady, false)
  assert.equal(pending.timers.size, 0)
})

test('七个二级页的正文和底部按钮统一受控，离屏分享 canvas 不受影响', () => {
  const pages = ['dish-detail', 'order-detail', 'admin-dishes', 'invite-settings', 'family-members', 'dish-edit', 'cart']
  for (const name of pages) {
    const config = JSON.parse(read(`pages/${name}/index.json`))
    assert.equal(config.usingComponents['transition-page'], '/components/transition-page/index')
    const template = read(`pages/${name}/index.wxml`).trim()
    assert(template.startsWith(`<transition-page route="pages/${name}/index">`))
    const after = template.slice(template.indexOf('</transition-page>') + '</transition-page>'.length).trim()
    if (name === 'order-detail') assert.match(after, /^<canvas[^>]*id="order-poster"[^>]*\/>$/)
    else assert.equal(after, '')
  }
  assert.match(read('components/transition-page/index.wxml'), /wx:if="\{\{routeReady\}\}"[^>]*><slot\s*\/>/)
})
