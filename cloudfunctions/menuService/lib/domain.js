const STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cooking', 'cancelled'],
  cooking: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
}

function normalizeServings(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 20) {
    throw new Error('份数必须是 1 到 20 的整数')
  }
  return number
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createItemSnapshot(dish, servings) {
  return {
    dishId: dish._id,
    name: dish.name,
    imageFileId: dish.imageFileId || '',
    description: dish.description || '',
    defaultServings: normalizeServings(dish.defaultServings || 1),
    servings: normalizeServings(servings),
    cookingTime: Number(dish.cookingTime) || 0,
    ingredients: clone(Array.isArray(dish.ingredients) ? dish.ingredients : []),
    steps: clone(Array.isArray(dish.steps) ? dish.steps : [])
  }
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function aggregateIngredients(items) {
  const numeric = new Map()
  const loose = []

  items.forEach((item) => {
    const ratio = normalizeServings(item.servings) / normalizeServings(item.defaultServings || 1)
    ;(item.ingredients || []).forEach((ingredient) => {
      const name = String(ingredient.name || '').trim()
      const unit = String(ingredient.unit || '').trim()
      if (!name) return

      const quantity = ingredient.quantity
      const normalized = {
        name,
        quantity,
        unit,
        type: ingredient.type === 'main' ? 'main' : 'seasoning',
        note: String(ingredient.note || '').trim(),
        sources: [item.dishName || item.name]
      }

      if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
        loose.push(normalized)
        return
      }

      const key = `${name}\u0000${unit}`
      const scaled = roundQuantity(quantity * ratio)
      if (!numeric.has(key)) {
        numeric.set(key, { ...normalized, quantity: scaled })
        return
      }

      const current = numeric.get(key)
      current.quantity = roundQuantity(current.quantity + scaled)
      if (!current.sources.includes(item.dishName || item.name)) {
        current.sources.push(item.dishName || item.name)
      }
    })
  })

  return [...numeric.values(), ...loose]
}

function canTransitionStatus(from, to) {
  return Boolean(STATUS_TRANSITIONS[from] && STATUS_TRANSITIONS[from].includes(to))
}

module.exports = {
  STATUS_TRANSITIONS,
  aggregateIngredients,
  canTransitionStatus,
  createItemSnapshot,
  normalizeServings
}
