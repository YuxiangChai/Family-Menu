const test = require('node:test')
const assert = require('node:assert/strict')

const cart = require('../miniprogram/utils/cart')

test('首次加入菜品固定为 1 份，再次加入才增加份数', () => {
  let stored = []
  global.wx = {
    getStorageSync() {
      return stored
    },
    setStorageSync(_key, value) {
      stored = value
    }
  }

  const dish = {
    _id: 'soup-1',
    name: '紫菜蛋花汤',
    defaultServings: 2
  }

  cart.addDish(dish)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].servings, 1)
  assert.equal(stored[0].defaultServings, 2)

  cart.addDish(dish)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].servings, 2)
})
