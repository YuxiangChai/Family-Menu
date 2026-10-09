const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const poster = require('../miniprogram/utils/order-poster')
const api = require('../miniprogram/utils/api')
const cart = require('../miniprogram/utils/cart')
const { startOrderEdit } = require('../miniprogram/utils/order-edit')

const order = { _id: 'test-order', creatorName: '家人', dinerCount: 4, revision: 2, createdAt: '2026-10-08T17:30:00Z', updatedAt: '2026-10-09T06:00:00Z', items: [{ dishId: 'egg', name: '番茄炒蛋', servings: 3 }], remark: '' }
function page(name, deps = {}, wx = {}) {
  let definition
  const images = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/order-images.js'), 'utf8'), { module: images, wx })
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.js'), 'utf8'), {
    require: (value) => value.endsWith('/order-poster') ? { posterLayout: poster.posterLayout, ...deps['order-poster'] } : deps[value.split('/').at(-1)] || (value.endsWith('/stable-media') ? require('../miniprogram/utils/stable-media') : value.endsWith('/order-images') ? images.exports : undefined), wx,
    Page: (value) => { definition = value }
  })
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) { Object.assign(this.data, patch); callback?.() } }
}

test('历史订单日期与星期按北京时间显示，跨天跨年和非法日期处理正确', () => {
  const { orderDateTime } = require('../miniprogram/utils/format')
  assert.deepEqual(orderDateTime('2026-10-09T06:32:00Z'), { dateText: '2026年10月9日', weekdayText: '周五', timeText: '14:32' })
  assert.deepEqual(orderDateTime('2026-10-10T16:01:00Z'), { dateText: '2026年10月11日', weekdayText: '周日', timeText: '00:01' })
  assert.deepEqual(orderDateTime('2026-12-31T16:00:00Z'), { dateText: '2027年1月1日', weekdayText: '周五', timeText: '00:00' })
  assert.deepEqual(orderDateTime('2026-10-09T14:32:00+08:00'), orderDateTime('2026-10-09T06:32:00Z'))
  for (const value of [undefined, '', 'invalid']) assert.deepEqual(orderDateTime(value), { dateText: '日期未知', weekdayText: '', timeText: '' })
})

test('历史订单进入、分页和刷新始终请求全部历史，不受旧今日筛选影响', async () => {
  const calls = []
  const p = page('orders', {
    format: require('../miniprogram/utils/format'), reorder: {}, 'order-poster': {},
    api: { call: async (action, payload) => {
      calls.push({ action, payload })
      return { orders: [{ ...order, _id: payload.cursor ? 'second' : 'first' }], nextCursor: payload.cursor ? null : 'next-page' }
    } }
  }, { stopPullDownRefresh() {} })
  p.data.scope = 'today'
  await p.onShow()
  await p.loadMore()
  assert.equal(p.data.orders.length, 2)
  assert.equal(p.data.orders[0].dateText, '2026年10月9日')
  assert.equal(p.data.orders[0].weekdayText, '周五')
  await p.loadOrders()
  assert.equal(p.data.orders.length, 2)
  assert.equal(calls.length, 4)
  for (const call of calls) { assert.equal(call.action, 'listOrders'); assert.equal(call.payload.scope, 'history') }
  assert.equal(calls[1].payload.cursor, 'next-page')
  assert.equal(calls[2].payload.cursor, undefined)
  assert.equal(calls[3].payload.cursor, 'next-page')
  assert.equal(p.changeScope, undefined)
})

test('图片完整包含 20 道长菜名、300 字备注和北京时间，不带私有标识、版本标签或小字说明', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ name: `菜${i}` + '长菜名'.repeat(12), servings: 20 }))
  const remark = '少辣\n' + '备注'.repeat(148)
  const data = { ...order, items, remark, creatorOpenid: 'private-openid', imageFileId: 'https://private?token=secret' }
  const layout = poster.posterLayout(data)
  const text = layout.texts.map((row) => row.text).join('')
  for (const item of items) assert(text.includes(item.name))
  assert(text.includes(remark.replace(/\n/g, '')))
  assert(text.includes('2026-10-09 01:30'))
  assert(!/第\s*\d+\s*版/.test(text))
  assert(!text.includes('菜单快照'))
  assert(!/×|份/.test(text))
  assert(!JSON.stringify(layout).includes('private'))
  for (const row of layout.texts) { assert(row.y + row.size < layout.height); assert(row.x >= 48) }
  assert(layout.height > poster.posterLayout(order).height)
})

