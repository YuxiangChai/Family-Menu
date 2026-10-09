const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Worker } = require('node:worker_threads')
const { Store } = require('../store')
const { Service } = require('../service')
const { Media } = require('../media')
const { place } = require('./helpers/shared')

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'menu-edits-')), store = new Store(dir)
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  const service = new Service(store, new Media(store, 'http://127.0.0.1:3000'))
  for (const name of ['admin', 'a', 'b']) store.saveMember({ openid: `test-${name}`, nickname: name, role: name === 'admin' ? 'admin' : 'member', enabled: true })
  const call = (who, action, event = {}) => service.dispatch(action, { openid: `test-${who}`, tokenHash: '0'.repeat(64) }, event)
  const dishId = call('admin', 'saveDish', { dish: { name: '番茄炒蛋', defaultServings: 2, ingredients: [{ name: '鸡蛋', quantity: 2, unit: '个' }] } }).dishId
  const orderId = place(call, 'a', { items: [{ dishId }], dinerCount: 2, remark: '少盐', idempotencyKey: 'create' }).orderId
  return { store, call, dishId, orderId }
}
function change(f, who, menuId, key, changes) {
  return f.call(who, 'changeActiveMenu', { menuId, idempotencyKey: key, ...changes })
}

test('旧订单缺照片时展示当前照片，不重写订单；已有照片保持快照且不受更名影响', (t) => {
  const f = fixture(t), original = f.store.get('orders', f.orderId)
  const image = f.call('admin', 'uploadDishImage', { base64: 'iVBORw0KGgo=' }).fileID
  f.call('admin', 'saveDish', { dish: { ...f.store.get('dishes', f.dishId), name: '菜品已更名', imageFileId: image } })
  const shown = f.call('b', 'getOrder', { orderId: f.orderId }).order.items[0]
  assert.equal(shown.name, '番茄炒蛋')
  assert(shown.imageFileId.includes('/media/'))
  assert.deepEqual(f.store.get('orders', f.orderId), original)
  assert(f.call('b', 'listOrders').orders[0].items[0].imageFileId.includes('/media/'))
  const pinned = { ...original, items: original.items.map((item) => ({ ...item, imageFileId: f.store.get('dishes', f.dishId).imageFileId })) }
  f.store.save('orders', pinned)
  f.call('admin', 'saveDish', { dish: { ...f.store.get('dishes', f.dishId), imageFileId: '' } })
  assert(f.call('b', 'getOrder', { orderId: f.orderId }).order.items[0].imageFileId.includes('/media/'))
  assert.deepEqual(f.store.get('orders', f.orderId), pinned)
})

test('全家只存在一个当前菜单，新点菜和修改不能另开；多人进入同一份', (t) => {
  const f = fixture(t)
  const a = f.call('a', 'startActiveMenu').menu
  assert.equal(f.call('b', 'startActiveMenu').menu.menuId, a.menuId)
  assert.throws(() => f.call('a', 'prepareOrderEdit', { orderId: f.orderId }), { code: 'ACTIVE_MENU_BUSY' })
  assert.throws(() => f.call('b', 'startActiveMenu', { sourceOrderId: f.orderId }), { code: 'ACTIVE_MENU_BUSY' })
  f.call('admin', 'cancelActiveMenu', { menuId: a.menuId })
  const edit = f.call('b', 'prepareOrderEdit', { orderId: f.orderId }).menu
  assert.equal(edit.orderId, f.orderId)
  assert.equal(f.call('a', 'startActiveMenu').menu.menuId, edit.menuId)
  assert.equal(f.call('a', 'prepareOrderEdit', { orderId: f.orderId }).menu.menuId, edit.menuId)
  const second = f.store.save('orders', { ...f.store.get('orders', f.orderId), _id: 'other-order', idempotencyKey: 'other' })
  assert.throws(() => f.call('admin', 'prepareOrderEdit', { orderId: second._id }), { code: 'ACTIVE_MENU_BUSY' })
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM family_settings WHERE id='_current-menu'").get().n, 1)
})

