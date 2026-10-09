const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const { Store } = require('../store')
const { Service } = require('../service')
const { Media } = require('../media')
const { place } = require('./helpers/shared')
const { Notifications } = require('../notifications')

function fixture(t) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'family-menu-roles-'))
  const store = new Store(dataDir)
  const notifications = new Notifications(store, {})
  const service = new Service(store, new Media(store, 'http://127.0.0.1:3000'), notifications)
  t.after(() => { notifications.stop(); store.close(); rmSync(dataDir, { recursive: true, force: true }) })
  for (const who of ['admin', 'user', 'chef']) store.saveMember({ openid: `test-${who}-openid`, nickname: who, role: who === 'admin' ? 'admin' : 'member', isChef: who === 'chef', enabled: true, createdAt: '2026-10-01T00:00:00.000Z' })
  const call = (who, action, event = {}) => service.dispatch(action, { openid: `test-${who}-openid`, tokenHash: '0'.repeat(64) }, event)
  const dishId = call('admin', 'saveDish', { dish: { name: '简单小菜' } }).dishId
  const order = (who, key = who) => place(call, who, { items: [{ dishId }], dinerCount: 3, remark: '少盐', idempotencyKey: key }).orderId
  return { store, call, order, dishId }
}

test('两种身份：旧厨师标记不再授予权限，管理员固定且唯一', (t) => {
  const f = fixture(t)
  const id = f.order('user')
  const admin = f.store.member('test-admin-openid'), user = f.store.member('test-user-openid')
  assert.equal(f.call('chef', 'getProfile').member.isChef, undefined)
  assert.equal(f.call('chef', 'getOrder', { orderId: id }).canEdit, true)
  assert.equal(f.call('user', 'getOrder', { orderId: id }).canEdit, true)
  assert.equal(f.call('admin', 'getOrder', { orderId: id }).canEdit, true)
  for (const who of ['admin', 'user', 'chef']) assert.throws(() => f.call(who, 'updateOrderStatus', { orderId: id, status: 'confirmed' }), { code: 'BAD_REQUEST' })
  assert.throws(() => f.call('admin', 'updateFamilyMember', { memberId: user._id, isChef: true }), { code: 'BAD_REQUEST' })
  for (const event of [{ memberId: admin._id, role: 'member' }, { memberId: admin._id, enabled: false }, { memberId: user._id, role: 'admin' }, { memberId: user._id, isAdmin: true }]) {
    assert.throws(() => f.call('admin', 'updateFamilyMember', event), { code: 'FORBIDDEN' })
  }
  assert.throws(() => f.store.saveMember({ openid: 'test-another-admin', role: 'admin', enabled: true }), /UNIQUE/)
  const joined = f.call('late', 'joinFamily', { inviteCode: f.call('admin', 'setInviteCode').inviteCode, role: 'admin', isChef: true }).member
  assert.equal(joined.role, 'member')
  assert.equal(joined.isAdmin, false)
  assert.equal(joined.isChef, undefined)
})

test('成员管理仅改称呼和状态，不泄露身份，不改变管理员或元数据', (t) => {
  const f = fixture(t), user = f.store.member('test-user-openid')
  assert(!JSON.stringify(f.call('admin', 'listFamilyMembers')).includes('openid'))
  assert.throws(() => f.call('user', 'listFamilyMembers'), { code: 'FORBIDDEN' })
  for (const enabled of ['false', 0, null]) assert.throws(() => f.call('admin', 'updateFamilyMember', { memberId: user._id, enabled }), { code: 'BAD_REQUEST' })
  for (const nickname of ['', '  ', '字'.repeat(21), null]) assert.throws(() => f.call('admin', 'updateFamilyMember', { memberId: user._id, nickname }), { code: 'BAD_REQUEST' })
  f.call('admin', 'updateFamilyMember', { memberId: user._id, nickname: '家人', openid: 'attacker', createdAt: 'fake' })
  assert.equal(f.store.member(user.openid).createdAt, user.createdAt)
  assert.equal(f.store.member('attacker'), null)
  const orderId = f.order('user')
  f.call('admin', 'updateFamilyMember', { memberId: user._id, enabled: false })
  for (const action of ['listMenu', 'getOrder', 'prepareOrderEdit', 'getActiveMenu', 'startActiveMenu', 'changeActiveMenu', 'submitActiveMenu']) assert.throws(() => f.call('user', action, { orderId }), { code: 'ACCOUNT_DISABLED' })
  f.call('admin', 'updateFamilyMember', { memberId: user._id, enabled: true })
  assert.equal(f.call('user', 'getOrder', { orderId }).canEdit, true)
})