test('本地 canvas 根据全部内容设置高度，导出本地 PNG；画布缺失可重试', async () => {
  const painted = [], ctx = { scale() {}, measureText: (s) => ({ width: s.length * 22 }), fillRect() {}, fillText: (s) => painted.push(s), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }
  const canvas = { getContext: () => ctx }
  let missing = false, exported
  global.wx = { createSelectorQuery: () => {
    const query = { in() { return query }, select() { return query }, fields() { return query }, exec(cb) { cb(missing ? [] : [{ node: canvas }]) } }; return query
  }, canvasToTempFilePath: (options) => { exported = options; options.success({ tempFilePath: 'local.png' }) } }
  const result = await poster.generatePoster({}, order)
  assert.equal(result.path, 'local.png')
  assert.equal(canvas.width, 900)
  assert.equal(canvas.height, Math.ceil(result.height * 1.5))
  assert.equal(exported.fileType, 'png')
  assert(painted.join('').includes('番茄炒蛋'))
  missing = true
  await assert.rejects(poster.generatePoster({}, order), /画布未准备好/)
})

test('分享图菜名与照片垂直居中，长菜名完整换行且后续行不重叠', () => {
  for (const name of ['番茄炒蛋', '很长的菜名'.repeat(15)]) {
    const layout = poster.posterLayout({ ...order, items: [{ name }, { name: '青菜' }] })
    const box = layout.images[0]
    const rows = layout.texts.filter((row) => row.x === 168 && row.y < layout.images[1].y)
    const first = rows[0], last = rows.at(-1)
    assert.equal((first.y + last.y + last.size) / 2, box.y + box.size / 2)
    assert(rows.map((row) => row.text).join('').includes(name))
    assert(last.y + last.size < layout.images[1].y)
  }
})

test('照片按正方形居中裁切；缺图、下载失败和解码失败使用同一默认图，完整绘制全部菜', async () => {
  const loaded = [], drawn = []
  global.wx = { getImageInfo(options) {
    loaded.push(options.src)
    if (options.src === 'network-failure') return options.fail({})
    options.success({ path: options.src === '/images/dish-placeholder.png' ? 'images/dish-placeholder.png' : `wxfile://${options.src}`, width: 800, height: 600 })
  } }
  const canvas = { createImage() {
    const value = {}
    Object.defineProperty(value, 'src', { set(src) { value.source = src; src === 'wxfile://decode-failure' ? value.onerror() : value.onload() } })
    return value
  } }
  const items = [{ name: '有照片', imageFileId: 'photo' }, { name: '无照片' }, { name: '坏链接', imageFileId: 'network-failure' }, { name: '损坏文件', imageFileId: 'decode-failure' }]
  const photos = await poster.loadPhotos(canvas, items)
  assert.equal(photos[0].image.source, 'wxfile://photo')
  for (const photo of photos.slice(1)) assert.equal(photo.image.source, '/images/dish-placeholder.png')
  assert.equal(loaded.filter((src) => src === '/images/dish-placeholder.png').length, 1)
  const layout = poster.posterLayout({ ...order, items })
  const ctx = { fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, drawImage: (...args) => drawn.push(args) }
  poster.drawPoster(ctx, layout, photos)
  assert.equal(drawn.length, 4)
  assert.deepEqual(drawn[0].slice(1, 5), [100, 0, 600, 600])
  for (const box of layout.images) assert(box.y + box.size < layout.height)
})

test('图片下载卡住可超时回退，不无限等待', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  global.wx = { getImageInfo() {} }
  const pending = poster.loadPhoto({ createImage() {} }, 'slow-photo')
  t.mock.timers.tick(5001)
  assert.equal(await pending, null)
})

test('照片加载结束后版本已过期，不绘制旧图或覆盖共用 canvas', async () => {
  const canvas = { getContext: () => ({ measureText: () => ({ width: 10 }) }) }
  global.wx = { createSelectorQuery() { const q = { in() { return q }, select() { return q }, fields() { return q }, exec(cb) { cb([{ node: canvas }]) } }; return q } }
  await assert.rejects(poster.generatePoster({}, order, () => false), /已过期/)
  assert.equal(canvas.width, undefined)
})

