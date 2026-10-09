const DEFAULT_CATEGORIES = [
  ['cat-home', '家常热菜'], ['cat-meat', '肉类'], ['cat-seafood', '鱼虾海鲜'],
  ['cat-vegetable', '蔬菜豆制品'], ['cat-egg', '蛋类'], ['cat-soup', '汤羹'],
  ['cat-staple', '米面主食'], ['cat-snack', '凉菜小食'], ['cat-dessert', '甜品饮品']
]
const OLD_NAMES = { 'cat-home': '家常小炒', 'cat-meat': '肉香满屋', 'cat-soup': '汤汤水水' }

function migrateCategories(store) {
  if (store.get('family_settings', '_categories-v2')) return
  store.transaction(() => {
    DEFAULT_CATEGORIES.forEach(([id, name], index) => {
      const previous = store.get('categories', id)
      if (!previous || previous.name === OLD_NAMES[id]) {
        store.save('categories', { ...previous, _id: id, name, sortOrder: (index + 1) * 10, enabled: previous?.enabled ?? true })
      }
    })
    store.save('family_settings', { _id: '_categories-v2', migratedAt: new Date().toISOString() })
  })
}

module.exports = { migrateCategories, DEFAULT_CATEGORIES }