test('旧数据库事务升级保留成员 ID、OpenID、元数据、订单、邀请码和会话；重启幂等', (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'family-menu-migration-'))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const old = new DatabaseSync(path.join(dataDir, 'menu.sqlite'))
  old.exec("CREATE TABLE family_members (id TEXT PRIMARY KEY, openid TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','member')), enabled INTEGER NOT NULL, data TEXT NOT NULL); PRAGMA user_version=2;")
  const members = [{ _id: 'old-admin-id', openid: 'old-admin-openid', nickname: '管理员', role: 'admin', enabled: true, custom: '保留' }, { _id: 'old-user-id', openid: 'old-user-openid', nickname: '家人', role: 'member', enabled: false, joinedByInvite: true }]
  for (const member of members) old.prepare('INSERT INTO family_members VALUES (?, ?, ?, ?, ?)').run(member._id, member.openid, member.role, Number(member.enabled), JSON.stringify(member))
  old.close()
  const upgraded = new Store(dataDir)
  for (const member of members) assert.deepEqual(upgraded.member(member.openid), { ...member, isChef: false })
  assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 4)
  upgraded.save('family_settings', { _id: 'family', inviteCodeHash: 'preserve-hash' })
  upgraded.save('orders', { _id: 'old-order', creatorOpenid: members[0].openid, orderDate: '2026-10-01', status: 'pending', idempotencyKey: 'old-key', items: [], createdAt: '2026-10-01T00:00:00.000Z' })
  upgraded.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('fake-hash', members[0].openid, 9999999999999)
  upgraded.saveMember({ ...upgraded.member(members[0].openid), isChef: true })
  upgraded.close()
  const restarted = new Store(dataDir)
  try {
    assert.equal(restarted.member(members[0].openid).isChef, true)
    assert.equal(restarted.member(members[0].openid).role, 'admin')
    assert.equal(restarted.member(members[1].openid).enabled, false)
    assert.equal(restarted.get('family_settings', 'family').inviteCodeHash, 'preserve-hash')
    assert.equal(restarted.get('orders', 'old-order').idempotencyKey, 'old-key')
    assert.equal(restarted.db.prepare('SELECT openid FROM sessions').get().openid, members[0].openid)
    assert.equal(restarted.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally { restarted.close() }
})

test('旧库有多个管理员时明确拒绝升级，不擅自降级或删除成员', (t) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'family-menu-multiple-admins-'))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const old = new DatabaseSync(path.join(dataDir, 'menu.sqlite'))
  old.exec("CREATE TABLE family_members (id TEXT PRIMARY KEY, openid TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('admin','member')), enabled INTEGER NOT NULL, data TEXT NOT NULL); PRAGMA user_version=2;")
  for (const id of ['one', 'two']) old.prepare('INSERT INTO family_members VALUES (?, ?, ?, ?, ?)').run(id, `test-${id}`, 'admin', 1, JSON.stringify({ _id: id, openid: `test-${id}`, role: 'admin', enabled: true }))
  assert.throws(() => new Store(dataDir), /存在多个管理员/)
  assert.equal(old.prepare("SELECT count(*) AS count FROM family_members WHERE role='admin'").get().count, 2)
  assert.equal(old.prepare('PRAGMA user_version').get().user_version, 2)
  assert.equal(old.prepare('PRAGMA table_info(family_members)').all().some((column) => column.name === 'is_chef'), false)
  old.close()
})