test('多人不同菜增删合并，重复加和重复删无操作，不计份数或版本', (t) => {
  const f = fixture(t), soup = f.call('admin', 'saveDish', { dish: { name: '汤' } }).dishId
  const { menu } = f.call('a', 'startActiveMenu')
  assert.equal(change(f, 'a', menu.menuId, 'a-add', { addDishIds: [f.dishId] }).changed, true)
  assert.equal(change(f, 'b', menu.menuId, 'b-add', { addDishIds: [f.dishId, f.dishId] }).changed, false)
  change(f, 'b', menu.menuId, 'soup', { addDishIds: [soup] })
  change(f, 'a', menu.menuId, 'remove', { removeDishIds: [f.dishId] })
  assert.equal(change(f, 'b', menu.menuId, 'remove-again', { removeDishIds: [f.dishId] }).changed, false)
  const latest = f.call('b', 'getActiveMenu').menu
  assert.deepEqual(latest.items.map((item) => item.dishId), [soup])
  assert.equal(latest.items[0].servings, undefined)
  assert.equal(latest.revision, undefined)
  assert(!JSON.stringify(latest).includes('test-a'))
})

test('修改只更新共享草稿，提交覆盖原订单，任何启用成员可参与且身份保持', (t) => {
  const f = fixture(t), original = f.store.get('orders', f.orderId)
  const { menu } = f.call('b', 'prepareOrderEdit', { orderId: f.orderId })
  change(f, 'b', menu.menuId, 'details', { dinerCount: 6, remark: '不要辣', creatorOpenid: 'attacker' })
  assert.deepEqual(f.store.get('orders', f.orderId), original)
  const result = f.call('a', 'submitActiveMenu', { menuId: menu.menuId })
  assert.equal(result.orderId, f.orderId)
  const saved = f.store.get('orders', f.orderId)
  for (const key of ['_id', 'createdAt', 'creatorOpenid', 'creatorName', 'orderDate', 'idempotencyKey']) assert.equal(saved[key], original[key])
  assert.equal(saved.ingredientSummary[0].quantity, 2)
  assert.equal(saved.dinerCount, 6)
  assert.equal(saved.remark, '不要辣')
  const visible = f.call('b', 'getOrder', { orderId: f.orderId }).order
  assert.equal(visible.revision, undefined)
  assert.equal(visible.canEdit, true)
  assert(!JSON.stringify(visible).includes('test-a'))
  assert.equal(f.store.all('orders').length, 1)
  assert.equal(f.call('a', 'getActiveMenu').menu, null)
})

test('多人重复提交同一菜单，只保存一个结果，迟到操作不能改下一餐', (t) => {
  const f = fixture(t), { menu } = f.call('a', 'startActiveMenu')
  change(f, 'a', menu.menuId, 'add', { addDishIds: [f.dishId] })
  const first = f.call('a', 'submitActiveMenu', { menuId: menu.menuId })
  const second = f.call('b', 'submitActiveMenu', { menuId: menu.menuId })
  assert.equal(second.orderId, first.orderId)
  assert.equal(second.duplicated, true)
  assert.equal(f.store.all('orders').length, 2)
  const next = f.call('b', 'startActiveMenu').menu
  assert.notEqual(next.menuId, menu.menuId)
  assert.throws(() => change(f, 'a', menu.menuId, 'late', { addDishIds: [f.dishId] }), { code: 'MENU_CLOSED' })
  assert.throws(() => f.call('admin', 'cancelActiveMenu', { menuId: menu.menuId }), { code: 'MENU_CLOSED' })
  assert.equal(f.call('a', 'submitActiveMenu', { menuId: menu.menuId }).orderId, first.orderId)
  assert.equal(f.call('a', 'getActiveMenu').menu.items.length, 0)
})

