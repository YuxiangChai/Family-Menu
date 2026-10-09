const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { once } = require('node:events')
const { createApp } = require('../http')
const { Store } = require('../store')
const { hashToken } = require('../auth')
const { cleanDish } = require('../../cloudfunctions/menuService/lib/validation')

test('自建后端完整业务、持久化和权限', async (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'family-menu-test-'))
  const identities = { admin: 'test-admin-openid', member: 'test-member-openid', other: 'test-other-openid', stranger: 'test-stranger-openid' }
  const config = { dataDir, publicUrl: 'http://127.0.0.1:3000', appId: 'test-app', appSecret: 'not-a-real-secret' }
  const app = createApp(config, { exchangeCode: async (_config, code) => {
    if (!identities[code]) { const error = new Error('invalid code'); error.code = 'LOGIN_FAILED'; throw error }
    return identities[code]
  } })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const origin = `http://127.0.0.1:${app.server.address().port}`
  app.service.media.publicUrl = origin
  t.after(async () => { await new Promise((resolve) => app.server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }) })
  const call = async (action, payload = {}, token) => {
    const response = await fetch(`${origin}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) })
    return { status: response.status, ...(await response.json()) }
  }
  const tokens = {}
  for (const name of Object.keys(identities)) tokens[name] = (await call('login', { code: name })).data.token
  app.store.saveMember({ openid: identities.admin, nickname: '管理员', role: 'admin', enabled: true, createdAt: new Date().toISOString() })
  let inviteCode, minimalId, richId, orderId, imageUrl
  const orderPayload = (id, key) => ({ payload: { items: [{ dishId: id, servings: 2 }], dinerCount: 2, remark: '少盐', idempotencyKey: key } })
  const place = async ({ payload }, token) => {
    const started = await call('startActiveMenu', {}, token)
    if (!started.ok) return started
    const menuId = started.data.menu.menuId
    const changed = await call('changeActiveMenu', { menuId, addDishIds: payload.items.map((item) => item.dishId),
      dinerCount: payload.dinerCount, remark: payload.remark, idempotencyKey: payload.idempotencyKey }, token)
    if (!changed.ok) { await call('cancelActiveMenu', { menuId }, tokens.admin); return changed }
    return call('submitActiveMenu', { menuId }, token)
  }

  await t.test('健康检查可访问，登录只信任微信换取的身份', async () => {
    assert.equal((await fetch(`${origin}/health`)).status, 200)
    const profile = await call('getProfile', { openid: identities.admin, role: 'admin' }, tokens.stranger)
    assert.equal(profile.data.openid, identities.stranger)
    assert.equal(profile.data.authorized, false)
    assert.equal((await call('listMenu', {}, tokens.stranger)).status, 403)
    assert.equal((await call('getProfile')).status, 401)
    assert.equal((await call('login', { code: 'bad', openid: identities.admin })).ok, false)
    const session = app.store.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hashToken(tokens.admin))
    assert.equal(session.openid, identities.admin)
    assert.notEqual(session.token_hash, tokens.admin)
    assert.equal((await call('constructor', {}, tokens.admin)).error.code, 'BAD_REQUEST')
  })

  await t.test('邀请码存储校验值、加入只能成为普通成员', async () => {
    inviteCode = (await call('setInviteCode', {}, tokens.admin)).data.inviteCode
    const settings = app.store.get('family_settings', 'family')
    assert.equal(JSON.stringify(settings).includes(inviteCode.replace(/-/g, '')), false)
    assert.equal((await call('joinFamily', { inviteCode: 'WRONGCODE' }, tokens.member)).error.code, 'INVALID_INVITE_CODE')
    const joined = await call('joinFamily', { inviteCode, nickname: '家人', role: 'admin', openid: identities.admin }, tokens.member)
    assert.equal(joined.data.member.role, 'member')
    assert.equal((await call('joinFamily', { inviteCode: 'wrong' }, tokens.member)).data.joined, false)
    assert.equal((await call('getInviteStatus', {}, tokens.member)).status, 403)
    await call('joinFamily', { inviteCode, nickname: '另一位家人' }, tokens.other)
  })

  await t.test('仅菜名即可保存，空字段留空，未分类菜能进入菜单', async () => {
    const result = await call('saveDish', { dish: { name: '清蒸鱼' } }, tokens.admin)
    assert.equal(result.ok, true)
    minimalId = result.data.dishId
    const dish = (await call('getDish', { dishId: minimalId }, tokens.member)).data
    assert.deepEqual(dish.ingredients, [])
    assert.deepEqual(dish.steps, [])
    assert.equal(dish.description, '')
    assert.equal(dish.categoryId, '')
    assert.equal(dish.defaultServings, null)
    assert.equal(dish.cookingTime, null)
    const menu = (await call('listMenu', {}, tokens.member)).data
    assert.equal(menu.dishes.find((item) => item._id === minimalId).categoryId, '__uncategorized__')
    assert(menu.categories.some((item) => item._id === '__uncategorized__'))
    assert.equal((await call('saveDish', { dish: { name: ' ' } }, tokens.admin)).error.code, 'BAD_REQUEST')
    assert.equal((await call('saveDish', { dish: { name: '伪造' }, role: 'admin' }, tokens.member)).status, 403)
    assert.equal((await call('saveDish', { dish: { name: '测试', defaultServings: -1 } }, tokens.admin)).error.code, 'BAD_REQUEST')
  })

  await t.test('无食材菜品可下单，同一提交标识不重复创建', async () => {
    const payload = orderPayload(minimalId, 'minimal-order')
    const results = await Promise.all([place(payload, tokens.member), place(payload, tokens.member)])
    assert.equal(results[0].data.orderId, results[1].data.orderId)
    assert.equal(results.filter((item) => item.data.duplicated).length, 1)
    orderId = results[0].data.orderId
    const order = (await call('getOrder', { orderId }, tokens.member)).data.order
    assert.deepEqual(order.ingredientSummary, [])
    assert.equal(order.items[0].name, '清蒸鱼')
    assert.equal(order.items[0].defaultServings, undefined)
    assert.equal(order.items[0].servings, undefined)
    assert.equal(order.status, undefined)
    assert.equal(order.revision, undefined)
    assert.equal(order.creatorOpenid, undefined)
    // Every enabled family member can view shared history, independently of notifications.
    assert.equal((await call('getOrder', { orderId }, tokens.other)).status, 200)
    assert.equal((await call('getOrder', { orderId }, tokens.stranger)).status, 403)
    assert.equal((await call('listOrders', {}, tokens.other)).data.orders.length, 1)
    assert.equal((await call('listOrders', {}, tokens.admin)).data.orders.length, 1)
    const badDiners = orderPayload(minimalId, 'bad-count')
    badDiners.payload.dinerCount = 0
    assert.equal((await place(badDiners, tokens.member)).error.code, 'BAD_REQUEST')
    const bad = orderPayload(minimalId, 'invalid')
    bad.payload.items[0].dishId = 'missing'
    assert.equal((await place(bad, tokens.member)).error.code, 'BAD_REQUEST')
  })

  await t.test('照片上传、签名访问和编辑后的持久引用', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    assert.equal((await call('uploadDishImage', { base64: png }, tokens.member)).status, 403)
    assert.equal((await call('uploadDishImage', { base64: Buffer.from('<script>x</script>').toString('base64') }, tokens.admin)).error.code, 'BAD_REQUEST')
    imageUrl = (await call('uploadDishImage', { base64: png, extension: 'png' }, tokens.admin)).data.fileID
    assert.equal((await fetch(imageUrl)).status, 200)
    const url = new URL(imageUrl)
    assert.equal((await fetch(`${origin}${url.pathname}`)).status, 403)
    url.searchParams.set('sig', '0'.repeat(64))
    assert.equal((await fetch(url)).status, 403)
    const saved = await call('saveDish', { dish: { name: '番茄炒蛋', imageFileId: imageUrl, categoryId: 'cat-home', defaultServings: 2, description: '家常', ingredients: [{ name: '鸡蛋', quantity: 3, unit: '个', type: 'main' }, { name: '盐', quantity: '', type: 'seasoning' }, { name: '', quantity: '' }], steps: ['炒熟', ''] } }, tokens.admin)
    richId = saved.data.dishId
    const dish = (await call('getDish', { dishId: richId }, tokens.admin)).data
    assert.equal(dish.ingredients.length, 2)
    assert.equal(dish.ingredients[1].quantity, '')
    assert.equal(dish.steps.length, 1)
    assert.match(app.store.get('dishes', richId).imageFileId, /^media:/)
    await call('saveDish', { dish }, tokens.admin)
    assert.equal((await fetch((await call('getDish', { dishId: richId }, tokens.member)).data.imageFileId)).status, 200)
    assert.equal((await call('saveDish', { dish: { name: '外部图', imageFileId: 'https://attacker.invalid/test.png' } }, tokens.admin)).error.code, 'BAD_REQUEST')
  })

  await t.test('食材参考用量、订单快照和下架规则保持', async () => {
    const placed = await place(orderPayload(richId, 'rich-order'), tokens.member)
    const id = placed.data.orderId
    const before = (await call('getOrder', { orderId: id }, tokens.member)).data.order
    assert.equal(before.ingredientSummary[0].quantity, 3)
    assert.equal(before.ingredientSummary[1].quantity, '')
    await call('saveDish', { dish: { _id: richId, name: '已改名' } }, tokens.admin)
    assert.equal((await call('getOrder', { orderId: id }, tokens.admin)).data.order.items[0].name, '番茄炒蛋')
    await call('toggleDish', { dishId: richId, enabled: false }, tokens.admin)
    assert.equal((await call('getDish', { dishId: richId }, tokens.member)).status, 404)
    assert.equal((await call('getDish', { dishId: richId }, tokens.admin)).status, 200)
    assert.equal((await place(orderPayload(richId, 'unlisted-order'), tokens.member)).ok, false)
    assert((await call('listMenu', { includeDisabled: true }, tokens.admin)).data.dishes.some((item) => item._id === richId))
    assert(!(await call('listMenu', { includeDisabled: true }, tokens.member)).data.dishes.some((item) => item._id === richId))
  })

  await t.test('全家同一菜单，增删和提交通过真实 HTTP 验证；旧整单接口和状态流程拒绝', async () => {
    assert.equal((await call('updateOrderStatus', { orderId, status: 'confirmed' }, tokens.admin)).error.code, 'BAD_REQUEST')
    assert.equal((await call('createOrder', orderPayload(minimalId, 'legacy'), tokens.other)).error.code, 'BAD_REQUEST')
    assert.equal((await call('updateOrder', { orderId }, tokens.other)).error.code, 'BAD_REQUEST')
    const menuId = (await call('prepareOrderEdit', { orderId }, tokens.other)).data.menu.menuId
    assert.equal((await call('startActiveMenu', {}, tokens.member)).data.menu.menuId, menuId)
    assert.equal((await call('startActiveMenu', { sourceOrderId: orderId }, tokens.admin)).status, 409)
    const changes = { menuId, remark: '改少油', idempotencyKey: 'edit' }
    assert.equal((await call('changeActiveMenu', changes, tokens.member)).ok, true)
    assert.equal((await call('changeActiveMenu', changes, tokens.member)).data.duplicated, true)
    const results = await Promise.all(['member', 'other'].map((name) => call('submitActiveMenu', { menuId }, tokens[name])))
    assert(results.every((result) => result.data.orderId === orderId))
    assert.equal(results.filter((result) => result.data.duplicated).length, 1)
    assert.equal((await call('changeActiveMenu', { ...changes, idempotencyKey: 'late' }, tokens.admin)).status, 409)
    assert.equal((await call('getOrder', { orderId }, tokens.member)).data.order.remark, '改少油')
  })

  await t.test('管理员只管理称呼和启用状态，旧厨师入口拒绝，普通用户不能提权', async () => {
    const list = await call('listFamilyMembers', {}, tokens.admin)
    assert.equal(list.ok, true)
    assert(!JSON.stringify(list.data).includes(identities.member))
    assert.equal((await call('listFamilyMembers', {}, tokens.member)).status, 403)
    const target = list.data.members.find((member) => member.nickname === '另一位家人')
    assert.equal((await call('updateFamilyMember', { memberId: target._id, role: 'admin' }, tokens.admin)).status, 403)
    assert.equal((await call('updateFamilyMember', { memberId: target._id, isChef: true }, tokens.admin)).status, 400)
    assert.equal((await call('updateFamilyMember', { memberId: target._id, nickname: '普通用户' }, tokens.other)).status, 403)
    assert.equal((await call('updateFamilyMember', { memberId: target._id, nickname: '另一位家人' }, tokens.admin)).data.member.role, 'member')
    assert.equal((await call('getProfile', {}, tokens.other)).data.member.isChef, undefined)
    assert.equal((await call('saveDish', { dish: { name: '不可提权' } }, tokens.other)).status, 403)
  })

  await t.test('更换邀请码不移除老成员，禁用账号无法重新加入或读图片', async () => {
    const replacement = (await call('setInviteCode', { inviteCode: 'NEWCODE12345' }, tokens.admin)).data.inviteCode
    assert.equal((await call('joinFamily', { inviteCode }, tokens.stranger)).error.code, 'INVALID_INVITE_CODE')
    assert.equal((await call('joinFamily', { inviteCode: replacement }, tokens.stranger)).ok, true)
    assert.equal((await call('listMenu', {}, tokens.member)).ok, true)
    const member = app.store.member(identities.stranger)
    app.store.saveMember({ ...member, enabled: false })
    assert.equal((await call('joinFamily', { inviteCode: replacement }, tokens.stranger)).error.code, 'ACCOUNT_DISABLED')
    assert.equal((await call('listMenu', {}, tokens.stranger)).status, 403)
    const admin = app.store.member(identities.admin)
    app.store.saveMember({ ...admin, enabled: false })
    assert.equal((await fetch(imageUrl)).status, 403)
    app.store.saveMember(admin)
  })

  await t.test('过期会话拒绝访问，数据库文件不能从 HTTP 下载', async () => {
    app.store.db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(hashToken(tokens.other))
    assert.equal((await call('getProfile', {}, tokens.other)).error.code, 'AUTH_EXPIRED')
    assert.equal((await fetch(`${origin}/server/data/menu.sqlite`)).status, 404)
    assert.equal((await fetch(`${origin}/.env`)).status, 404)
    const malformed = await fetch(`${origin}/api/getProfile`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.admin}` }, body: '{' })
    assert.equal(malformed.status, 400)
  })

  await t.test('底层数据库错误不会泄露内部信息', async () => {
    const original = app.service.dispatch
    const originalLog = console.error
    app.service.dispatch = () => { const error = new Error('private database information'); error.code = 'SQLITE_ERROR'; throw error }
    console.error = () => {}
    try {
      const result = await call('getProfile', {}, tokens.admin)
      assert.equal(result.status, 500)
      assert.equal(result.error.code, 'INTERNAL_ERROR')
      assert(!JSON.stringify(result).includes('private database'))
    } finally { app.service.dispatch = original; console.error = originalLog }
  })

  await t.test('独立 SQLite 连接读到已保存成员、菜品、订单；备份完整', async () => {
    const second = new Store(dataDir)
    try {
      assert.equal(second.member(identities.member).nickname, '家人')
      assert.equal(second.get('dishes', minimalId).name, '清蒸鱼')
      assert.equal(second.get('orders', orderId).status, 'completed')
      assert(second.get('family_settings', 'family').inviteCodeHash)
    } finally { second.close() }
    const file = path.join(dataDir, 'test-backup.sqlite')
    await app.store.backup(file)
    assert.equal(readFileSync(file).toString('ascii', 0, 15), 'SQLite format 3')
  })

  await t.test('邀请码失败次数受到限制，防止反复猜码', async () => {
    const token = (await call('login', { code: 'other' })).data.token
    // Use a new verified test identity with no membership.
    app.store.db.prepare('UPDATE sessions SET openid=? WHERE token_hash=?').run('test-rate-limit-openid', hashToken(token))
    for (let i = 0; i < 10; i++) assert.equal((await call('joinFamily', { inviteCode: 'WRONGCODE' }, token)).error.code, 'INVALID_INVITE_CODE')
    assert.equal((await call('joinFamily', { inviteCode: 'WRONGCODE' }, token)).status, 429)
  })

  await t.test('历史和复制接口保留；旧订阅、通知接口停用且不再新增消息', async () => {
    for (const action of ['getNotificationStatus', 'recordSubscription', 'listNotifications', 'markNotificationRead']) assert.equal((await call(action, {}, tokens.admin)).error.code, 'BAD_REQUEST')
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM notifications').get().n, 0)
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM notification_outbox').get().n, 0)
    const draft = (await call('prepareReorder', { orderId }, tokens.admin)).data
    assert.equal(draft.items[0].name, '清蒸鱼')
    assert.equal(draft.items[0].servings, undefined)
    assert.equal((await call('listOrders', { scope: 'history', limit: 1 }, tokens.admin)).data.orders.length, 1)
    assert.equal((await call('getOrder', { orderId })).status, 401)
  })

})

test('菜名是唯一必填项；有值的数字仍需合法', () => {
  const dish = cleanDish({ name: '  小炒  ', categoryId: '', description: null, defaultServings: '', cookingTime: '', ingredients: [{ name: '盐', quantity: '', unit: '' }], steps: [''] })
  assert.equal(dish.name, '小炒')
  assert.equal(dish.defaultServings, null)
  assert.equal(dish.ingredients[0].quantity, '')
  assert.deepEqual(dish.steps, [])
  assert.throws(() => cleanDish({ name: ' ' }), /名称/)
  assert.throws(() => cleanDish({ name: '菜', ingredients: [{ name: '盐', quantity: -1 }] }), /数字/)
  assert.throws(() => cleanDish({ name: '菜', defaultServings: 1.5 }), /整数/)
})
