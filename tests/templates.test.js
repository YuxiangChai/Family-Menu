const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../miniprogram')

test('分类按钮按文字宽度排列，紧凑留白且不拉伸或换行', () => {
  const css = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
  assert.match(css, /\.category-pill\s*\{[^}]*flex: 0 0 auto;[^}]*width: auto;[^}]*min-width: 0;[^}]*min-height: 62rpx;[^}]*padding: 12rpx 18rpx;[^}]*white-space: nowrap;/)
})

test('分享操作与图片同宽；修改和再点一次集中在图片下方，无重复操作和小字说明', () => {
  const template = fs.readFileSync(path.join(root, 'pages/order-detail/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(root, 'pages/order-detail/index.wxss'), 'utf8')
  const sharing = template.slice(template.indexOf('class="section card share-section"'), template.indexOf('食材清单'))
  assert(sharing.includes('bindtap="shareImage"'))
  assert(sharing.includes('bindtap="editOrder"'))
  assert(sharing.includes('bindtap="copyOrder"'))
  assert(!template.includes('copy-hint'))
  assert(!template.includes('bindtap="saveImage"'))
  assert(!template.includes('>重新生成<'))
  assert.match(template, /wx:if="\{\{posterError\}\}"[\s\S]*?bindtap="generateImage"/)
  assert.match(style, /\.share-section \.share-button\s*\{[^}]*width: 100%;[^}]*max-width: none;/)
})

test('订单卡片底部为黑色分享和再点一次；详情不重复展示分享图里的菜品列表', () => {
  const list = fs.readFileSync(path.join(root, 'pages/orders/index.wxml'), 'utf8')
  assert.match(list, /\{\{item.timeText\}\} · \{\{item.dinerCount\}\} 人用餐/)
  assert.match(list, /catchtap="shareOrder"/)
  assert.match(list, /class="primary-button order-button"[^>]*catchtap="shareOrder"/)
  assert.match(list, /catchtap="copyOrder"/)
  assert.match(list, /item.previewItems/)
  assert.match(list, /还有 \{\{item.remainingCount\}\} 道菜/)
  assert(!list.includes('version-chip'))
  const detail = fs.readFileSync(path.join(root, 'pages/order-detail/index.wxml'), 'utf8')
  assert(!detail.includes('今晚吃什么'))
  assert(!detail.includes('wx:for="{{order.items}}"'))
  assert(!detail.includes('第 {{order.revision}} 版'))
  assert(fs.existsSync(path.join(root, 'images/dish-placeholder.png')))
})

test('后台修改订单页只展示修改状态，不展示版本号', () => {
  const template = fs.readFileSync(path.join(root, 'pages/cart/index.wxml'), 'utf8')
  assert(template.includes('正在修改订单'))
  assert(!template.includes('{{revision}}'))
  assert(!template.includes('正在编辑第'))
})

test('历史订单无今日切换，卡片突出日期和星期，窄屏允许日期行自然换行', () => {
  const template = fs.readFileSync(path.join(root, 'pages/orders/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(root, 'pages/orders/index.wxss'), 'utf8')
  assert(!/今日订单|scope-tab|changeScope/.test(template))
  assert.match(template, /class="order-date"[^>]*>\{\{item.dateText\}\}/)
  assert.match(template, /class="order-weekday"[^>]*>\{\{item.weekdayText\}\}/)
  assert.match(style, /\.order-date\s*\{[^}]*font-size: 42rpx;[^}]*font-weight: 800;/)
  assert.match(style, /\.order-date-row\s*\{[^}]*flex-wrap: wrap;/)
})

test('首页直接移除已选菜，绿色区分；按钮固定单行且份数控件已移除', () => {
  const home = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
  assert(home.includes("dish.selected ? '已选 · 移除' : '今晚想吃'"))
  assert(home.includes('data-selected="{{dish.selected}}"'))
  assert(home.includes('disabled="{{!menuReady || !!changingDishId}}"'))
  assert(css.includes('flex: 0 0 164rpx'))
  assert(css.includes('white-space: nowrap'))
  assert(css.includes('background: var(--leaf)'))
  for (const page of ['cart', 'orders', 'dish-detail', 'dish-edit']) {
    const template = fs.readFileSync(path.join(root, `pages/${page}/index.wxml`), 'utf8')
    assert(!template.includes('servings'))
    assert(!template.includes('defaultServings'))
  }
})

test('首页只保留贴近原生底部栏的当前菜单按钮，文字数字紧凑且保持单行和点击区域', () => {
  const template = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8')
  assert(!template.includes('查看当前菜单'))
  assert(!/menu-dock-hint|全家正在一起点菜|全家正在修改订单/.test(template))
  assert.match(template, /class="menu-dock"[\s\S]*class="cart-fab"/)
  assert.match(style, /\.menu-dock\s*\{[^}]*bottom: 0;/)
  assert.match(style, /\.menu-dock \.cart-fab\s*\{[^}]*min-width: 188rpx;[^}]*min-height: 88rpx;[^}]*white-space: nowrap;/)
  assert.match(style, /\.cart-pill\s*\{[^}]*justify-content: center;[^}]*gap: 8rpx;/)
  assert(4 * 24 + 36 + 8 + 2 * 18 <= 188)
  assert.match(style, /\.cart-label\s*\{[^}]*flex: none;[^}]*white-space: nowrap;/)
  assert.match(style, /\.dish-action\s*\{[^}]*min-height: 88rpx;/)
  assert.match(style, /\.dish-body \.add-button\s*\{[^}]*height: 58rpx;/)
})

test('历史卡片仅显示加大加粗的用户称呼，详情按内容高度布局，不禁用长菜单滚动', () => {
  const list = fs.readFileSync(path.join(root, 'pages/orders/index.wxml'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'pages/orders/index.wxss'), 'utf8')
  assert.match(list, /class="creator">\{\{item.creatorName \|\| '家人'\}\}<\/view>/)
  assert(!list.includes('的菜单'))
  assert.match(css, /\.creator\s*\{[^}]*font-size: 34rpx;[^}]*font-weight: 800;/)
  const detail = fs.readFileSync(path.join(root, 'pages/order-detail/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(root, 'pages/order-detail/index.wxss'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'pages/order-detail/index.json'), 'utf8'))
  assert(detail.includes('class="page order-detail-page"'))
  assert(detail.includes('{{order.dateText}}'))
  assert(detail.includes('{{order.weekdayText}}'))
  assert.match(style, /\.order-detail-page\s*\{[^}]*min-height: 0;[^}]*padding-bottom: calc\(24rpx \+ env\(safe-area-inset-bottom\)\);/)
  assert.notEqual(config.disableScroll, true)
  assert(!/overflow:\s*hidden/.test(style))
})

test('全部 WXML 标签正确嵌套；新增页面已注册且文件齐全', () => {
  const files = fs.readdirSync(root, { recursive: true }).filter((file) => file.endsWith('.wxml'))
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const stack = []
    const tags = source.matchAll(/<\/?([\w:-]+)\b(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>/g)
    for (const match of tags) {
      if (match[0].startsWith('</')) assert.equal(stack.pop(), match[1], `${file}: ${match[0]} 闭合标签不匹配`)
      else if (!match[0].endsWith('/>')) stack.push(match[1])
    }
    assert.deepEqual(stack, [], `${file}: 标签未闭合`)
  }
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert(app.pages.includes('pages/family-members/index'))
  for (const page of app.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) assert(fs.existsSync(path.join(root, `${page}.${extension}`)), `${page}.${extension} 不存在`)
})
