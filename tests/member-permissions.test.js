const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function loadPage(file, api, wx = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages', file, 'index.js'), 'utf8'), {
    require: (name) => {
      if (name.endsWith('/api')) return api
      if (name.endsWith('/format')) return require('../miniprogram/utils/format')
      if (name.endsWith('/stable-media')) return require('../miniprogram/utils/stable-media')
      if (name.endsWith('/order-edit')) return { startOrderEdit: async () => true }
      if (name.endsWith('/order-poster')) return { posterLayout: require('../miniprogram/utils/order-poster').posterLayout, generatePoster: async () => ({ path: 'temp.png' }) }
      if (name.endsWith('/order-images')) return require('../miniprogram/utils/order-images')
      if (name.endsWith('/reorder')) return { reorder: async () => true }
      throw new Error(`Unexpected import: ${name}`)
    },
    Page: (value) => { definition = value }, wx
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return page
}

test('成员停用，确认取消不保存；保存期间不重复提交', async () => {
  const members = [{ _id: 'user', nickname: '家人', role: 'member', isAdmin: false, isChef: false, enabled: true }]
  const calls = [], prompts = []
  let confirm = false
  const page = loadPage('family-members', { call: async (action, payload) => {
    calls.push({ action, payload })
    return action === 'listFamilyMembers' ? { members } : { member: { ...members[0], ...payload } }
  } }, { showToast() {}, showModal: (options) => { prompts.push(options); options.success({ confirm }) } })
  await page.loadMembers()
  page.editMember({ currentTarget: { dataset: { id: 'user' } } })
  page.onEnabled({ detail: { value: false } })
  await page.saveMember()
  assert.equal(calls.filter((call) => call.action === 'updateFamilyMember').length, 0)
  assert.equal(page.data.selected._id, 'user')
  assert.match(prompts[0].content, /停用后/)
  confirm = true
  await Promise.all([page.saveMember(), page.saveMember()])
  const writes = calls.filter((call) => call.action === 'updateFamilyMember')
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), { memberId: 'user', nickname: '家人', enabled: false })
  assert.equal(page.data.saving, false)
  assert.equal(page.data.selected, null)
})

test('管理员编辑自身可改称呼，不提交管理员/启用状态的变更', async () => {
  let saved
  const admin = { _id: 'owner', nickname: '小柴', isAdmin: true, role: 'admin', isChef: false, enabled: true }
  const page = loadPage('family-members', { call: async (action, payload) => {
    if (action === 'updateFamilyMember') saved = payload
    return { members: [admin] }
  } }, { showToast() {}, showModal: (options) => options.success({ confirm: true }) })
  await page.loadMembers()
  page.editMember({ currentTarget: { dataset: { id: 'owner' } } })
  page.onNickname({ detail: { value: '我的新称呼' } })

  await page.saveMember()
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { memberId: 'owner', nickname: '我的新称呼' })
})

test('称呼通过微信原生编辑弹窗修改草稿，取消不改变称呼，应用不直接写服务器', () => {
  const calls = [], prompts = []
  let confirm = false
  const page = loadPage('family-members', { call: async (action) => calls.push(action) }, {
    showModal: (options) => { prompts.push(options); options.success({ confirm, content: '新称呼' }) }
  })
  page.setData({ nickname: '原称呼' })
  page.editNickname()
  assert.equal(page.data.nickname, '原称呼')
  assert.equal(prompts[0].editable, true)
  assert.equal(prompts[0].content, '原称呼')
  confirm = true
  page.editNickname()
  assert.equal(page.data.nickname, '新称呼')
  assert.equal(calls.length, 0)
})

test('成员修改无效昵称不提交，返回列表确认放弃草稿，未授权名单不显示旧数据', async () => {
  let shouldFail = false, confirm = false
  const calls = []
  const page = loadPage('family-members', { call: async (action) => {
    calls.push(action)
    if (shouldFail) throw Object.assign(new Error('只有管理员可以执行此操作'), { code: 'FORBIDDEN' })
    return { members: [{ _id: 'user', nickname: '家人', isAdmin: false, isChef: false, enabled: true }] }
  } }, { showToast() {}, showModal: (options) => options.success({ confirm }) })
  await page.loadMembers()
  page.editMember({ currentTarget: { dataset: { id: 'user' } } })
  page.onNickname({ detail: { value: '  ' } })
  await page.saveMember()
  assert(!calls.includes('updateFamilyMember'))
  await page.closeEditor()
  assert(page.data.selected)
  confirm = true
  await page.closeEditor()
  assert.equal(page.data.selected, null)
  shouldFail = true
  await page.loadMembers()
  assert.equal(page.data.members.length, 0)
  assert.match(page.data.error, /只有管理员/)
})

test('详情修改入口由后端权限决定，每次显示刷新权限和图片', async () => {
  const result = { order: { _id: 'order', revision: 1, createdAt: '2026-10-09', items: [] }, canEdit: true }
  const calls = []
  const page = loadPage('order-detail', { call: async (action) => { calls.push(action); return result } }, { showToast() {} })
  page.onLoad({ id: 'order' })
  await page.loadOrder()
  assert.equal(page.data.canEdit, true)
  assert.equal(page.data.actions, undefined)
  result.canEdit = false
  await page.onShow()
  assert.equal(page.data.canEdit, false)
  await page.editOrder()
  assert(!calls.includes('updateOrderStatus'))
})
