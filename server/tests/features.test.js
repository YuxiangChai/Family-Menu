const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { Store } = require('../store')
const { Service, chinaDate } = require('../service')
const { Media } = require('../media')
const { place } = require('./helpers/shared')
const { Notifications, readNotificationConfig, templateData } = require('../notifications')

function fixture(t, options = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'family-menu-features-'))
  const store = new Store(dataDir)
  const config = { appId: 'test-app', appSecret: 'fake-secret', notifications: readNotificationConfig({
    WX_ORDER_TEMPLATE_ID: 'test-template', WX_ORDER_TEMPLATE_FIELDS: '{"thing1":"creatorName","thing2":"dishNames","time3":"createdAt","number4":"dinerCount"}', WX_MESSAGE_STATE: 'developer'
  }) }
  const sent = []
  const notifications = new Notifications(store, config, options.transport || (async (payload) => { sent.push(payload); return { errcode: 0 } }))
  const service = new Service(store, new Media(store, 'http://127.0.0.1:3000'), notifications)
  t.after(() => { notifications.stop(); store.close(); rmSync(dataDir, { recursive: true, force: true }) })
  const identities = Object.fromEntries(['admin', 'a', 'b', 'late'].map((name) => [name, { openid: `test-${name}-openid`, tokenHash: '0'.repeat(64) }]))
  for (const name of ['admin', 'a', 'b']) store.saveMember({ openid: identities[name].openid, nickname: name, enabled: true, role: name === 'admin' ? 'admin' : 'member' })
  const call = (who, action, event = {}) => service.dispatch(action, identities[who], event)
  const dishId = call('admin', 'saveDish', { dish: { name: '番茄炒蛋' } }).dishId
  const order = (key = 'test-order') => place(call, 'a', { items: [{ dishId }], dinerCount: 4, remark: '少盐', idempotencyKey: key })
  return { store, config, service, notifications, call, sent, identities, dishId, order }
}

test('所有启用成员可分页查看全家历史和指定当天', (t) => {
  const f = fixture(t)
  for (let i = 0; i < 5; i++) {
    const id = f.order(`order-${i}`).orderId
    const value = f.store.get('orders', id)
    value.createdAt = `2026-10-0${i + 1}T06:00:00.000Z`
    value.orderDate = i === 4 ? chinaDate() : `2026-10-0${i + 1}`
    f.store.db.prepare('UPDATE orders SET data=?, order_date=? WHERE id=?').run(JSON.stringify(value), value.orderDate, id)
  }
  const all = [], cursors = []
  let cursor
  do {
    const page = f.call('admin', 'listOrders', { limit: 2, cursor })
    all.push(...page.orders.map((order) => order._id))
    cursor = page.nextCursor
    if (cursor) cursors.push(cursor)
  } while (cursor)
  assert.equal(all.length, 5)
  assert.equal(new Set(all).size, 5)
  assert.equal(f.call('admin', 'listOrders', { scope: 'today' }).orders.length, 1)
  assert.equal(f.call('a', 'listOrders').orders.length, 5)
  assert.equal(f.call('b', 'listOrders').orders.length, 5)
  assert.equal(f.call('b', 'listOrders', { scope: 'today' }).orders.length, 1)
  assert.equal(f.call('b', 'listOrders', { cursor: cursors[0] }).orders.length, 3)
  assert.throws(() => f.call('admin', 'listOrders', { cursor: 'invalid' }), { code: 'BAD_REQUEST' })
  assert.throws(() => f.call('admin', 'listOrders', { limit: 51 }), { code: 'BAD_REQUEST' })
})

test('再点一次返回最新菜品、人数备注，不含份数，跳过下架菜，不创建新订单', (t) => {
  const f = fixture(t)
  const second = f.call('admin', 'saveDish', { dish: { name: '汤' } }).dishId
  const orderId = place(f.call, 'a', { items: [{ dishId: f.dishId }, { dishId: second }], dinerCount: 4, remark: '少盐', idempotencyKey: 'copy' }).orderId
  f.call('admin', 'saveDish', { dish: { _id: f.dishId, name: '改名后的菜' } })
  f.call('admin', 'toggleDish', { dishId: second, enabled: false })
  const draft = f.call('a', 'prepareReorder', { orderId })
  assert.equal(draft.items.length, 1)
  assert.equal(draft.items[0].name, '改名后的菜')
  assert.equal(draft.items[0].servings, undefined)
  assert.equal(draft.dinerCount, 4)
  assert.equal(draft.remark, '少盐')
  assert.deepEqual(draft.unavailable, ['汤'])
  assert.equal(f.store.all('orders').length, 1)
  assert.equal(f.call('a', 'getOrder', { orderId }).order.items[0].name, '番茄炒蛋')
  assert.throws(() => f.call('late', 'prepareReorder', { orderId }), { code: 'UNAUTHORIZED' })
})

test('消息映射校验、长度和北京时区；微信凭证缓存且只对明确 token 失效重试', async (t) => {
  const f = fixture(t)
  const order = f.store.get('orders', f.order().orderId)
  order.items[0].name = '超长菜品名称'.repeat(10)
  order.createdAt = '2026-10-09T06:00:00.000Z'
  const data = templateData(order, f.config.notifications.fields)
  assert.equal(Array.from(data.thing2.value).length, 20)
  assert.equal(data.time3.value, '2026-10-09 14:00')
  assert.equal(readNotificationConfig({}).configured, false)
  assert.throws(() => readNotificationConfig({ WX_ORDER_TEMPLATE_FIELDS: '{"time1":"dishNames"}' }), /类型不匹配/)
  assert.throws(() => readNotificationConfig({ WX_ORDER_TEMPLATE_FIELDS: '{"thing1":"constructor"}' }), /类型不匹配/)
  assert.throws(() => readNotificationConfig({ WX_MESSAGE_STATE: 'test' }))
  let tokens = 0, sends = 0
  f.notifications.postWechat = async (url) => {
    if (url.endsWith('/stable_token')) { tokens++; return { access_token: `fake-token-${tokens}`, expires_in: 7200 } }
    sends++
    return { errcode: sends === 1 ? 42001 : 0 }
  }
  const body = { touser: 'fake-openid' }
  assert.equal((await f.notifications.sendWechat(body)).errcode, 0)
  await f.notifications.sendWechat(body)
  assert.equal(tokens, 2)
  assert.equal(sends, 3)
})

test('分类升级保留现有菜和自定义分类，不重置以后编辑过的分类', (t) => {
  const f = fixture(t)
  const before = f.store.get('dishes', f.dishId)
  f.store.db.prepare("DELETE FROM family_settings WHERE id='_categories-v2'").run()
  f.store.save('categories', { _id: 'cat-home', name: '家常小炒', enabled: true, sortOrder: 10 })
  f.store.save('categories', { _id: 'custom', name: '自定义', enabled: true, sortOrder: 100 })
  const migrated = new Store(f.store.dataDir)
  assert.equal(migrated.get('categories', 'cat-home').name, '家常热菜')
  assert.equal(migrated.get('categories', 'custom').name, '自定义')
  assert.deepEqual(migrated.get('dishes', f.dishId), before)
  migrated.save('categories', { ...migrated.get('categories', 'cat-home'), name: '以后自己改的名字' })
  migrated.close()
  const third = new Store(f.store.dataDir)
  assert.equal(third.get('categories', 'cat-home').name, '以后自己改的名字')
  third.close()
})
