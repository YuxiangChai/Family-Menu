const test = require('node:test')
const assert = require('node:assert/strict')
const api = require('../miniprogram/utils/api')
const cart = require('../miniprogram/utils/cart')

test('当前菜单缓存来自后台，不用本地私有草稿；增删直接发集合操作', async (t) => {
  const previous = api.call
  t.after(() => { api.call = previous })
  let menu = null, calls = []
  global.wx = { getStorageSync() { throw new Error('不该读取旧草稿') } }
  api.call = async (action, event) => {
    calls.push({ action, event })
    if (action === 'getActiveMenu') return { menu, isAdmin: false }
    if (action === 'startActiveMenu') { menu ||= { menuId: 'shared', orderId: '', items: [], dinerCount: 2, remark: '' }; return { menu } }
    if (action === 'changeActiveMenu') {
      assert.equal(event.menuId, 'shared')
      menu = { ...menu, items: event.addDishIds?.length ? [{ dishId: 'egg', name: '菜' }] : [] }
      return { menu }
    }
    return { orderId: 'saved' }
  }
  await cart.refresh()
  assert.equal(cart.countCart(), 0)
  await cart.selectDish('egg', true, '')
  assert.equal(cart.countCart(), 1)
  await cart.selectDish('egg', false, 'shared')
  assert.equal(cart.countCart(), 0)
  assert.equal(calls[1].action, 'startActiveMenu')
  assert.deepEqual(calls[2].event.addDishIds, ['egg'])
  assert.deepEqual(calls[3].event.removeDishIds, ['egg'])
  assert.equal(cart.getCart()[0]?.servings, undefined)
  await cart.submit('shared')
  assert.equal(cart.getDraft().menuId, '')
})

test('旧菜单的增删不能自动创建新菜单；慢同步不覆盖操作后的结果', async (t) => {
  const previous = api.call
  t.after(() => { api.call = previous })
  let release, read = 0
  const calls = []
  api.call = async (action, event) => {
    calls.push(action)
    if (action === 'getActiveMenu') {
      if (++read === 1) return { menu: { menuId: 'old', items: [] } }
      return new Promise((resolve) => { release = resolve })
    }
    if (event.menuId === 'closed') throw Object.assign(new Error('菜单已结束'), { code: 'MENU_CLOSED' })
    return { menu: { menuId: 'old', items: [{ dishId: 'egg' }] } }
  }
  await cart.refresh()
  const pending = cart.refresh()
  await cart.selectDish('egg', true, 'old')
  release({ menu: null })
  await pending
  assert.equal(cart.countCart(), 1)
  await assert.rejects(cart.selectDish('egg', false, 'closed'), { code: 'MENU_CLOSED' })
  assert(!calls.includes('startActiveMenu'))
})
