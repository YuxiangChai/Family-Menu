const test = require('node:test')
const assert = require('node:assert/strict')
const api = require('../miniprogram/utils/api')
const cart = require('../miniprogram/utils/cart')
const { reorder } = require('../miniprogram/utils/reorder')
const { startOrderEdit } = require('../miniprogram/utils/order-edit')

function setup(t) {
  const previous = api.call, previousStart = cart.start
  t.after(() => { api.call = previous; cart.start = previousStart })
  const calls = [], routes = [], prompts = []
  let draft = { items: [{ dishId: 'egg' }], unavailable: [], dinerCount: 2, remark: '' }
  api.call = async (action) => { calls.push(action); return draft }
  global.wx = { showToast() {}, navigateTo: (options) => routes.push(options.url), switchTab: (options) => routes.push(options.url),
    showModal: (options) => { prompts.push(options); options.success({ confirm: true }) } }
  cart.start = async (options) => { calls.push(options); return { menuId: 'shared' } }
  return { calls, routes, prompts, setDraft(value) { draft = value } }
}
test('再点一次确认后加入唯一共享菜单，不私建草稿或直接下单', async (t) => {
  const f = setup(t)
  assert.equal(await reorder('order'), true)
  assert.deepEqual(f.calls, ['prepareReorder', { sourceOrderId: 'order' }])
  assert.deepEqual(f.routes, ['/pages/index/index'])
  assert.match(f.prompts[0].content, /不会替换已有菜单/)
})
test('复制遇到家人正在点菜，不替换；提供当前菜单入口', async (t) => {
  const f = setup(t)
  cart.start = async () => { throw Object.assign(new Error('busy'), { code: 'ACTIVE_MENU_BUSY' }) }
  assert.equal(await reorder('order'), false)
  assert.deepEqual(f.routes, ['/pages/cart/index'])
  assert.equal(f.prompts[1].title, '家里已有当前菜单')
})
test('全部下架不启动菜单，部分下架提示，取消无写入', async (t) => {
  const f = setup(t)
  f.setDraft({ items: [], unavailable: ['旧菜'] })
  assert.equal(await reorder('order'), false)
  f.setDraft({ items: [{ dishId: 'egg' }], unavailable: ['旧菜'] })
  global.wx.showModal = (options) => { f.prompts.push(options); options.success({ confirm: false }) }
  assert.equal(await reorder('order'), false)
  assert.match(f.prompts[0].content, /已跳过下架菜：旧菜/)
  assert.equal(f.calls.length, 2)
})
test('订单编辑加入共享菜单，不覆盖另一份正在点菜的菜单', async (t) => {
  const f = setup(t)
  assert.equal(await startOrderEdit('order'), true)
  assert.deepEqual(f.calls, [{ orderId: 'order' }])
  cart.start = async () => { throw Object.assign(new Error('busy'), { code: 'ACTIVE_MENU_BUSY' }) }
  assert.equal(await startOrderEdit('other'), false)
  assert.match(f.prompts[0].content, /先完成这份共享菜单/)
})
