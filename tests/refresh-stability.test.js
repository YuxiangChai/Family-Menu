const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const format = require('../miniprogram/utils/format')
const poster = require('../miniprogram/utils/order-poster')
const order = { _id: 'a', creatorName: '家人', dinerCount: 2, createdAt: '2026-10-09T06:00:00Z', items: [{ dishId: 'egg', name: '番茄炒蛋' }] }
const clone = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
function load(name, deps = {}, wx = {}) {
  let definition
  const app = { globalData: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${name}/index.js`), 'utf8'), {
    Page: (value) => { definition = value }, getApp: () => app, wx, setInterval: () => 1, clearInterval() {},
    require: (value) => ({ format, 'stable-media': require('../miniprogram/utils/stable-media'), 'order-poster': poster, 'order-images': { sharePoster() {} }, reorder: {}, 'order-edit': {}, ...deps })[value.split('/').at(-1)]
  })
  return { ...definition, data: clone(definition.data), patches: [], app,
    setData(patch, callback) {
      this.patches.push(clone(patch))
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = this.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts.at(-1)] = value
      }
      callback?.()
    }
  }
}

test('历史列表后台慢刷新保留两页内容和游标，全部响应后一次替换；失败不清空', async () => {
  const first = deferred(), second = deferred(), calls = []
  let failure = false
  const p = load('orders', { api: { call: (action, args) => {
    calls.push(args)
    if (failure) return Promise.reject(new Error('网络故障'))
    return args.cursor ? second.promise : first.promise
  } } })
  p.loaded = true; p.pagesLoaded = 2
  p.setData({ loading: false, orders: [order, { ...order, _id: 'b' }], nextCursor: 'third' })
  const pending = p.onShow()
  assert.equal(p.data.loading, false)
  assert.equal(p.data.orders.length, 2)
  assert.equal(p.data.nextCursor, 'third')
  await p.loadMore()
  assert.equal(calls.length, 1)
  first.resolve({ orders: [{ ...order, creatorName: '新称呼' }], nextCursor: 'second' }); await flush()
  assert.equal(p.data.orders[0].creatorName, '家人')
  assert.equal(p.data.orders.length, 2)
  second.resolve({ orders: [{ ...order, _id: 'b' }], nextCursor: 'third' }); await pending
  assert.equal(p.data.orders.length, 2)
  assert.equal(p.data.orders[0].creatorName, '新称呼')
  failure = true; await p.loadOrders()
  assert.equal(p.data.orders.length, 2)
  assert.equal(p.data.error, '网络故障')
})

test('详情返回重新验证权限但保留图片；内容未变不重新生成，改变时保留原图与高度', async () => {
  let response = { order, canEdit: true }, request, image, draws = 0, shares = 0
  const p = load('order-detail', {
    api: { call: () => request ? request.promise : Promise.resolve(response) },
    'order-images': { sharePoster: () => shares++ },
    'order-poster': { posterLayout: poster.posterLayout, generatePoster: () => { draws++; return image ? image.promise : Promise.resolve({ path: 'old.png', width: 600, height: 480 }) } }
  })
  p.onLoad({ id: 'a' }); await p.loadOrder(); await p.generateImage()
  p.ready = true
  const oldAspect = p.data.posterAspect
  request = deferred()
  const refresh = p.onShow()
  assert.equal(p.data.loading, false)
  assert.equal(p.data.posterPath, 'old.png')
  assert.equal(p.data.canEdit, true)
  assert.equal(p.data.posterAspect, oldAspect)
  await p.shareImage(); assert.equal(shares, 0)
  request.resolve(response); await refresh
  assert.equal(draws, 1)
  request = null; image = deferred()
  response = { order: { ...order, items: [...order.items, { dishId: 'soup', name: '汤' }] }, canEdit: true }
  await p.loadOrder()
  assert.equal(draws, 2)
  assert.equal(p.data.posterPath, 'old.png')
  assert.equal(p.data.posterAspect, oldAspect)
  assert.equal(p.data.posterCurrent, false)
  await p.shareImage(); assert.equal(shares, 0)
  image.resolve({ path: 'new.png', width: 600, height: 600 }); await flush()
  assert.equal(p.data.posterPath, 'new.png')
  assert.equal(p.data.posterAspect, 100)
  assert.equal(p.data.posterCurrent, true)
})

test('详情后台网络失败保留内容，图片生成失败保留旧图但不可分享，迟到图片不覆盖新内容', async () => {
  let failure, image = deferred(), shares = 0
  const p = load('order-detail', { api: { call: async () => { if (failure) throw failure; return { order, canEdit: true } } },
    'order-images': { sharePoster: () => shares++ }, 'order-poster': { posterLayout: poster.posterLayout, generatePoster: () => image.promise } })
  p.onLoad({ id: 'a' }); await p.loadOrder()
  p.setData({ posterPath: 'old.png', posterCurrent: true })
  failure = new Error('网络故障'); await p.loadOrder()
  assert.equal(p.data.order._id, 'a'); assert.equal(p.data.posterPath, 'old.png')
  await p.shareImage(); assert.equal(shares, 0)
  const generating = p.generateImage()
  image.reject(new Error('生成失败')); await generating
  assert.equal(p.data.posterPath, 'old.png'); assert.equal(p.data.posterCurrent, false)
  image = deferred()
  const stale = p.generateImage(); p.onHide()
  image.resolve({ path: 'stale.png' }); await stale
  assert.equal(p.data.posterPath, 'old.png')
})

test('后台刷新遇到停用或权限失效必须清空私人缓存，不以防闪动为由保留', async () => {
  const denied = Object.assign(new Error('账号已停用'), { code: 'ACCOUNT_DISABLED' })
  const deps = { api: { call: async () => { throw denied } } }
  const detail = load('order-detail', deps)
  detail.setData({ order, posterPath: 'private.png', loading: false, canEdit: true }); await detail.loadOrder()
  assert.equal(detail.data.order, null); assert.equal(detail.data.posterPath, ''); assert.equal(detail.data.canEdit, false)
  const history = load('orders', deps)
  history.loaded = true; history.setData({ orders: [order], loading: false }); await history.loadOrders()
  assert.equal(history.data.orders.length, 0)
  const profile = load('profile', deps)
  profile.setData({ profile: { authorized: true }, loading: false }); await profile.loadProfile()
  assert.equal(profile.data.profile, null)
  const admin = load('admin-dishes', deps)
  admin.loaded = true; admin.setData({ dishes: [{ _id: 'egg' }], loading: false }); await admin.loadDishes()
  assert.equal(admin.data.dishes.length, 0)
})

test('首页同步无变化不发 setData，选菜仅更新状态路径，不替换照片和整个分组', () => {
  let items = []
  const p = load('index', { cart: { getDraft: () => ({ menuId: 'shared', editOrderId: '' }), getCart: () => items, countCart: () => items.length } })
  p.setData({ dishes: [{ _id: 'egg', name: '番茄炒蛋', categoryId: 'home' }], categories: [{ _id: 'home' }] })
  p.applyFilters(); p.applyActive(); p.patches = []
  p.applyActive(); p.applyFilters()
  assert.equal(p.patches.length, 0)
  items = [{ dishId: 'egg' }]; p.applyActive()
  assert.equal(p.data.sections[0].dishes[0].selected, true)
  assert.equal(p.patches.length, 1)
  assert.equal(p.patches[0]['sections[0].dishes[0].selected'], true)
  assert(!('sections' in p.patches[0])); assert(!('visibleDishes' in p.patches[0]))
})

test('首页下拉更新与个人页返回在慢网络下保留内容，失败仍可查看并明确提示', async () => {
  let failure, request = deferred()
  const home = load('index', { api: { call: async (action) => {
    if (failure) throw failure
    return action === 'getProfile' ? request.promise : { dishes: [{ _id: 'egg', name: '番茄炒蛋', categoryId: 'home' }], categories: [{ _id: 'home' }] }
  } }, cart: { getCart: () => [], refresh: async () => {} } })
  home.menuLoaded = true; home.syncing = true
  home.setData({ loading: false, dishes: [{ _id: 'egg' }] })
  const pending = home.loadMenu()
  assert.equal(home.data.loading, false); assert.equal(home.data.dishes.length, 1)
  request.resolve({ authorized: true }); await pending
  assert.equal(home.data.sections.length, 1)
  failure = new Error('网络故障'); await home.loadMenu()
  assert.equal(home.data.sections.length, 1); assert.equal(home.data.menuRefreshError, '网络故障')
  request = deferred()
  const profile = load('profile', { api: { call: () => request.promise } })
  profile.setData({ loading: false, profile: { authorized: true } })
  const refreshing = profile.onShow()
  assert.equal(profile.data.loading, false); assert.equal(profile.data.profile.authorized, true)
  request.reject(new Error('网络故障')); await refreshing
  assert.equal(profile.data.profile.authorized, true); assert.equal(profile.data.error, '网络故障')
})

test('首次未加入家庭时不先同步受保护菜单，邀请码加入页面仍正常显示', async () => {
  const request = deferred()
  let syncs = 0
  const p = load('index', { api: { call: () => request.promise }, cart: { refresh: async () => { syncs++; throw Object.assign(new Error('未加入家庭'), { code: 'UNAUTHORIZED' }) } } })
  p.visible = true
  const pending = p.loadMenu()
  await p.refreshActive()
  assert.equal(syncs, 0)
  request.resolve({ authorized: false }); await pending
  assert.equal(p.data.unauthorized, true)
  assert.equal(p.data.error, '')
  assert.equal(p.data.loading, false)
})

test('当前菜单轮询相同内容不更新视图，也不覆盖正在编辑的字段', async () => {
  const p = load('cart', { cart: { refresh: async () => {}, getCart: () => [{ dishId: 'egg' }], getDraft: () => ({ menuId: 'shared', dinerCount: 2, remark: '', editOrderId: '', isAdmin: false }) } })
  p.visible = true
  await p.refreshMenu(); p.patches = []
  await p.refreshMenu()
  assert.equal(p.patches.length, 0)
})

test('同一照片有效签名链接复用，过期、换照片、换会话或普通远程链接不得误复用', () => {
  const { reuseMediaUrl, imageKey, stablePictures } = require('../miniprogram/utils/stable-media')
  const url = (file, session, expires) => `http://127.0.0.1:3000/media/${file}.png?s=${session.repeat(64)}&e=${expires}&sig=${'f'.repeat(64)}`
  const file = '11111111-1111-1111-1111-111111111111'
  const old = url(file, 'a', Date.now() + 3600000), next = url(file, 'a', Date.now() + 7200000)
  assert.equal(reuseMediaUrl(next, old), old)
  assert.equal(imageKey(next), imageKey(old))
  for (const changed of [url('22222222-2222-2222-2222-222222222222', 'a', Date.now() + 7200000), url(file, 'b', Date.now() + 7200000), 'https://example.com/image?id=2']) assert.equal(reuseMediaUrl(changed, old), changed)
  assert.equal(reuseMediaUrl(next, url(file, 'a', Date.now() + 5000)), next)
  assert.equal(reuseMediaUrl('https://example.com/image?id=2', 'https://example.com/image?id=1'), 'https://example.com/image?id=2')
  assert.equal(stablePictures([{ dishId: 'egg', imageFileId: next }], [{ dishId: 'egg', imageFileId: old }])[0].imageFileId, old)
})

