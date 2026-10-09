const api = require('./api')
const { stablePictures } = require('./stable-media')
let active = null
let isAdmin = false
let epoch = 0
let queue = Promise.resolve()

function remember(result) {
  const menu = result.menu
  active = menu ? { ...menu, items: stablePictures(menu.items || [], active?.menuId === menu.menuId ? active.items : []) } : null
  if (typeof result.isAdmin === 'boolean') isAdmin = result.isAdmin
  return active
}
function getCart() { return active ? active.items : [] }
function countCart() { return getCart().length }
function getDraft() {
  return { menuId: active?.menuId || '', editOrderId: active?.orderId || '',
    dinerCount: active?.dinerCount || 2, remark: active?.remark || '', isAdmin }
}
function requestKey() { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
async function refresh() {
  const expected = epoch
  let result
  try { result = await api.call('getActiveMenu') }
  catch (error) {
    if (['UNAUTHORIZED', 'ACCOUNT_DISABLED', 'AUTH_EXPIRED'].includes(error.code)) remember({ menu: null, isAdmin: false })
    throw error
  }
  if (expected === epoch) remember(result)
  return active
}
function serialize(work) {
  const pending = queue.then(async () => {
    epoch++
    try { return await work() } finally { epoch++ }
  })
  queue = pending.catch(() => {})
  return pending
}
function start(options = {}) {
  return serialize(async () => remember(await api.call('startActiveMenu', options)))
}
function change(menuId, changes, key = requestKey()) {
  return serialize(async () => {
    const result = await api.call('changeActiveMenu', { menuId, ...changes, idempotencyKey: key })
    remember(result)
    return result
  })
}
function selectDish(dishId, selected, menuId = getDraft().menuId) {
  return serialize(async () => {
    // A stale active menu ID must never silently apply to the family's next meal.
    if (!menuId) {
      if (!selected) throw new Error('请刷新当前菜单后再移除')
      menuId = remember(await api.call('startActiveMenu')).menuId
    }
    const result = await api.call('changeActiveMenu', { menuId, addDishIds: selected ? [dishId] : [],
      removeDishIds: selected ? [] : [dishId], idempotencyKey: requestKey() })
    remember(result)
    return result
  })
}
function submit(menuId) {
  return serialize(async () => {
    const result = await api.call('submitActiveMenu', { menuId })
    if (active?.menuId === menuId) active = null
    return result
  })
}
function cancel(menuId) {
  return serialize(async () => {
    await api.call('cancelActiveMenu', { menuId })
    if (active?.menuId === menuId) active = null
  })
}
module.exports = { getCart, countCart, getDraft, refresh, start, change, selectDish, submit, cancel, requestKey }
