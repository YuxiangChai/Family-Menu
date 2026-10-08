const test = require('node:test')
const assert = require('node:assert/strict')
let definition
global.Page = (page) => { definition = page }
require('../miniprogram/pages/cart/index')
const api = require('../miniprogram/utils/api')

test('相同订单失败重试复用标识，修改订单后使用新标识', async (t) => {
  const previous = api.call
  t.after(() => { api.call = previous })
  const submissions = []
  api.call = async (_action, body) => {
    submissions.push(body.payload)
    throw new Error('模拟网络故障')
  }
  const context = { ...definition, data: { ...definition.data, items: [{ dishId: 'dish', servings: 1 }] }, setData(patch) { Object.assign(this.data, patch) } }
  await context.submitOrder()
  await context.submitOrder()
  assert.equal(submissions[0].idempotencyKey, submissions[1].idempotencyKey)
  context.data.remark = '改为少盐'
  await context.submitOrder()
  assert.notEqual(submissions[1].idempotencyKey, submissions[2].idempotencyKey)
})
