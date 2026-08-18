const STATUS = {
  pending: '待确认',
  confirmed: '已确认',
  cooking: '制作中',
  completed: '已完成',
  cancelled: '已取消'
}

function todayText() {
  const date = new Date()
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${week[date.getDay()]}`
}

function dateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

module.exports = { STATUS, dateTime, todayText }