test('重试凭证跨中间操作和重启去重，不会复活已移除的菜', (t) => {
  const f = fixture(t), { menu } = f.call('a', 'startActiveMenu')
  const add = { addDishIds: [f.dishId] }
  change(f, 'a', menu.menuId, 'add', add)
  change(f, 'b', menu.menuId, 'remove', { removeDishIds: [f.dishId] })
  const second = new Store(f.store.dataDir)
  try {
    const service = new Service(second, new Media(second, 'http://127.0.0.1:3000'))
    const result = service.dispatch('changeActiveMenu', { openid: 'test-a' }, { menuId: menu.menuId, idempotencyKey: 'add', ...add })
    assert.equal(result.duplicated, true)
    assert.equal(result.menu.items.length, 0)
  } finally { second.close() }
})

test('不允许旧独立订单接口、整单覆盖和非法输入，失败事务不改当前菜单', (t) => {
  const f = fixture(t), { menu } = f.call('a', 'startActiveMenu')
  for (const action of ['createOrder', 'updateOrder', 'updateOrderStatus', 'recordSubscription', 'listNotifications']) assert.throws(() => f.call('a', action), { code: 'BAD_REQUEST' })
  for (const value of [{ items: [] }, { addDishIds: null }, { addDishIds: [f.dishId], removeDishIds: [f.dishId] }, { addDishIds: [''] }, { addDishIds: ['missing'] }, { dinerCount: 0 }, { addDishIds: Array(21).fill(f.dishId) }]) {
    assert.throws(() => change(f, 'a', menu.menuId, 'bad', value), { code: 'BAD_REQUEST' })
    assert.deepEqual(f.call('b', 'getActiveMenu').menu, menu)
  }
  assert.throws(() => f.call('a', 'submitActiveMenu', { menuId: menu.menuId }), { code: 'BAD_REQUEST' })
  assert.throws(() => f.call('b', 'cancelActiveMenu', { menuId: menu.menuId }), { code: 'FORBIDDEN' })
  for (const table of ['notifications', 'notification_outbox']) assert.equal(f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0)
})

