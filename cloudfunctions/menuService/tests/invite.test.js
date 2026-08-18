const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createInviteRecord,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
  verifyInviteCode
} = require('../lib/invite')

test('邀请码忽略大小写、空格和分隔横线', () => {
  assert.equal(normalizeInviteCode(' abcd-efgh 12 '), 'ABCDEFGH12')
})

test('邀请码必须是足够长的字母数字串', () => {
  assert.throws(() => normalizeInviteCode('abc'))
  assert.throws(() => normalizeInviteCode('abcdefgh!'))
})

test('只保存加盐校验值，正确邀请码才能通过', () => {
  const record = createInviteRecord('ABCD-EFGH-JKLM', 'fixed-test-salt')
  assert.notEqual(record.hash, 'ABCDEFGHIJKLM')
  assert.equal(verifyInviteCode('abcd efgh jklm', record), true)
  assert.equal(verifyInviteCode('ABCD-EFGH-XXXX', record), false)
})

test('随机邀请码为 12 位且便于分组显示', () => {
  const code = generateInviteCode()
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/)
  assert.match(formatInviteCode(code), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
})
