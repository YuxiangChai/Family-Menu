const test = require('node:test')
const assert = require('node:assert/strict')

const {
  aggregateIngredients,
  createItemSnapshot,
  canTransitionStatus,
  normalizeServings
} = require('../lib/domain')

test('相同名称和单位的数字食材按份数缩放后合并', () => {
  const list = aggregateIngredients([
    {
      dishName: '番茄炒蛋',
      servings: 2,
      defaultServings: 2,
      ingredients: [{ name: '鸡蛋', quantity: 3, unit: '个', type: 'main' }]
    },
    {
      dishName: '紫菜蛋花汤',
      servings: 4,
      defaultServings: 2,
      ingredients: [{ name: '鸡蛋', quantity: 1, unit: '个', type: 'main' }]
    }
  ])

  assert.equal(list.length, 1)
  assert.equal(list[0].quantity, 5)
  assert.deepEqual(list[0].sources, ['番茄炒蛋', '紫菜蛋花汤'])
})

test('不同单位或非数字用量不会错误合并', () => {
  const list = aggregateIngredients([
    {
      dishName: '凉拌黄瓜', servings: 2, defaultServings: 2,
      ingredients: [
        { name: '盐', quantity: 2, unit: '克', type: 'seasoning' },
        { name: '香油', quantity: '少许', unit: '', type: 'seasoning' }
      ]
    },
    {
      dishName: '番茄炒蛋', servings: 2, defaultServings: 2,
      ingredients: [
        { name: '盐', quantity: 1, unit: '勺', type: 'seasoning' },
        { name: '香油', quantity: '适量', unit: '', type: 'seasoning' }
      ]
    }
  ])

  assert.equal(list.length, 4)
})

test('订单条目保存菜品和食材快照而不是原对象引用', () => {
  const dish = {
    _id: 'dish-1', name: '红烧肉', imageFileId: 'cloud://image',
    defaultServings: 3,
    ingredients: [{ name: '五花肉', quantity: 500, unit: '克', type: 'main' }]
  }
  const snapshot = createItemSnapshot(dish, 4)
  dish.name = '已改名'
  dish.ingredients[0].quantity = 100

  assert.equal(snapshot.name, '红烧肉')
  assert.equal(snapshot.ingredients[0].quantity, 500)
  assert.equal(snapshot.servings, 4)
})

test('只允许定义好的订单状态流转', () => {
  assert.equal(canTransitionStatus('pending', 'confirmed'), true)
  assert.equal(canTransitionStatus('confirmed', 'cooking'), true)
  assert.equal(canTransitionStatus('cooking', 'completed'), true)
  assert.equal(canTransitionStatus('pending', 'cancelled'), true)
  assert.equal(canTransitionStatus('completed', 'pending'), false)
  assert.equal(canTransitionStatus('pending', 'completed'), false)
})

test('份数只接受 1 到 20 的整数', () => {
  assert.equal(normalizeServings('3'), 3)
  assert.throws(() => normalizeServings(0))
  assert.throws(() => normalizeServings(21))
  assert.throws(() => normalizeServings(1.5))
})
