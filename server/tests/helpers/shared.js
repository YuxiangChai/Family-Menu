function place(call, who, payload) {
  const { menu } = call(who, 'startActiveMenu')
  call(who, 'changeActiveMenu', { menuId: menu.menuId, addDishIds: payload.items.map((item) => item.dishId),
    dinerCount: payload.dinerCount, remark: payload.remark, idempotencyKey: payload.idempotencyKey })
  return call(who, 'submitActiveMenu', { menuId: menu.menuId })
}
module.exports = { place }
