const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../miniprogram')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const secondaryPages = ['dish-detail', 'order-detail', 'admin-dishes', 'invite-settings', 'family-members', 'dish-edit', 'cart']
const clone = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function load(name, api = { call: async () => ({}) }, wx = {}) {
  let definition
  const app = { globalData: {} }
  vm.runInNewContext(read(`pages/${name}/index.js`), {
    Page: (page) => { definition = page }, getApp: () => app, wx, setInterval: () => 1, clearInterval() {},
    require: (name) => name.endsWith('/api') ? api : name.endsWith('/cart') ? {} : require(path.join(root, 'utils', name.split('/').at(-1)))
  })
  return { ...definition, data: clone(definition.data), patches: [],
    setData(patch, done) { this.patches.push(patch); Object.assign(this.data, patch); done?.() } }
}

test('全部二级页独立注册、使用原生导航和返回，不再叠加自制导航占位', () => {
  const app = JSON.parse(read('app.json'))
  const tabs = app.tabBar.list.map((tab) => tab.pagePath)
  for (const name of secondaryPages) {
    const page = `pages/${name}/index`
    assert(app.pages.includes(page))
    assert(!tabs.includes(page))
    const config = JSON.parse(read(`${page}.json`))
    assert.equal(config.navigationStyle, 'default')
    assert(config.navigationBarTitleText)
    assert(!config.usingComponents?.['custom-nav'])
    assert(!read(`${page}.wxml`).includes('custom-nav'))
  }
})

test('主页面打开二级页只压入新页面，不清空主页面的菜单、搜索、列表或个人资料', () => {
  const routes = []
  const wx = { navigateTo: ({ url }) => routes.push(url) }
  const home = load('index', undefined, wx)
  const history = load('orders', undefined, wx)
  const profile = load('profile', undefined, wx)
  home.setData({ keyword: '番茄', activeCategory: 'home', dishes: [{ _id: 'egg' }], sections: [{ _id: 'home' }] })
  history.setData({ orders: [{ _id: 'order' }], nextCursor: 'next' })
  profile.setData({ profile: { nickname: '家人' } })
  const before = [home, history, profile].map((page) => clone(page.data))
  home.openDish({ currentTarget: { dataset: { id: 'egg' } } })
  home.openCart()
  history.openOrder({ currentTarget: { dataset: { id: 'order' } } })
  profile.openAdminDishes(); profile.openInviteSettings(); profile.openFamilyMembers()
  assert.deepEqual(routes, ['/pages/dish-detail/index?id=egg', '/pages/cart/index', '/pages/order-detail/index?id=order',
    '/pages/admin-dishes/index', '/pages/invite-settings/index', '/pages/family-members/index'])
  assert.deepEqual([home, history, profile].map((page) => clone(page.data)), before)
})

test('成员页返回后台刷新保留列表；编辑草稿不被 onShow 重载覆盖，网络错误不清空', async () => {
  let request = deferred()
  const page = load('family-members', { call: () => request.promise })
  const member = { _id: 'a', nickname: '家人', enabled: true }
  const first = page.onShow()
  request.resolve({ members: [member] }); await first
  request = deferred()
  const returning = page.onShow()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.members[0].nickname, '家人')
  request.reject(new Error('网络故障')); await returning
  assert.equal(page.data.members.length, 1)
  page.editMember({ currentTarget: { dataset: { id: 'a' } } })
  page.onNickname({ detail: { value: '未保存称呼' } })
  await page.onShow()
  assert.equal(page.data.nickname, '未保存称呼')
  assert.equal(page.data.selected._id, 'a')
  request = deferred()
  const revoked = page.loadMembers()
  request.reject(Object.assign(new Error('权限失效'), { code: 'FORBIDDEN' })); await revoked
  assert.equal(page.data.members.length, 0)
  assert.equal(page.data.selected, null)
  assert.equal(page.data.nickname, '')
})

test('邀请码后台重试不清空已显示页面和输入，权限失效才清空；卸载后丢弃迟到响应', async () => {
  let request = deferred()
  const page = load('invite-settings', { call: () => request.promise })
  const first = page.onLoad()
  request.resolve({ configured: true }); await first
  page.setData({ customCode: 'not-saved' })
  request = deferred()
  const retry = page.loadStatus()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.statusReady, true)
  request.reject(new Error('网络故障')); await retry
  assert.equal(page.data.customCode, 'not-saved')
  request = deferred()
  const revoked = page.loadStatus()
  request.reject(Object.assign(new Error('权限失效'), { code: 'FORBIDDEN' })); await revoked
  assert.equal(page.data.statusReady, false)
  assert.equal(page.data.customCode, '')
  request = deferred()
  const leaving = page.loadStatus()
  page.onUnload()
  request.resolve({ configured: true }); await leaving
  assert.equal(page.data.statusReady, false)
})

test('菜品、编辑、菜单页标题通过原生导航更新，不在正文补一个导航栏', async () => {
  const titles = []
  const wx = { setNavigationBarTitle: ({ title }) => titles.push(title) }
  const dish = load('dish-detail', { call: async () => ({ name: '番茄炒蛋' }) }, wx)
  await dish.onLoad({ id: 'egg' })
  assert.equal(titles[0], '番茄炒蛋')
  const edit = load('dish-edit', undefined, wx)
  edit.loadForm = () => {}
  edit.onLoad({})
  assert.equal(titles[1], '新增菜品')
  edit.onLoad({ id: 'egg' })
  assert.equal(titles[2], '编辑菜品')
})
