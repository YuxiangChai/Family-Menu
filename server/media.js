const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('node:crypto')
const { mkdirSync, writeFileSync, existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const { fail } = require('../cloudfunctions/menuService/lib/validation')

const FILE_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/

class Media {
  constructor(store, publicUrl) {
    this.store = store
    this.publicUrl = publicUrl
    this.directory = path.join(store.dataDir, 'uploads')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const record = store.get('family_settings', '_media-key') || store.save('family_settings', { _id: '_media-key', value: randomBytes(32).toString('hex') })
    this.key = record.value
  }
  signature(file, session, expires) {
    return createHmac('sha256', this.key).update(`${file}:${session}:${expires}`).digest('hex')
  }
  ref(input) {
    if (!input) return ''
    let file
    if (input.startsWith('media:')) file = input.slice(6)
    else {
      let url
      try { url = new URL(input) } catch { fail('BAD_REQUEST', '请重新上传菜品图片') }
      if (url.origin !== this.publicUrl || !url.pathname.startsWith('/media/')) fail('BAD_REQUEST', '只支持本服务器上传的图片')
      file = url.pathname.slice(7)
    }
    if (!FILE_PATTERN.test(file) || !existsSync(path.join(this.directory, file))) fail('BAD_REQUEST', '图片不存在，请重新上传')
    return `media:${file}`
  }
  url(reference, session) {
    if (!reference) return ''
    const file = reference.slice(6)
    if (!reference.startsWith('media:') || !FILE_PATTERN.test(file)) return ''
    const expires = String(Date.now() + 24 * 60 * 60 * 1000)
    const query = new URLSearchParams({ s: session, e: expires, sig: this.signature(file, session, expires) })
    return `${this.publicUrl}/media/${file}?${query}`
  }
  upload(payload) {
    if (typeof payload.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.base64)) fail('BAD_REQUEST', '图片格式不正确')
    const content = Buffer.from(payload.base64, 'base64')
    if (!content.length || content.length > 3 * 1024 * 1024) fail('BAD_REQUEST', '图片需小于 3MB')
    let extension
    if (content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) extension = 'png'
    else if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) extension = 'jpg'
    else if (content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP') extension = 'webp'
    else fail('BAD_REQUEST', '只支持 JPG、PNG 或 WebP 图片')
    const file = `${randomUUID()}.${extension}`
    writeFileSync(path.join(this.directory, file), content, { flag: 'wx', mode: 0o600 })
    return `media:${file}`
  }
  read(url) {
    const file = url.pathname.slice(7)
    const session = url.searchParams.get('s') || ''
    const expires = url.searchParams.get('e') || ''
    const signature = url.searchParams.get('sig') || ''
    if (!FILE_PATTERN.test(file) || !/^[a-f0-9]{64}$/.test(session) || !/^\d{13}$/.test(expires) || Number(expires) <= Date.now() || !/^[a-f0-9]{64}$/.test(signature)) fail('FORBIDDEN', '图片链接已过期')
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(file, session, expires)))) fail('FORBIDDEN', '图片链接无效')
    const record = this.store.db.prepare('SELECT openid FROM sessions WHERE token_hash = ? AND expires_at > ?').get(session, Date.now())
    if (!record || !this.store.member(record.openid)?.enabled) fail('FORBIDDEN', '无权查看图片')
    const target = path.join(this.directory, file)
    if (!existsSync(target)) fail('NOT_FOUND', '图片不存在')
    return { content: readFileSync(target), mime: file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }
  }
}

module.exports = { Media }
