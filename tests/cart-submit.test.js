const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
function load(cart, wx = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/cart/index'), 'utf8'), {
    require: () => cart, wx, Page: (page) => { definition = page }, setInterval: () => 1, clearInterval() {}
  })
  return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
}
test('提交共享菜单只带 menuId；失败保留，重试同菜单，双击不重复', async () => {
  let failure = true, calls = [], route
  const cart = { submit: async (menuId) => { calls.push(menuId); if (failure) throw new Error('网络故障'); return { orderId: 'saved' } } }
  const page = load(cart, { redirectTo: (options) => { route = options.url } })
  page.setData({ menuId: 'shared', items: [{ dishId: 'egg' }] })
  await page.submitOrder()
  assert.equal(page.data.error, '网络故障')
  failure = false
  await Promise.all([page.submitOrder(), page.submitOrder()])
  assert.deepEqual(calls, ['shared', 'shared'])
  assert.equal(route, '/pages/order-detail/index?id=saved&poster=1')
})
test('人数备注只提交实际编辑字段；同步菜集合时不覆盖本地正在输入的备注', async () => {
  const changes = []
  const cart = { refresh: async () => {}, getCart: () => [{ dishId: 'soup' }], getDraft: () => ({ menuId: 'shared', dinerCount: 4, remark: '家人改的', editOrderId: '' }),
    change: async (menuId, value) => { changes.push({ menuId, value }) } }
  const page = load(cart)
  page.visible = true; page.setData({ menuId: 'shared', remark: '我的输入' }); page.dirtyRemark = true
  await page.refreshMenu()
  assert.equal(page.data.remark, '我的输入')
  assert.equal(page.data.dinerCount, 4)
  await page.saveDetails()
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{ menuId: 'shared', value: { remark: '我的输入' } }])
  assert.equal(page.dirtyRemark, false)
})
test('首页移除通过 dishId，不靠过期列表下标；失效菜单切换不携带旧输入', async () => {
  const mutations = []
  const cart = { selectDish: async (...args) => mutations.push(args), getCart: () => [], refresh: async () => {},
    getDraft: () => ({ menuId: 'next', dinerCount: 2, remark: '', editOrderId: '' }) }
  const page = load(cart)
  page.visible = true
  page.setData({ menuId: 'old', remark: '旧输入' }); page.dirtyRemark = true
  await page.removeItem({ currentTarget: { dataset: { id: 'egg' } } })
  assert.deepEqual(mutations, [['egg', false, 'old']])
  await page.refreshMenu()
  assert.equal(page.data.remark, '')
  assert.equal(page.data.menuId, 'next')
})
