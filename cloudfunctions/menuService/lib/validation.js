function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function cleanText(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function optionalNumber(value, min, max, integer = false) {
  if (value == null || String(value).trim() === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    fail('BAD_REQUEST', `数字需在 ${min} 到 ${max} 之间${integer ? '，且为整数' : ''}`)
  }
  return number
}

function cleanDish(payload = {}) {
  const name = cleanText(payload.name, 40)
  if (!name) fail('BAD_REQUEST', '请填写菜品名称')
  if (payload.ingredients != null && !Array.isArray(payload.ingredients)) fail('BAD_REQUEST', '原料格式不正确')
  if (payload.steps != null && !Array.isArray(payload.steps)) fail('BAD_REQUEST', '步骤格式不正确')
  if ((payload.ingredients || []).length > 100 || (payload.steps || []).length > 100) fail('BAD_REQUEST', '原料或步骤最多 100 项')
  return {
    name,
    categoryId: cleanText(payload.categoryId, 80),
    description: cleanText(payload.description, 300),
    imageFileId: cleanText(payload.imageFileId, 2000),
    defaultServings: optionalNumber(payload.defaultServings, 1, 20, true),
    cookingTime: optionalNumber(payload.cookingTime, 0, 1440),
    ingredients: (payload.ingredients || []).filter((item) => item && cleanText(item.name, 30)).map((item) => {
      const raw = cleanText(item.quantity, 20)
      let quantity = raw
      if (raw && /^-?\d+(\.\d+)?$/.test(raw)) quantity = optionalNumber(raw, 0, 1000000)
      return {
        name: cleanText(item.name, 30), quantity,
        unit: cleanText(item.unit, 10),
        type: item.type === 'main' ? 'main' : 'seasoning',
        note: cleanText(item.note, 80)
      }
    }),
    steps: (payload.steps || []).map((step) => cleanText(step, 300)).filter(Boolean),
    enabled: payload.enabled !== false
  }
}

module.exports = { fail, cleanText, cleanDish }
