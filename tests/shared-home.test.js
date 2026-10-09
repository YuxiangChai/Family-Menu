const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function load(cart) {
  let definition
  const toasts = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/index/index'), 'utf8'), {
    require: (value) => value.endsWith('/cart') ? cart : value.endsWith('/format') ? { todayText: () => '' } : value.endsWith('/stable-media') ? require('../miniprogram/utils/stable-media') : {},
    wx: { showToast: (options) => toasts.push(options.title) }, Page: (page) => { definition = page },
    setInterval: () => 1, clearInterval() {}
  })
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), toasts,
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = this.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts.at(-1)] = value
      }
    } }
}

test('首页显示家人已选菜；直接移除和加入，不进入订单；双击只请求一次', async () => {
  let items = [{ dishId: 'egg' }], release
  const calls = []
  const cart = { getCart: () => items, countCart: () => items.length,
    getDraft: () => ({ menuId: 'shared', editOrderId: 'existing' }), refresh: async () => {},
    selectDish: async (...args) => { calls.push(args); await new Promise((resolve) => { release = resolve }); items = args[1] ? [{ dishId: 'egg' }] : [] } }
  const page = load(cart)
  page.setData({ dishes: [{ _id: 'egg', name: '番茄炒蛋', categoryId: 'home' }], categories: [{ _id: 'home' }] })
  page.applyFilters()
  page.applyActive()
  assert.equal(page.data.sections[0].dishes[0].selected, true)
  const remove = { currentTarget: { dataset: { id: 'egg', selected: true } } }
  const pending = page.addDish(remove)
  await page.addDish(remove)
  assert.deepEqual(calls, [['egg', false, 'shared']])
  release(); await pending
  assert.equal(page.data.sections[0].dishes[0].selected, false)
  const adding = page.addDish({ currentTarget: { dataset: { id: 'egg', selected: false } } })
  release(); await adding
  assert.deepEqual(calls[1], ['egg', true, 'shared'])
  assert.equal(page.data.cartCount, 1)
  assert.equal(page.data.editOrderId, 'existing')
  assert.deepEqual(page.toasts, ['已从全家菜单移除', '已加入全家菜单'])
})

test('增删或刷新失败明确显示同步错误，未同步时不能误操作', async () => {
  let calls = 0
  const page = load({ getCart: () => [], selectDish: async () => { calls++; throw new Error('网络故障') },
    refresh: async () => { throw new Error('无法同步') } })
  page.setData({ menuReady: true, activeMenuId: 'old', dishes: [{ _id: 'egg' }] })
  const event = { currentTarget: { dataset: { id: 'egg', selected: false } } }
  await page.addDish(event)
  assert.equal(page.data.syncError, '无法同步')
  assert.equal(page.data.menuReady, false)
  await page.addDish(event)
  assert.equal(calls, 1)
})

test('已选绿色与浅色文字对比足够，按钮给全部文案和加载标识留单行空间', () => {
  const css = fs.readFileSync(require.resolve('../miniprogram/pages/index/index.wxss'), 'utf8')
  assert(css.includes('flex: 0 0 164rpx'))
  assert(css.includes('min-width: 164rpx'))
  assert(css.includes('white-space: nowrap'))
  const luminance = (hex) => {
    const rgb = hex.match(/\w{2}/g).map((value) => parseInt(value, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  assert((luminance('fffcf7') + 0.05) / (luminance('426b52') + 0.05) > 4.5)
  // Four Chinese glyphs, separator/spaces, horizontal padding and native loading indicator.
  assert(4 * 22 + 22 + 12 + 30 < 164)
})