test('最多20道菜，失败事务释放锁；相反增删按数据库执行顺序生效', (t) => {
  const f = fixture(t), { menu } = f.call('a', 'startActiveMenu')
  const ids = Array.from({ length: 20 }, (_, i) => f.call('admin', 'saveDish', { dish: { name: `菜${i}` } }).dishId)
  change(f, 'a', menu.menuId, 'twenty', { addDishIds: ids })
  assert.throws(() => change(f, 'b', menu.menuId, 'overflow', { addDishIds: [f.dishId] }), { code: 'BAD_REQUEST' })
  assert.equal(f.call('a', 'getActiveMenu').menu.items.length, 20)
  change(f, 'a', menu.menuId, 'remove', { removeDishIds: [ids[0]] })
  change(f, 'b', menu.menuId, 'overflow', { addDishIds: [f.dishId] })
  change(f, 'a', menu.menuId, 'undo', { removeDishIds: [f.dishId] })
  change(f, 'b', menu.menuId, 'again', { addDishIds: [f.dishId] })
  assert(f.call('a', 'getActiveMenu').menu.items.some((item) => item.dishId === f.dishId))
  assert.equal(f.store.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})

test('已有下架菜可保留、删除，原快照保留，不准新加下架菜', (t) => {
  const f = fixture(t)
  f.call('admin', 'saveDish', { dish: { _id: f.dishId, name: '改名', ingredients: [] } })
  f.call('admin', 'toggleDish', { dishId: f.dishId, enabled: false })
  const { menu } = f.call('b', 'prepareOrderEdit', { orderId: f.orderId })
  assert.equal(menu.items[0].name, '番茄炒蛋')
  assert.equal(change(f, 'a', menu.menuId, 'keep', { addDishIds: [f.dishId] }).changed, false)
  change(f, 'b', menu.menuId, 'remove', { removeDishIds: [f.dishId] })
  assert.throws(() => change(f, 'a', menu.menuId, 'add-disabled', { addDishIds: [f.dishId] }), { code: 'BAD_REQUEST' })
  f.call('a', 'submitActiveMenu', { menuId: menu.menuId })
  assert.deepEqual(f.store.get('orders', f.orderId).items, [])
})

test('旧份数与版本读时不重写；修改提交后去掉，旧状态和记录保留', (t) => {
  const f = fixture(t), old = f.store.get('orders', f.orderId)
  old.revision = 5; old.items[0].servings = 8; old.items[0].defaultServings = 2
  f.store.save('orders', { ...old, status: 'pending' })
  const visible = f.call('b', 'getOrder', { orderId: f.orderId }).order
  assert.equal(visible.items[0].servings, undefined)
  assert.equal(visible.ingredientSummary[0].quantity, 2)
  assert.equal(f.store.get('orders', f.orderId).revision, 5)
  const { menu } = f.call('b', 'prepareOrderEdit', { orderId: f.orderId })
  change(f, 'b', menu.menuId, 'legacy', { remark: '新备注' })
  f.call('a', 'submitActiveMenu', { menuId: menu.menuId })
  const second = new Store(f.store.dataDir)
  try {
    assert.equal(second.get('orders', f.orderId).revision, undefined)
    assert.equal(second.get('orders', f.orderId).items[0].servings, undefined)
    assert.equal(second.get('orders', f.orderId).status, 'pending')
    assert.equal(second.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally { second.close() }
})

async function concurrent(f, jobs) {
  const signal = new SharedArrayBuffer(4), control = new Int32Array(signal)
  let ready = 0
  return Promise.all(jobs.map((job) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads')
      const { Store } = require(workerData.root + '/store')
      const { Service } = require(workerData.root + '/service')
      const { Media } = require(workerData.root + '/media')
      const store = new Store(workerData.dataDir)
      const service = new Service(store, new Media(store, 'http://127.0.0.1:3000'))
      const signal = new Int32Array(workerData.signal)
      parentPort.postMessage({ ready: true })
      Atomics.wait(signal, 0, 0)
      try { parentPort.postMessage({ result: service.dispatch(workerData.job.action, { openid: 'test-' + workerData.job.who }, workerData.job.event || {}) }) }
      catch (error) { throw error }
      finally { store.close() }
    `, { eval: true, workerData: { root: path.join(__dirname, '..'), dataDir: f.store.dataDir, signal, job } })
    worker.on('error', reject)
    worker.on('message', (message) => {
      if (message.ready) { if (++ready === jobs.length) { Atomics.store(control, 0, 1); Atomics.notify(control, 0) } }
      else resolve(message.result)
    })
  })))
}

test('真实多个 SQLite 写连接并发创建、增菜、重复提交，短事务锁保证唯一和合并', async (t) => {
  const f = fixture(t)
  const [a, b] = await concurrent(f, ['a', 'b'].map((who) => ({ who, action: 'startActiveMenu' })))
  assert.equal(a.menu.menuId, b.menu.menuId)
  const soup = f.call('admin', 'saveDish', { dish: { name: '汤' } }).dishId
  const results = await concurrent(f, [
    { who: 'a', action: 'changeActiveMenu', event: { menuId: a.menu.menuId, idempotencyKey: 'a', addDishIds: [f.dishId] } },
    { who: 'b', action: 'changeActiveMenu', event: { menuId: a.menu.menuId, idempotencyKey: 'b', addDishIds: [soup, f.dishId] } }
  ])
  assert.equal(results.length, 2)
  assert.deepEqual(new Set(f.call('a', 'getActiveMenu').menu.items.map((item) => item.dishId)), new Set([soup, f.dishId]))
  const submitted = await concurrent(f, ['a', 'b'].map((who) => ({ who, action: 'submitActiveMenu', event: { menuId: a.menu.menuId } })))
  assert.equal(submitted[0].orderId, submitted[1].orderId)
  assert.equal(submitted.filter((result) => result.duplicated).length, 1)
  assert.equal(f.store.all('orders').length, 2)
})
