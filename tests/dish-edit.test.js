const test = require('node:test')
const assert = require('node:assert/strict')
let definition
global.Page = (page) => { definition = page }
require('../miniprogram/pages/dish-edit/index')
const api = require('../miniprogram/utils/api')

test('菜品编辑只填菜名可保存，未分类保持留空，可移除所有原料和步骤', async (t) => {
  const previous = api.call
  t.after(() => { api.call = previous })
  const submitted = []
  api.call = async (action, payload) => {
    if (action === 'listMenu') return { categories: [{ _id: 'cat', name: '分类' }, { _id: '__uncategorized__', name: '未分类' }] }
    submitted.push(payload)
    return { dishId: 'dish' }
  }
  global.wx = { showToast() {}, navigateBack() {} }
  const context = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch) } }
  context.dishId = ''
  await context.loadForm()
  assert.equal(context.data.dish.categoryId, '')
  assert.equal(context.data.categoryIndex, 0)
  context.data.dish.name = '只填菜名'
  await context.saveDish()
  assert.equal(submitted.length, 1)
  assert.deepEqual(submitted[0].dish.ingredients, [])
  assert.deepEqual(submitted[0].dish.steps, [])
  context.data.dish.ingredients = [{ name: '盐' }]
  context.removeIngredient({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(context.data['dish.ingredients'], [])
  context.data.dish.steps = ['步骤']
  context.removeStep({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(context.data['dish.steps'], [])
})
