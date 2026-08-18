const crypto = require('crypto')

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizeInviteCode(value) {
  const code = String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase()
  if (!/^[A-Z0-9]{8,32}$/.test(code)) {
    const error = new Error('邀请码需为 8 到 32 位字母或数字')
    error.code = 'BAD_REQUEST'
    throw error
  }
  return code
}

function formatInviteCode(value) {
  const code = normalizeInviteCode(value)
  return code.match(/.{1,4}/g).join('-')
}

function generateInviteCode(length = 12) {
  if (!Number.isInteger(length) || length < 8 || length > 32) {
    throw new Error('邀请码长度必须是 8 到 32 位整数')
  }
  const bytes = crypto.randomBytes(length)
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result += INVITE_ALPHABET[bytes[index] % INVITE_ALPHABET.length]
  }
  return result
}

function createInviteRecord(value, salt = crypto.randomBytes(16).toString('hex')) {
  const code = normalizeInviteCode(value)
  return {
    salt,
    hash: crypto.scryptSync(code, salt, 32).toString('hex')
  }
}

function verifyInviteCode(value, record) {
  if (!record || !record.salt || !record.hash) return false
  let code
  try {
    code = normalizeInviteCode(value)
  } catch (error) {
    return false
  }
  const actual = crypto.scryptSync(code, record.salt, 32)
  const expected = Buffer.from(record.hash, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

module.exports = {
  createInviteRecord,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
  verifyInviteCode
}
