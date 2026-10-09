const { aggregateIngredients, createItemSnapshot } = require('../cloudfunctions/menuService/lib/domain')

function dishSnapshot(dish) {
  const { servings, defaultServings, ...item } = createItemSnapshot(dish, 1)
  return item
}
function dishSet(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (seen.has(item.dishId)) return false
    seen.add(item.dishId)
    return true
  }).map(({ servings, defaultServings, ...item }) => item)
}
function ingredientReferences(items) {
  return aggregateIngredients(items.map((item) => ({ ...item, servings: 1, defaultServings: 1 })))
}
module.exports = { dishSnapshot, dishSet, ingredientReferences }
