const { fail, cleanText, cleanDish } = require('../cloudfunctions/menuService/lib/validation')
const { aggregateIngredients, createItemSnapshot, canTransitionStatus, normalizeServings } = require('../cloudfunctions/menuService/lib/domain')
const { createInviteRecord, formatInviteCode, generateInviteCode, verifyInviteCode } = require('../cloudfunctions/menuService/lib/invite')

const UNCATEGORIZED = { _id: '__uncategorized__', name: '未分类', sortOrder: 10000, enabled: true }
const ACTIONS = new Set(['getProfile', 'joinFamily', 'getInviteStatus', 'setInviteCode', 'listMenu', 'getDish', 'createOrder', 'listOrders', 'getOrder', 'updateOrderStatus', 'saveDish', 'toggleDish', 'uploadDishImage'])
function chinaDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }

class Service {
  constructor(store, media) { this.store = store; this.media = media }
  member(openid) {
    const member = this.store.member(openid)
    if (!member) fail('UNAUTHORIZED', '你还不在家庭成员名单中')
    if (!member.enabled) fail('ACCOUNT_DISABLED', '这个微信账号已被停用，请联系家庭管理员')
    return member
  }
  admin(openid) {
    const member = this.member(openid)
    if (member.role !== 'admin') fail('FORBIDDEN', '只有管理员可以执行此操作')
    return member
  }
  publicMember(member) {
    if (!member) return null
    return { _id: member._id, nickname: member.nickname, role: member.role, enabled: member.enabled }
  }
  picture(dish, tokenHash) {
    return { ...dish, imageFileId: this.media.url(dish.imageFileId, tokenHash) }
  }
  dispatch(action, identity, event = {}) {
    if (!ACTIONS.has(action)) fail('BAD_REQUEST', '未知操作')
    return this[action](identity.openid, event, identity.tokenHash)
  }
  getProfile(openid) {
    const member = this.store.member(openid)
    return { openid, authorized: Boolean(member?.enabled), member: member?.enabled ? this.publicMember(member) : null }
  }
  joinFamily(openid, event) {
    const existing = this.store.member(openid)
    if (existing) {
      this.member(openid)
      return { joined: false, member: this.publicMember(existing) }
    }
    if (!this.store.rateLimit(`invite:${openid}`, 10, 10 * 60 * 1000)) fail('RATE_LIMITED', '尝试次数过多，请稍后再试')
    const settings = this.store.get('family_settings', 'family')
    if (!settings?.inviteCodeHash) fail('INVITE_NOT_CONFIGURED', '家庭管理员还没有设置邀请码')
    if (!verifyInviteCode(event.inviteCode, { salt: settings.inviteCodeSalt, hash: settings.inviteCodeHash })) fail('INVALID_INVITE_CODE', '邀请码不正确，请向家庭管理员确认')
    const member = this.store.saveMember({ openid, nickname: cleanText(event.nickname, 20) || '家人', role: 'member', enabled: true, joinedByInvite: true, createdAt: new Date().toISOString() })
    return { joined: true, member: this.publicMember(member) }
  }
  getInviteStatus(openid) {
    this.admin(openid)
    const settings = this.store.get('family_settings', 'family')
    return { configured: Boolean(settings?.inviteCodeHash), updatedAt: settings?.inviteCodeUpdatedAt || null }
  }
  setInviteCode(openid, event) {
    this.admin(openid)
    const raw = cleanText(event.inviteCode, 50) || generateInviteCode()
    const record = createInviteRecord(raw)
    this.store.save('family_settings', { ...this.store.get('family_settings', 'family'), _id: 'family', inviteCodeSalt: record.salt, inviteCodeHash: record.hash, inviteCodeUpdatedAt: new Date().toISOString(), inviteCodeUpdatedBy: openid })
    return { inviteCode: formatInviteCode(raw) }
  }
  listMenu(openid, event, tokenHash) {
    const member = this.member(openid)
    const includeDisabled = event.includeDisabled === true && member.role === 'admin'
    const categories = this.store.all('categories').filter((item) => includeDisabled || item.enabled).sort((a, b) => a.sortOrder - b.sortOrder)
    const categoryIds = new Set(categories.map((item) => item._id))
    const dishes = this.store.all('dishes').filter((item) => includeDisabled || item.enabled).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
      const dish = this.picture(item, tokenHash)
      return { ...dish, categoryId: categoryIds.has(dish.categoryId) ? dish.categoryId : UNCATEGORIZED._id }
    })
    return { categories: [...categories, UNCATEGORIZED], dishes, member: this.publicMember(member) }
  }
  getDish(openid, event, tokenHash) {
    const member = this.member(openid)
    const dish = this.store.get('dishes', cleanText(event.dishId, 80))
    if (!dish || (!dish.enabled && member.role !== 'admin')) fail('NOT_FOUND', '菜品不存在或已下架')
    return this.picture(dish, tokenHash)
  }
  saveDish(openid, event) {
    this.admin(openid)
    const dish = cleanDish(event.dish || {})
    if (dish.categoryId === UNCATEGORIZED._id) dish.categoryId = ''
    if (dish.categoryId && !this.store.get('categories', dish.categoryId)) fail('BAD_REQUEST', '分类不存在')
    dish.imageFileId = this.media.ref(dish.imageFileId)
    const id = cleanText(event.dish?._id, 80)
    const existing = id ? this.store.get('dishes', id) : null
    if (id && !existing) fail('NOT_FOUND', '菜品不存在')
    const now = new Date().toISOString()
    const saved = this.store.save('dishes', { ...dish, ...(id ? { _id: id } : {}), createdAt: existing?.createdAt || now, updatedAt: now })
    return { dishId: saved._id }
  }
  toggleDish(openid, event) {
    this.admin(openid)
    const dish = this.store.get('dishes', cleanText(event.dishId, 80))
    if (!dish) fail('NOT_FOUND', '菜品不存在')
    const enabled = event.enabled === true
    this.store.save('dishes', { ...dish, enabled, updatedAt: new Date().toISOString() })
    return { dishId: dish._id, enabled }
  }
  uploadDishImage(openid, event, tokenHash) {
    this.admin(openid)
    return { fileID: this.media.url(this.media.upload(event), tokenHash) }
  }
  createOrder(openid, event) {
    const member = this.member(openid)
    const payload = event.payload || {}
    const key = cleanText(payload.idempotencyKey, 80)
    if (!key) fail('BAD_REQUEST', '缺少提交标识')
    return this.store.transaction(() => {
      const previous = this.store.findOrder(openid, key)
      if (previous) return { orderId: previous._id, duplicated: true }
      const selections = payload.items
      if (!Array.isArray(selections) || selections.length < 1 || selections.length > 20) fail('BAD_REQUEST', '请选择 1 到 20 道菜')
      const seen = new Set()
      const items = selections.map((selection) => {
        const id = cleanText(selection?.dishId, 80)
        if (!id || seen.has(id)) fail('BAD_REQUEST', '菜品标识无效或重复')
        seen.add(id)
        const dish = this.store.get('dishes', id)
        if (!dish?.enabled) fail('BAD_REQUEST', '部分菜品已下架，请刷新菜单')
        try { return createItemSnapshot(dish, selection.servings) }
        catch { fail('BAD_REQUEST', '份数必须是 1 到 20 的整数') }
      })
      let diners
      try { diners = normalizeServings(payload.dinerCount) }
      catch { fail('BAD_REQUEST', '就餐人数请填写 1 到 20 的整数') }
      const now = new Date().toISOString()
      const order = this.store.save('orders', { orderDate: chinaDate(), creatorOpenid: openid, creatorName: member.nickname, dinerCount: diners, items, remark: cleanText(payload.remark, 300), status: 'pending', ingredientSummary: aggregateIngredients(items), idempotencyKey: key, createdAt: now, updatedAt: now })
      return { orderId: order._id, duplicated: false }
    })
  }
  publicOrder(order, tokenHash) {
    const { creatorOpenid, idempotencyKey, ...visible } = order
    return { ...visible, items: visible.items.map((item) => this.picture(item, tokenHash)) }
  }
  listOrders(openid, event, tokenHash) {
    const member = this.member(openid)
    const date = cleanText(event.orderDate, 10) || chinaDate()
    const admin = member.role === 'admin'
    return { orders: this.store.listOrders(openid, date, admin).map((order) => this.publicOrder(order, tokenHash)), isAdmin: admin, orderDate: date }
  }
  getOrder(openid, event, tokenHash) {
    const member = this.member(openid)
    const order = this.store.get('orders', cleanText(event.orderId, 80))
    if (!order) fail('NOT_FOUND', '订单不存在')
    if (member.role !== 'admin' && order.creatorOpenid !== openid) fail('FORBIDDEN', '你无权查看此订单')
    return { order: this.publicOrder(order, tokenHash), isAdmin: member.role === 'admin' }
  }
  updateOrderStatus(openid, event) {
    this.admin(openid)
    return this.store.transaction(() => {
      const order = this.store.get('orders', cleanText(event.orderId, 80))
      if (!order) fail('NOT_FOUND', '订单不存在')
      if (!canTransitionStatus(order.status, event.status)) fail('BAD_REQUEST', '不允许这样修改订单状态')
      this.store.save('orders', { ...order, status: event.status, updatedAt: new Date().toISOString() })
      return { status: event.status }
    })
  }
}

module.exports = { Service, chinaDate }
