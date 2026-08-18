const cloud = require('wx-server-sdk')
const {
  aggregateIngredients,
  canTransitionStatus,
  createItemSnapshot,
  normalizeServings
} = require('./lib/domain')
const {
  createInviteRecord,
  formatInviteCode,
  generateInviteCode,
  verifyInviteCode
} = require('./lib/invite')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTIONS = {
  members: 'family_members',
  categories: 'categories',
  dishes: 'dishes',
  orders: 'orders',
  settings: 'family_settings'
}

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function chinaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

async function getMember(openid, required = true) {
  const result = await db.collection(COLLECTIONS.members).where({ openid, enabled: true }).limit(1).get()
  const member = result.data[0] || null
  if (required && !member) fail('UNAUTHORIZED', '你还不在家庭成员名单中')
  return member
}

function requireAdmin(member) {
  if (!member || member.role !== 'admin') fail('FORBIDDEN', '只有管理员可以执行此操作')
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max)
}

function cleanIngredient(item) {
  const name = cleanText(item && item.name, 30)
  if (!name) fail('BAD_REQUEST', '原料名称不能为空')
  const rawQuantity = item.quantity
  const numberQuantity = typeof rawQuantity === 'number' || /^\d+(\.\d+)?$/.test(String(rawQuantity || '').trim())
    ? Number(rawQuantity)
    : cleanText(rawQuantity, 20)
  if (numberQuantity === '' || (typeof numberQuantity === 'number' && numberQuantity < 0)) {
    fail('BAD_REQUEST', `请填写 ${name} 的正确用量`)
  }
  return {
    name,
    quantity: numberQuantity,
    unit: cleanText(item.unit, 10),
    type: item.type === 'main' ? 'main' : 'seasoning',
    note: cleanText(item.note, 80)
  }
}

function cleanDish(payload) {
  const name = cleanText(payload.name, 40)
  const categoryId = cleanText(payload.categoryId, 80)
  if (!name || !categoryId) fail('BAD_REQUEST', '菜品名称和分类必填')
  const steps = (payload.steps || []).map((step) => cleanText(step, 300)).filter(Boolean)
  const ingredients = (payload.ingredients || [])
    .filter((item) => cleanText(item && item.name, 30))
    .map(cleanIngredient)
  if (!ingredients.length) fail('BAD_REQUEST', '至少填写一种原料')
  if (!steps.length) fail('BAD_REQUEST', '至少填写一个制作步骤')
  return {
    name,
    categoryId,
    description: cleanText(payload.description, 300),
    imageFileId: cleanText(payload.imageFileId, 500),
    defaultServings: normalizeServings(payload.defaultServings),
    cookingTime: Math.max(0, Math.min(1440, Number(payload.cookingTime) || 0)),
    ingredients,
    steps,
    enabled: payload.enabled !== false
  }
}

async function getProfile(openid) {
  const member = await getMember(openid, false)
  return {
    openid,
    authorized: Boolean(member),
    member: member ? {
      _id: member._id,
      nickname: member.nickname,
      role: member.role,
      enabled: member.enabled
    } : null
  }
}

async function getFamilySettings() {
  try {
    const result = await db.collection(COLLECTIONS.settings).doc('family').get()
    return result.data || null
  } catch (error) {
    return null
  }
}

async function joinFamily(openid, event) {
  const existingResult = await db.collection(COLLECTIONS.members).where({ openid }).limit(1).get()
  const existing = existingResult.data[0]
  if (existing) {
    if (!existing.enabled) fail('ACCOUNT_DISABLED', '这个微信账号已被停用，请联系家庭管理员')
    return { joined: false, member: existing }
  }

  const settings = await getFamilySettings()
  if (!settings || !settings.inviteCodeHash || !settings.inviteCodeSalt) {
    fail('INVITE_NOT_CONFIGURED', '家庭管理员还没有设置邀请码')
  }
  const valid = verifyInviteCode(event.inviteCode, {
    salt: settings.inviteCodeSalt,
    hash: settings.inviteCodeHash
  })
  if (!valid) fail('INVALID_INVITE_CODE', '邀请码不正确，请向家庭管理员确认')

  const nickname = cleanText(event.nickname, 20) || '家人'
  const data = {
    openid,
    nickname,
    role: 'member',
    enabled: true,
    joinedByInvite: true,
    createdAt: db.serverDate()
  }
  try {
    const result = await db.collection(COLLECTIONS.members).add({ data })
    return { joined: true, member: { _id: result._id, ...data } }
  } catch (error) {
    const concurrent = await db.collection(COLLECTIONS.members).where({ openid, enabled: true }).limit(1).get()
    if (concurrent.data[0]) return { joined: false, member: concurrent.data[0] }
    throw error
  }
}

