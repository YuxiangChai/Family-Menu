const { randomUUID } = require('node:crypto')
const { fail, cleanText } = require('../cloudfunctions/menuService/lib/validation')
const { normalizeServings } = require('../cloudfunctions/menuService/lib/domain')
const { dishSnapshot, dishSet, ingredientReferences } = require('./order-domain')

const CURRENT = '_current-menu'
const SHARED_ACTIONS = new Set(['getActiveMenu', 'startActiveMenu', 'changeActiveMenu', 'submitActiveMenu', 'cancelActiveMenu'])
function id(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) fail('BAD_REQUEST', '缺少或无效的操作标识')
  return value.trim()
}

class SharedMenu {
  constructor(service) { this.service = service; this.store = service.store }
  current() { return this.store.get('family_settings', CURRENT) }
  requireCurrent(menuId) {
    const current = this.current()
    if (!current || current.menuId !== id(menuId)) fail('MENU_CLOSED', '这份菜单已提交或结束，请刷新查看当前菜单')
    return current
  }
  visible(menu, tokenHash) {
    if (!menu) return null
    const { _id, creatorOpenid, ...visible } = menu
    return { ...visible, items: dishSet(menu.items).map((item) => this.service.picture({ ...item,
      imageFileId: item.imageFileId || this.store.get('dishes', item.dishId)?.imageFileId || '' }, tokenHash)) }
  }
  getActiveMenu(openid, event, tokenHash) {
    const member = this.service.member(openid)
    return { menu: this.visible(this.current(), tokenHash), isAdmin: member.role === 'admin' }
  }
  startActiveMenu(openid, event, tokenHash) {
    return this.store.transaction(() => {
      const member = this.service.member(openid)
      const current = this.current()
      const orderId = Object.hasOwn(event, 'orderId') ? id(event.orderId) : ''
      const sourceId = Object.hasOwn(event, 'sourceOrderId') ? id(event.sourceOrderId) : ''
      if (orderId && sourceId) fail('BAD_REQUEST', '不能同时修改和复制订单')
      if (current) {
        if ((orderId && current.orderId !== orderId) || sourceId) fail('ACTIVE_MENU_BUSY', '家里已有一份正在点菜或修改的菜单，请先完成当前菜单')
        return { menu: this.visible(current, tokenHash), joined: true }
      }
      const source = orderId || sourceId ? this.store.get('orders', orderId || sourceId) : null
      if ((orderId || sourceId) && !source) fail('NOT_FOUND', '订单不存在')
      const unavailable = []
      let items = source ? dishSet(source.items) : []
      if (sourceId) {
        items = items.map((previous) => {
          const dish = this.store.get('dishes', previous.dishId)
          if (!dish?.enabled) { unavailable.push(previous.name); return null }
          return dishSnapshot(dish)
        }).filter(Boolean)
        if (!items.length) fail('BAD_REQUEST', '这些菜已下架，请重新选菜')
      }
      const now = new Date().toISOString()
      const menu = this.store.save('family_settings', { _id: CURRENT, menuId: randomUUID(), orderId,
        creatorOpenid: member.openid, creatorName: member.nickname, items,
        dinerCount: source?.dinerCount || 2, remark: source?.remark || '', createdAt: now, updatedAt: now })
      return { menu: this.visible(menu, tokenHash), joined: false, unavailable }
    })
  }
  changeActiveMenu(openid, event, tokenHash) {
    this.service.member(openid)
    const key = id(event.idempotencyKey), menuId = id(event.menuId)
    return this.store.transaction(() => {
      this.service.member(openid)
      const menu = this.requireCurrent(menuId)
      if (this.store.db.prepare('SELECT 1 FROM menu_change_receipts WHERE menu_id=? AND actor_openid=? AND request_key=?').get(menuId, openid, key)) {
        return { menu: this.visible(menu, tokenHash), duplicated: true, changed: false }
      }
      const readIds = (values) => {
        if (!Array.isArray(values) || values.length > 20) fail('BAD_REQUEST', '请提交增删菜操作，每次最多 20 道菜')
        return new Set(values.map(id))
      }
      const additions = readIds(event.addDishIds === undefined ? [] : event.addDishIds), removals = readIds(event.removeDishIds === undefined ? [] : event.removeDishIds)
      if ([...additions].some((dishId) => removals.has(dishId))) fail('BAD_REQUEST', '同一道菜不能同时添加和移除')
      if (Object.hasOwn(event, 'items')) fail('BAD_REQUEST', '不能用整份旧菜单覆盖当前菜单')
      const items = menu.items.filter((item) => !removals.has(item.dishId))
      for (const dishId of additions) {
        if (items.some((item) => item.dishId === dishId)) continue
        const dish = this.store.get('dishes', dishId)
        if (!dish?.enabled) fail('BAD_REQUEST', '新增菜品已下架，请刷新菜单')
        items.push(dishSnapshot(dish))
      }
      if (items.length > 20) fail('BAD_REQUEST', '当前菜单最多 20 道菜，请移除一些菜再添加')
      const changes = {}
      if (Object.hasOwn(event, 'dinerCount')) {
        try { changes.dinerCount = normalizeServings(event.dinerCount) } catch { fail('BAD_REQUEST', '就餐人数请填写 1 到 20 的整数') }
      }
      if (Object.hasOwn(event, 'remark')) changes.remark = cleanText(event.remark, 300)
      const changed = JSON.stringify(items) !== JSON.stringify(menu.items) || Object.keys(changes).some((field) => changes[field] !== menu[field])
      const saved = changed ? this.store.save('family_settings', { ...menu, ...changes, items, updatedAt: new Date().toISOString() }) : menu
      // Deduplication receipts contain no historical menu content.
      this.store.db.prepare('INSERT INTO menu_change_receipts VALUES (?, ?, ?)').run(menuId, openid, key)
      return { menu: this.visible(saved, tokenHash), duplicated: false, changed }
    })
  }
  submitActiveMenu(openid, event) {
    this.service.member(openid)
    const menuId = id(event.menuId)
    return this.store.transaction(() => {
      this.service.member(openid)
      const receipt = this.store.db.prepare('SELECT order_id FROM menu_submission_receipts WHERE menu_id=?').get(menuId)
      if (receipt) return { orderId: receipt.order_id, duplicated: true }
      const menu = this.requireCurrent(menuId)
      if (!menu.items.length && !menu.orderId) fail('BAD_REQUEST', '请先选菜再下单')
      const old = menu.orderId ? this.store.get('orders', menu.orderId) : null
      if (menu.orderId && !old) fail('NOT_FOUND', '订单不存在')
      const now = new Date().toISOString()
      const base = old ? (({ revision, lastEdit, ...value }) => value)(old) : {
        creatorOpenid: menu.creatorOpenid, creatorName: menu.creatorName,
        orderDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
        createdAt: now, status: 'completed', idempotencyKey: `shared:${menuId}`
      }
      const saved = this.store.save('orders', { ...base, items: menu.items, dinerCount: menu.dinerCount,
        remark: menu.remark, ingredientSummary: ingredientReferences(menu.items), updatedAt: now })
      this.store.db.prepare('INSERT INTO menu_submission_receipts VALUES (?, ?)').run(menuId, saved._id)
      this.store.db.prepare('DELETE FROM family_settings WHERE id=?').run(CURRENT)
      return { orderId: saved._id, duplicated: false }
    })
  }
  cancelActiveMenu(openid, event) {
    this.service.admin(openid)
    return this.store.transaction(() => {
      this.service.admin(openid)
      this.requireCurrent(event.menuId)
      this.store.db.prepare('DELETE FROM family_settings WHERE id=?').run(CURRENT)
      return { cancelled: true }
    })
  }
}
module.exports = { SharedMenu, SHARED_ACTIONS }
