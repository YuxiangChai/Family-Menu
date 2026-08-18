const KEY = 'tonight-menu-v1'

function getCart() {
  return wx.getStorageSync(KEY) || []
}

function saveCart(items) {
  wx.setStorageSync(KEY, items)
  return items
}

function addDish(dish) {
  const cart = getCart()
  const existing = cart.find((item) => item.dishId === dish._id)
  if (existing) {
    existing.servings = Math.min(20, existing.servings + 1)
  } else {
    cart.push({
      dishId: dish._id,
      name: dish.name,
      imageFileId: dish.imageFileId || '',
      description: dish.description || '',
      defaultServings: dish.defaultServings || 1,
      servings: 1
    })
  }
  return saveCart(cart)
}

function countCart() {
  return getCart().length
}

module.exports = { addDish, countCart, getCart, saveCart }
