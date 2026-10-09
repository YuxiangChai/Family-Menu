const test = require('node:test')
const assert = require('node:assert/strict')
const api = require('../miniprogram/utils/api')
let definition
global.Page = (page) => { definition = page }
require('../miniprogram/pages/notifications/index')

test('订阅入口由用户点击直接调起弹窗，只记录当前模板的选择且不发消息', async (t) => {
  const previous = api.call
  t.after(() => { api.call = previous })
  const calls = []
  api.call = async (action, payload) => { calls.push({ action, payload }); return { enabled: true, configured: true, templateId: 'test-template' } }
  let options
  global.wx = { requestSubscribeMessage: (value) => { options = value }, showToast() {} }
  const context = { ...definition, data: { status: { configured: true, templateId: 'test-template' }, subscribing: false }, setData(value) { Object.assign(this.data, value) } }
  context.subscribe()
  assert(options)
  assert.deepEqual(options.tmplIds, ['test-template'])
  assert.equal(calls.length, 0)
  assert.equal(context.data.subscribing, true)
  await options.success({ 'test-template': 'accept' })
  assert.deepEqual(calls, [{ action: 'recordSubscription', payload: { templateId: 'test-template', result: 'accept' } }])
  assert.equal(context.data.subscribing, false)
  context.data.status.configured = false
  options = null
  context.subscribe()
  assert.equal(options, null)
})
