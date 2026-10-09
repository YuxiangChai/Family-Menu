const { DEFAULT_DISH_IMAGE } = require('./order-images')

function beijingTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
}

function wrapText(text, maxWidth, measure) {
  const lines = []
  for (const paragraph of String(text || '').split('\n')) {
    let line = ''
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > maxWidth) { lines.push(line); line = '' }
      line += character
    }
    lines.push(line)
  }
  return lines
}

// Draw only menu content and image pixels, never identity, tokens or signed URLs.
function posterLayout(order, measure = (text, size) => Array.from(text).reduce((sum, c) => sum + (/[\x00-\xff]/.test(c) ? size * 0.6 : size), 0)) {
  const width = 600, texts = [], rules = [], images = []
  let y = 52
  const text = (value, size = 26, color = '#282b25', maxWidth = 504, weight = 'normal', x = 48) => {
    for (const line of wrapText(value, maxWidth, (s) => measure(s, size, weight))) {
      texts.push({ text: line, x, y, size, color, weight }); y += Math.ceil(size * 1.55)
    }
  }
  const rule = () => { rules.push(y + 12); y += 44 }
  text('小柴的菜单 · 家人点菜', 23, '#b94732', 504, 'bold')
  y += 10
  text('今晚一起吃', 44, '#282b25', 504, 'bold')
  text(`${order.creatorName || '家人'} 点菜 · ${order.dinerCount} 人用餐`, 26)
  text(`下单 ${beijingTime(order.createdAt)}`, 21, '#64685f')
  if (order.updatedAt && order.updatedAt !== order.createdAt) text(`最近修改 ${beijingTime(order.updatedAt)}`, 21, '#64685f')
  rule()
  order.items.forEach((item, index) => {
    const top = y
    const size = 29, lineHeight = Math.ceil(size * 1.55)
    const lines = wrapText(`${index + 1}. ${item.name}`, 384, (value) => measure(value, size, 'bold'))
    const textHeight = (lines.length - 1) * lineHeight + size
    const rowHeight = Math.max(96, textHeight)
    images.push({ index, x: 48, y: top + (rowHeight - 96) / 2, size: 96 })
    lines.forEach((line, lineIndex) => texts.push({ text: line, x: 168,
      y: top + (rowHeight - textHeight) / 2 + lineIndex * lineHeight, size, color: '#282b25', weight: 'bold' }))
    y = top + rowHeight + 22
  })
  if (!order.items.length) text('暂未选菜', 26)
  if (order.remark) { rule(); text('口味备注', 23, '#b94732', 504, 'bold'); text(order.remark, 26) }
  rule()
  text(`订单 ${String(order._id || '').slice(0, 8)}`, 21, '#64685f')
  return { width, height: y + 32, texts, rules, images }
}

function drawPoster(ctx, layout, photos = []) {
  ctx.fillStyle = '#f2ede4'; ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.fillStyle = '#fffcf7'; ctx.fillRect(22, 22, layout.width - 44, layout.height - 44)
  ctx.fillStyle = '#d9563f'; ctx.fillRect(22, 22, layout.width - 44, 6)
  ctx.textBaseline = 'top'
  for (const box of layout.images) {
    const photo = photos[box.index]
    if (photo && typeof ctx.drawImage === 'function') {
      const edge = Math.min(photo.width, photo.height)
      ctx.drawImage(photo.image, (photo.width - edge) / 2, (photo.height - edge) / 2, edge, edge, box.x, box.y, box.size, box.size)
    } else {
      // Even a damaged local placeholder must not prevent sharing an order.
      ctx.fillStyle = '#f7ded5'; ctx.fillRect(box.x, box.y, box.size, box.size)
      ctx.fillStyle = '#9f392b'; ctx.font = '20px sans-serif'
      ctx.fillText('家常好味', box.x + 8, box.y + 36)
    }
  }
  for (const row of layout.texts) {
    ctx.fillStyle = row.color; ctx.font = `${row.weight} ${row.size}px sans-serif`
    ctx.fillText(row.text, row.x, row.y)
  }
  ctx.strokeStyle = '#ddd3c6'; ctx.lineWidth = 1
  for (const y of layout.rules) { ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(552, y); ctx.stroke() }
}

function loadPhoto(canvas, src) {
  if (typeof wx.getImageInfo !== 'function' || typeof canvas.createImage !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value) }
    const timer = setTimeout(() => finish(null), 5000)
    try {
      wx.getImageInfo({ src, success: (info) => {
        if (settled) return
        try {
          const image = canvas.createImage()
          image.onload = () => finish({ image, width: info.width || image.width, height: info.height || image.height })
          image.onerror = () => finish(null)
          // Packaged getImageInfo paths are root-relative without a leading slash.
          image.src = /^(\/|[a-z]+:\/\/)/i.test(info.path) ? info.path : `/${info.path}`
        } catch { finish(null) }
      }, fail: () => finish(null) })
    } catch { finish(null) }
  })
}

async function loadPhotos(canvas, items) {
  const fallback = await loadPhoto(canvas, DEFAULT_DISH_IMAGE)
  const photos = new Array(items.length)
  let next = 0
  // Bounded concurrency and timeouts keep a long order usable on slow connections.
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      photos[index] = items[index].imageFileId ? await loadPhoto(canvas, items[index].imageFileId) || fallback : fallback
    }
  }))
  return photos
}

async function generatePoster(page, order, isCurrent = () => true) {
  const canvas = await new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page).select('#order-poster').fields({ node: true, size: true }).exec((rows) => {
      rows[0]?.node ? resolve(rows[0].node) : reject(new Error('图片画布未准备好，请点击重试生成'))
    })
  })
  const ctx = canvas.getContext('2d')
  const layout = posterLayout(order, (value, size, weight) => { ctx.font = `${weight} ${size}px sans-serif`; return ctx.measureText(value).width })
  const photos = await loadPhotos(canvas, order.items)
  if (!isCurrent()) throw new Error('订单图片已过期，请重新生成')
  canvas.width = Math.ceil(layout.width * 1.5); canvas.height = Math.ceil(layout.height * 1.5)
  ctx.scale(1.5, 1.5)
  drawPoster(ctx, layout, photos)
  const path = await new Promise((resolve, reject) => wx.canvasToTempFilePath({
    canvas, x: 0, y: 0, width: canvas.width, height: canvas.height,
    destWidth: canvas.width, destHeight: canvas.height, fileType: 'png',
    success: (result) => resolve(result.tempFilePath), fail: () => reject(new Error('图片生成失败，请重试'))
  }, page))
  return { path, height: layout.height, width: layout.width }
}

module.exports = { beijingTime, wrapText, posterLayout, drawPoster, loadPhoto, loadPhotos, generatePoster }
