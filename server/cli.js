const { parseArgs } = require('node:util')
const { mkdirSync, cpSync, existsSync } = require('node:fs')
const path = require('node:path')
const { Store } = require('./store')
const { readConfig } = require('./config')

async function main() {
  const command = process.argv[2]
  const { values } = parseArgs({ args: process.argv.slice(3), options: {
    openid: { type: 'string' }, nickname: { type: 'string' }, enabled: { type: 'string' },
    output: { type: 'string' }, 'show-openids': { type: 'boolean', default: false }
  } })
  const config = readConfig()
  const store = new Store(config.dataDir)
  try {
    if (command === 'admin' || command === 'member') {
      if (!values.openid || !/^[A-Za-z0-9_-]{10,80}$/.test(values.openid)) throw new Error('请用 --openid 指定“我的”页显示的真实 OpenID')
      if (values.enabled && !['true', 'false'].includes(values.enabled)) throw new Error('--enabled 只能填写 true 或 false')
      const previous = store.member(values.openid)
      const owner = store.members().find((member) => member.role === 'admin')
      if (command === 'admin' && owner && owner.openid !== values.openid) throw new Error('管理员已固定为原账号，不能新增或转让管理员')
      if ((command === 'admin' || previous?.role === 'admin') && values.enabled === 'false') throw new Error('不能停用管理员账号')
      const member = store.saveMember({ ...previous, openid: values.openid,
        nickname: (values.nickname || previous?.nickname || '家人').trim().slice(0, 20) || '家人',
        role: command === 'admin' ? 'admin' : previous?.role || 'member',
        enabled: values.enabled ? values.enabled === 'true' : previous?.enabled ?? true,
        createdAt: previous?.createdAt || new Date().toISOString()
      })
      console.log(`已保存：${member.nickname} / ${member.role} / ${member.enabled ? '启用' : '停用'}`)
    } else if (command === 'members') {
      const members = store.db.prepare('SELECT data FROM family_members').all().map((row) => {
        const value = JSON.parse(row.data)
        return { nickname: value.nickname, role: value.role, enabled: value.enabled,
          openid: values['show-openids'] ? value.openid : `${value.openid.slice(0, 3)}…${value.openid.slice(-3)}` }
      })
      console.table(members)
    } else if (command === 'backup') {
      const destination = path.resolve(values.output || path.join(__dirname, 'backups', new Date().toISOString().replace(/[:.]/g, '-')))
      const uploads = path.join(config.dataDir, 'uploads')
      const relative = path.relative(uploads, destination)
      if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
        throw new Error('备份目录不能放在 uploads 内，避免递归复制')
      }
      if (existsSync(destination)) throw new Error('备份目录已存在，请指定一个新的目录，避免覆盖旧备份')
      mkdirSync(destination, { recursive: true, mode: 0o700 })
      await store.backup(path.join(destination, 'menu.sqlite'))
      // Images are immutable. Back up the database first, then copy all images.
      if (existsSync(uploads)) cpSync(uploads, path.join(destination, 'uploads'), { recursive: true, force: false })
      else mkdirSync(path.join(destination, 'uploads'), { mode: 0o700 })
      console.log(`备份已保存到 ${destination}`)
    } else throw new Error('支持的命令：admin、member、members、backup')
  } finally { store.close() }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