async function getInviteStatus(openid) {
  const member = await getMember(openid)
  requireAdmin(member)
  const settings = await getFamilySettings()
  return {
    configured: Boolean(settings && settings.inviteCodeHash && settings.inviteCodeSalt),
    updatedAt: settings && settings.inviteCodeUpdatedAt ? settings.inviteCodeUpdatedAt : null
  }
}

async function setInviteCode(openid, event) {
  const member = await getMember(openid)
  requireAdmin(member)
  const rawCode = cleanText(event.inviteCode, 50) || generateInviteCode()
  const record = createInviteRecord(rawCode)
  await db.collection(COLLECTIONS.settings).doc('family').set({
    data: {
      inviteCodeSalt: record.salt,
      inviteCodeHash: record.hash,
      inviteCodeUpdatedAt: db.serverDate(),
      inviteCodeUpdatedBy: openid
    }
  })
  return { inviteCode: formatInviteCode(rawCode) }
}

async function listMenu(openid, event) {
  const member = await getMember(openid)
  const includeDisabled = event.includeDisabled === true && member.role === 'admin'
  const [categories, dishes] = await Promise.all([
    db.collection(COLLECTIONS.categories).where(includeDisabled ? {} : { enabled: true }).orderBy('sortOrder', 'asc').get(),
    db.collection(COLLECTIONS.dishes).where(includeDisabled ? {} : { enabled: true }).orderBy('updatedAt', 'desc').limit(100).get()
  ])
  return { categories: categories.data, dishes: dishes.data, member }
}

async function getDish(openid, event) {
  const member = await getMember(openid)
  const result = await db.collection(COLLECTIONS.dishes).doc(cleanText(event.dishId, 80)).get()
  if (!result.data || (!result.data.enabled && member.role !== 'admin')) fail('NOT_FOUND', '菜品不存在或已下架')
  return result.data
}

async function createOrder(openid, event) {
  const member = await getMember(openid)
  const payload = event.payload || {}
  const idempotencyKey = cleanText(payload.idempotencyKey, 80)
  if (!idempotencyKey) fail('BAD_REQUEST', '缺少提交标识')

  const previous = await db.collection(COLLECTIONS.orders).where({ creatorOpenid: openid, idempotencyKey }).limit(1).get()
  if (previous.data[0]) return { orderId: previous.data[0]._id, duplicated: true }

  const selections = Array.isArray(payload.items) ? payload.items : []
  if (!selections.length || selections.length > 20) fail('BAD_REQUEST', '请选择 1 到 20 道菜')
  const ids = [...new Set(selections.map((item) => cleanText(item.dishId, 80)).filter(Boolean))]
  const dishResult = await db.collection(COLLECTIONS.dishes).where({ _id: _.in(ids), enabled: true }).get()
  const dishMap = new Map(dishResult.data.map((dish) => [dish._id, dish]))
  if (dishMap.size !== ids.length) fail('BAD_REQUEST', '部分菜品已下架，请刷新菜单')

  const items = selections.map((selection) => createItemSnapshot(dishMap.get(selection.dishId), selection.servings))
  const ingredientSummary = aggregateIngredients(items.map((item) => ({ ...item, dishName: item.name })))
  const now = db.serverDate()
  const data = {
    orderDate: chinaDate(),
    creatorOpenid: openid,
    creatorName: member.nickname,
    dinerCount: normalizeServings(payload.dinerCount),
    items,
    remark: cleanText(payload.remark, 300),
    status: 'pending',
    ingredientSummary,
    idempotencyKey,
    createdAt: now,
    updatedAt: now
  }
  try {
    const result = await db.collection(COLLECTIONS.orders).add({ data })
    return { orderId: result._id, duplicated: false }
  } catch (error) {
    const existing = await db.collection(COLLECTIONS.orders).where({ creatorOpenid: openid, idempotencyKey }).limit(1).get()
    if (existing.data[0]) return { orderId: existing.data[0]._id, duplicated: true }
    throw error
  }
}

