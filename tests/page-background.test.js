const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../miniprogram')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

test('全部页面及刷新时窗口底色为暖米色，导航栏和底栏保留原来的独立配色', () => {
  const app = JSON.parse(read('app.json'))
  const canvas = '#F2EDE4'
  for (const key of ['backgroundColor', 'backgroundColorTop', 'backgroundColorBottom']) {
    assert.equal(app.window[key], canvas)
  }
  assert.equal(app.window.navigationBarBackgroundColor, '#F7F1E8')
  assert.equal(app.tabBar.backgroundColor, '#FFFCF7')
  for (const page of app.pages) {
    const config = JSON.parse(read(`${page}.json`))
    for (const key of ['backgroundColor', 'backgroundColorTop', 'backgroundColorBottom']) {
      assert.equal(config[key] || app.window[key], canvas, `${page}: ${key}`)
    }
    assert(!/^page\s*\{[^}]*background/m.test(read(`${page}.wxss`)), `${page} must inherit the global canvas`)
  }
  const css = read('app.wxss')
  assert.match(css, /--canvas:\s*#f2ede4;/)
  assert.match(css, /^page\s*\{[^}]*background: var\(--canvas\);/)
  assert.match(css, /\.page\s*\{[^}]*background: var\(--canvas\);/)
  assert.match(css, /\.bottom-cta\s*\{[^}]*background: rgba\(255, 253, 248, \.97\);/)
  assert.match(css, /\.card\s*\{[^}]*background: var\(--paper\);/)
  const nav = read('components/custom-nav/index.wxss')
  assert.match(nav, /\.nav-fixed\s*\{[^}]*background: rgba\(247, 241, 232, \.98\);/)
  assert.match(read('pages/index/index.wxss'), /\.sticky-tools\s*\{[^}]*background: rgba\(242, 237, 228, \.98\);/)
})

function dishPage(dish, wx = { getImageInfo: ({ src, success }) => success({ path: src }) }) {
  let definition
  vm.runInNewContext(read('pages/dish-detail/index.js'), {
    Page: (page) => { definition = page },
    require: (name) => name.endsWith('/api') ? { call: async () => dish } : {},
    setInterval: () => 1, clearInterval() {}, wx
  })
  return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
}
const footerVisible = (data) => !!(data.dish && !data.loading && !data.error && data.pageReady && data.heroReady)

test('先预加载照片，菜品和底部操作作为同一成功分支一次显示', async () => {
  let imageRequest
  const page = dishPage({ name: '测试菜', imageFileId: 'test.jpg' }, { getImageInfo: (options) => { imageRequest = options } })
  assert.equal(footerVisible(page.data), false)
  const pending = page.onLoad({ id: 'test' })
  await flush()
  assert.equal(imageRequest.src, 'test.jpg')
  assert.equal(page.data.dish, null)
  assert.equal(footerVisible(page.data), false)
  page.onReady()
  assert.equal(footerVisible(page.data), false)
  imageRequest.success({ path: '/tmp/cached-test.jpg' })
  await pending
  assert.equal(page.data.heroSrc, '/tmp/cached-test.jpg')
  assert.equal(footerVisible(page.data), true)
  const retry = page.loadDish()
  assert.equal(footerVisible(page.data), false)
  await flush()
  imageRequest.fail()
  await retry
  assert.equal(page.data.heroSrc, '')
  assert.equal(footerVisible(page.data), true)
  const template = read('pages/dish-detail/index.wxml')
  assert.match(template, /<view wx:else class="detail-content">/)
  assert.match(template, /wx:if="\{\{heroSrc\}\}"[^>]*src="\{\{heroSrc\}\}"[^>]*binderror="onHeroError"/)
})

test('菜品页不再有悬浮固定按钮：菜谱独立滚动，底部操作栏是同一布局的普通节点', () => {
  const template = read('pages/dish-detail/index.wxml')
  const css = read('pages/dish-detail/index.wxss')
  const content = template.slice(template.indexOf('<view wx:else class="detail-content">'), template.lastIndexOf('</view>'))
  const tags = [...content.matchAll(/<\/?view\b[^>]*>/g)]
  let depth = 0, actionDepth
  for (const [tag] of tags) {
    if (tag.startsWith('</')) depth--
    else {
      if (tag.includes('class="detail-actions"')) actionDepth = depth
      depth++
    }
    assert(depth >= 0)
  }
  assert.equal(depth, 0)
  assert.equal(actionDepth, 1, 'bottom actions must be inside the shared content container')
  assert(content.includes('class="title-card card"'))
  assert(!template.includes('bottom-cta'))
  assert(!template.includes('page-with-cta'))
  assert.match(css, /\.dish-screen\s*\{[^}]*height: 100vh;[^}]*display: flex;[^}]*flex-direction: column;/)
  assert.match(css, /\.detail-content\s*\{[^}]*flex: 1;[^}]*min-height: 0;[^}]*display: flex;/)
  assert.match(css, /\.detail-scroll\s*\{[^}]*flex: 1;[^}]*height: 0;/)
  assert.match(css, /\.detail-actions\s*\{[^}]*flex: none;/)
  assert(!/position:\s*fixed|visibility:|animation:|transition:/.test(css))
  assert.equal(JSON.parse(read('pages/dish-detail/index.json')).disableScroll, true)
  assert.match(content, /<scroll-view class="detail-scroll" scroll-y/)
})

test('过期预加载与离开页面后的加载结果不覆盖新菜品', async () => {
  const images = []
  const page = dishPage({ name: '测试菜', imageFileId: 'test.jpg' }, { getImageInfo: (options) => images.push(options) })
  const old = page.onLoad({ id: 'test' }); await flush()
  const latest = page.loadDish(); await flush()
  images[1].success({ path: 'latest.jpg' }); await latest
  images[0].success({ path: 'old.jpg' }); await old
  assert.equal(page.data.heroSrc, 'latest.jpg')
  const leaving = page.loadDish(); await flush()
  page.onUnload()
  images[2].success({ path: 'too-late.jpg' }); await leaving
  assert.equal(page.data.heroSrc, 'latest.jpg')
})

test('无照片的菜品不等待图片事件；网络失败时不显示底部操作', async () => {
  const page = dishPage({ name: '无图菜' })
  page.onReady()
  assert.equal(footerVisible(page.data), false)
  await page.onLoad({ id: 'test' })
  assert.equal(footerVisible(page.data), true)
  page.setData({ error: '网络故障' })
  assert.equal(footerVisible(page.data), false)
})