test('订单列表 1、4、8 道菜仅摘要最多四道，分享仍获取完整最新订单且不触发下单', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ dishId: `dish-${i}`, name: `菜${i}`, servings: 1 }))
  const orders = [1, 4, 8].map((length) => ({ ...order, _id: `order-${length}`, items: many.slice(0, length) }))
  const calls = [], shared = [], generated = []
  let release
  const p = page('orders', {
    format: require('../miniprogram/utils/format'), reorder: {},
    api: { call: async (action, payload) => { calls.push({ action, payload }); return action === 'listOrders' ? { orders } : { order: orders[2] } } },
    'order-poster': { generatePoster: async (_, order) => { generated.push(order); return new Promise((resolve) => { release = resolve }) } }
  }, { showShareImageMenu: (options) => shared.push(options) })
  await p.loadOrders()
  assert.deepEqual(Array.from(p.data.orders, (v) => v.previewItems.length), [1, 4, 4])
  assert.deepEqual(Array.from(p.data.orders, (v) => v.remainingCount), [0, 0, 4])
  const event = { currentTarget: { dataset: { id: 'order-8' } } }
  const pending = p.shareOrder(event)
  await Promise.resolve()
  await p.shareOrder(event)
  assert.equal(calls.filter((v) => v.action === 'getOrder').length, 1)
  assert.equal(generated[0].items.length, 8)
  release({ path: 'full.png' }); await pending
  assert.equal(shared[0].path, 'full.png')
  assert(!calls.some((v) => /create|update/.test(v.action)))
  assert.equal(p.data.sharingId, '')
  const abandoned = p.shareOrder(event)
  await Promise.resolve(); p.onHide()
  release({ path: 'stale.png' }); await abandoned
  assert.equal(shared.length, 1)
})

test('图片分享先取最新订单，用户选择对象，不报告假发送成功；不支持时预览，取消不打扰', async () => {
  const shares = [], previews = [], toasts = []
  const wx = { showShareImageMenu: (value) => shares.push(value), previewImage: (value) => previews.push(value), showToast: (value) => toasts.push(value) }
  const p = page('order-detail', { api: { call: async () => ({ order }) }, format: require('../miniprogram/utils/format'), reorder: {}, 'order-edit': {}, 'order-poster': { generatePoster: async () => ({ path: 'latest.png' }) } }, wx)
  p.setData({ posterPath: 'local.png', posterCurrent: true }); await p.shareImage()
  assert.equal(p.data.order.dateText, '2026年10月9日')
  assert.equal(p.data.order.weekdayText, '周五')
  assert.equal(p.data.order.timeText, '01:30')
  assert.equal(shares[0].path, 'latest.png')
  assert.equal(shares[0].needShowEntrance, false)
  assert.equal(shares[0].success, undefined)
  shares[0].fail({ errMsg: 'cancel' })
  assert.equal(toasts.length, 0)
  shares[0].fail({ errMsg: 'not supported' })
  assert.equal(previews.length, 1)
  delete wx.showShareImageMenu
  await p.shareImage()
  assert.equal(previews.length, 2)
})

test('后台重新加载保留旧图片和订单，旧生成结果不能覆盖新内容', async () => {
  let release
  const p = page('order-detail', { api: { call: async () => ({ order, canEdit: true }) }, format: require('../miniprogram/utils/format'), reorder: {}, 'order-edit': {}, 'order-poster': {
    generatePoster: () => new Promise((resolve) => { release = resolve })
  } })
  p.onLoad({ id: order._id }); await p.loadOrder()
  assert.equal(p.data.order.dateText, '2026年10月9日')
  assert.equal(p.data.order.weekdayText, '周五')
  const generating = p.generateImage()
  p.generation++
  release({ path: 'stale.png' }); await generating
  assert.equal(p.data.posterPath, '')
  p.setData({ posterPath: 'old.png', generating: false })
  await p.loadOrder()
  assert.equal(p.data.posterPath, 'old.png')
  assert.equal(p.data.order._id, order._id)
})
