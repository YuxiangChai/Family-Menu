const { fail, cleanText, cleanDish } = require('../cloudfunctions/menuService/lib/validation')
const { dishSet, ingredientReferences } = require('./order-domain')
const { SharedMenu, SHARED_ACTIONS } = require('./shared-menu')
const { createInviteRecord, formatInviteCode, generateInviteCode, verifyInviteCode } = require('../cloudfunctions/menuService/lib/invite')

const UNCATEGORIZED = { _id: '__uncategorized__', name: '未分类', sortOrder: 10000, enabled: true }
const ACTIONS = new Set(['getProfile', 'joinFamily', 'getInviteStatus', 'setInviteCode', 'listMenu', 'getDish', 'listOrders', 'getOrder', 'prepareOrderEdit', 'saveDish', 'toggleDish', 'uploadDishImage', 'prepareReorder', 'listFamilyMembers', 'updateFamilyMember'])
function chinaDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }

class Service {
  constructor(store, media) { this.store = store; this.media = media; this.shared = new SharedMenu(this) }
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
  canEditOrder(member) { return Boolean(member.enabled) }
  publicMember(member) {
    if (!member) return null
    return { _id: member._id, nickname: member.nickname, role: member.role, isAdmin: member.role === 'admin', enabled: member.enabled }
  }
  picture(dish, tokenHash) {
    return { ...dish, imageFileId: this.media.url(dish.imageFileId, tokenHash) }
  }
  dispatch(action, identity, event = {}) {
    if (SHARED_ACTIONS.has(action)) return this.shared[action](identity.openid, event, identity.tokenHash)
    if (!ACTIONS.has(action)) fail('BAD_REQUEST', '未知操作')
    return this[action](identity.openid, event, identity.tokenHash)
  }
  getProfile(openid) {
    const member = this.store.member(openid)
    return { openid, authorized: Boolean(member?.enabled), member: member?.enabled ? this.publicMember(member) : null }
  }
  listFamilyMembers(openid) {
    this.admin(openid)
    return { members: this.store.members().map((member) => this.publicMember(member)) }
  }
  updateFamilyMember(openid, event) {
    this.admin(openid)
    return this.store.transaction(() => {
      const member = this.store.memberById(cleanText(event.memberId, 80))
      if (!member) fail('NOT_FOUND', '家庭成员不存在')
      const changes = {}
      if (Object.hasOwn(event, 'nickname')) {
        if (typeof event.nickname !== 'string' || !event.nickname.trim() || Array.from(event.nickname.trim()).length > 20) fail('BAD_REQUEST', '称呼请填写 1 到 20 个字')
        changes.nickname = cleanText(event.nickname, 20)
      }
      if (Object.hasOwn(event, 'role') || Object.hasOwn(event, 'isAdmin')) fail('FORBIDDEN', '管理员权限固定，不能新增或转让')
      if (Object.hasOwn(event, 'isChef')) {
        fail('BAD_REQUEST', '已取消厨师权限，只保留普通用户和管理员')
      }
      if (Object.hasOwn(event, 'enabled')) {
        if (member.role === 'admin') fail('FORBIDDEN', '不能停用或变更管理员账号状态')
        if (typeof event.enabled !== 'boolean') fail('BAD_REQUEST', '账号状态必须是启用或停用')
        changes.enabled = event.enabled
      }
      if (!Object.keys(changes).length) fail('BAD_REQUEST', '请指定要修改的成员属性')
      const saved = this.store.saveMember({ ...member, ...changes, updatedAt: new Date().toISOString() })
      return { member: this.publicMember(saved) }
    })
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
    const member = this.store.saveMember({ openid, nickname: cleanText(event.nickname, 20) || '家人', role: 'member', isChef: false, enabled: true, joinedByInvite: true, createdAt: new Date().toISOString() })
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
  publicOrder(order, tokenHash, member) {
    const { creatorOpenid, idempotencyKey, lastEdit, status, revision, ...visible } = order
    const items = dishSet(visible.items)
    return { ...visible, ingredientSummary: ingredientReferences(items), canEdit: this.canEditOrder(member), items: items.map((item) => {
      // Older orders may predate the first photo. Enrich display only; never rewrite their snapshot.
      const imageFileId = item.imageFileId || this.store.get('dishes', item.dishId)?.imageFileId || ''
      return this.picture({ ...item, imageFileId }, tokenHash)
    }) }
  }
  listOrders(openid, event, tokenHash) {
    const member = this.member(openid)
    const date = cleanText(event.orderDate, 10) || chinaDate()
    const admin = member.role === 'admin'
    const scope = event.scope || 'history'
    if (!['history', 'today'].includes(scope)) fail('BAD_REQUEST', '订单查询范围不正确')
    const result = this.store.listOrders(date, { scope, cursor: event.cursor, limit: event.limit })
    return { orders: result.orders.map((order) => this.publicOrder(order, tokenHash, member)), nextCursor: result.nextCursor, scope, isAdmin: admin, orderDate: date }
  }
  getOrder(openid, event, tokenHash) {
    const member = this.member(openid)
    const order = this.store.get('orders', cleanText(event.orderId, 80))
    if (!order) fail('NOT_FOUND', '订单不存在')
    return { order: this.publicOrder(order, tokenHash, member), isAdmin: member.role === 'admin', canEdit: this.canEditOrder(member, order) }
  }
  prepareReorder(openid, event, tokenHash) {
    const { order } = this.getOrder(openid, event, tokenHash)
    const items = [], unavailable = []
    for (const previous of order.items) {
      const current = this.store.get('dishes', previous.dishId)
      if (!current?.enabled) { unavailable.push(previous.name); continue }
      const dish = this.picture(current, tokenHash)
      items.push({ dishId: dish._id, name: dish.name, imageFileId: dish.imageFileId,
        description: dish.description })
    }
    return { items, unavailable, dinerCount: order.dinerCount, remark: order.remark }
  }
  prepareOrderEdit(openid, event, tokenHash) {
    return this.shared.startActiveMenu(openid, { orderId: event.orderId }, tokenHash)
  }
}

module.exports = { Service, chinaDate }