test('仅图片签名变化不重复生成详情分享图，换照片必须生成新图', async () => {
  const file = '11111111-1111-1111-1111-111111111111'
  const source = (file, expires) => `http://127.0.0.1:3000/media/${file}.png?s=${'a'.repeat(64)}&e=${expires}&sig=${'b'.repeat(64)}`
  let picture = source(file, Date.now() + 3600000), draws = 0
  const p = load('order-detail', { api: { call: async () => ({ order: { ...order, items: [{ ...order.items[0], imageFileId: picture }] }, canEdit: true }) },
    'order-poster': { posterLayout: poster.posterLayout, generatePoster: async () => { draws++; return { path: `poster-${draws}.png` } } } })
  await p.loadOrder(); await p.generateImage(); p.ready = true
  picture = source(file, Date.now() + 7200000); await p.loadOrder(); await flush()
  assert.equal(draws, 1)
  picture = source('22222222-2222-2222-2222-222222222222', Date.now() + 7200000); await p.loadOrder(); await flush()
  assert.equal(draws, 2)
  assert.equal(p.data.posterPath, 'poster-2.png')
})

test('分享图预留宽高比例，生成中不移除已有 image，全局页面不叠加整屏高度', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '../miniprogram', file), 'utf8')
  const template = read('pages/order-detail/index.wxml')
  assert.match(template, /class="poster-frame" style="padding-top: \{\{posterAspect\}\}%;"/)
  assert.match(template, /<image wx:if="\{\{posterPath\}\}"[\s\S]*?<view wx:elif="\{\{generating\}\}"/)
  assert.match(template, /disabled="\{\{[^}]*posterCurrent[^}]*refreshing[^}]*\}\}"/)
  assert.match(read('app.wxss'), /\.page\s*\{\s*min-height: 0;/)
  assert(!/\.button-pressed\s*\{[^}]*transform/.test(read('app.wxss')))
})