async function listOrders(openid, event) {
  const member = await getMember(openid)
  const requestedDate = cleanText(event.orderDate, 10) || chinaDate()
  const where = member.role === 'admin'
    ? { orderDate: requestedDate }
    : { creatorOpenid: openid }
  const result = await db.collection(COLLECTIONS.orders).where(where).orderBy('createdAt', 'desc').limit(100).get()
  return { orders: result.data, isAdmin: member.role === 'admin', orderDate: requestedDate }
}

async function getOrder(openid, event) {
  const member = await getMember(openid)
  const result = await db.collection(COLLECTIONS.orders).doc(cleanText(event.orderId, 80)).get()
  const order = result.data
  if (!order) fail('NOT_FOUND', '订单不存在')
  if (member.role !== 'admin' && order.creatorOpenid !== openid) fail('FORBIDDEN', '你无权查看此订单')
  return { order, isAdmin: member.role === 'admin' }
}

async function updateOrderStatus(openid, event) {
  const member = await getMember(openid)
  requireAdmin(member)
  const orderId = cleanText(event.orderId, 80)
  const nextStatus = cleanText(event.status, 20)
  const result = await db.collection(COLLECTIONS.orders).doc(orderId).get()
  if (!result.data) fail('NOT_FOUND', '订单不存在')
  if (!canTransitionStatus(result.data.status, nextStatus)) fail('BAD_REQUEST', '不允许这样修改订单状态')
  await db.collection(COLLECTIONS.orders).doc(orderId).update({ data: { status: nextStatus, updatedAt: db.serverDate() } })
  return { status: nextStatus }
}

async function saveDish(openid, event) {
  const member = await getMember(openid)
  requireAdmin(member)
  const dish = cleanDish(event.dish || {})
  const dishId = cleanText(event.dish && event.dish._id, 80)
  if (dishId) {
    await db.collection(COLLECTIONS.dishes).doc(dishId).update({ data: { ...dish, updatedAt: db.serverDate() } })
    return { dishId }
  }
  const result = await db.collection(COLLECTIONS.dishes).add({ data: { ...dish, createdAt: db.serverDate(), updatedAt: db.serverDate() } })
  return { dishId: result._id }
}

async function toggleDish(openid, event) {
  const member = await getMember(openid)
  requireAdmin(member)
  const dishId = cleanText(event.dishId, 80)
  await db.collection(COLLECTIONS.dishes).doc(dishId).update({ data: { enabled: event.enabled === true, updatedAt: db.serverDate() } })
  return { dishId, enabled: event.enabled === true }
}

async function uploadDishImage(openid, event) {
  const member = await getMember(openid)
  requireAdmin(member)
  const extension = cleanText(event.extension, 8).toLowerCase()
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) fail('BAD_REQUEST', '只支持 JPG、PNG 或 WebP 图片')
  if (!event.base64) fail('BAD_REQUEST', '没有收到图片内容')
  const fileContent = Buffer.from(event.base64, 'base64')
  if (!fileContent.length || fileContent.length > 3 * 1024 * 1024) fail('BAD_REQUEST', '图片需小于 3MB')
  const result = await cloud.uploadFile({
    cloudPath: `dish-images/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`,
    fileContent
  })
  return { fileID: result.fileID }
}

const actions = {
  getProfile,
  joinFamily,
  getInviteStatus,
  setInviteCode,
  listMenu,
  getDish,
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
  saveDish,
  toggleDish,
  uploadDishImage
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const action = actions[event.action]
  if (!action) return { ok: false, error: { code: 'BAD_REQUEST', message: '未知操作' } }
  try {
    const data = await action(OPENID, event)
    return { ok: true, data }
  } catch (error) {
    console.error(event.action, error)
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.code ? error.message : '服务暂时不可用，请稍后重试'
      }
    }
  }
}
