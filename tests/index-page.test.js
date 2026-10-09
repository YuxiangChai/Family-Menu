const test = require('node:test')
const assert = require('node:assert/strict')

let pageDefinition
let scrollOptions

global.Page = (definition) => { pageDefinition = definition }
global.wx = {
  pageScrollTo(options) { scrollOptions = options }
}

require('../miniprogram/pages/index/index')

function pageContext(data) {
  return {
    ...pageDefinition,
    data,
    setData(patch) {
      this.data = { ...this.data, ...patch }
    }
  }
}

test('首页把菜品按分类连续分组，不再用分类隐藏其他菜', () => {
  const context = pageContext({
    keyword: '',
    categories: [
      { _id: 'meat', name: '荤菜', anchorId: 'menu-section-0' },
      { _id: 'soup', name: '汤', anchorId: 'menu-section-1' }
    ],
    dishes: [
      { _id: 'a', name: '红烧肉', categoryId: 'meat' },
      { _id: 'b', name: '紫菜汤', categoryId: 'soup' }
    ]
  })

  pageDefinition.applyFilters.call(context)

  assert.equal(context.data.sections.length, 2)
  assert.equal(context.data.sections[0].dishes[0].name, '红烧肉')
  assert.equal(context.data.sections[1].dishes[0].name, '紫菜汤')
})

test('点击分类按钮滚动到对应分类标题', () => {
  const context = pageContext({ activeCategory: '' })

  pageDefinition.selectCategory.call(context, {
    currentTarget: { dataset: { id: 'soup', anchor: 'menu-section-1' } }
  })

  assert.equal(context.data.activeCategory, 'soup')
  assert.equal(scrollOptions.selector, '#menu-section-1')
  assert.equal(scrollOptions.offsetTop, -176)
  assert.equal(scrollOptions.duration, 280)
})
