// Only our immutable uploaded files qualify; never rewrite a URL used for requests.
const SIGNED_MEDIA = /^(https?:\/\/[^?#]+\/media\/[0-9a-f-]{36}\.(?:jpg|png|webp))\?s=([0-9a-f]{64})&e=(\d{13})&sig=([0-9a-f]{64})$/

function imageKey(url) {
  const match = typeof url === 'string' && url.match(SIGNED_MEDIA)
  return match ? match[1] : url
}

function reuseMediaUrl(url, previous) {
  const next = typeof url === 'string' && url.match(SIGNED_MEDIA)
  const old = typeof previous === 'string' && previous.match(SIGNED_MEDIA)
  return next && old && next[1] === old[1] && next[2] === old[2] && Number(old[3]) > Date.now() + 60000 ? previous : url
}

function stablePictures(items, previous = [], idKey = 'dishId') {
  const existing = new Map(previous.map((item) => [item[idKey], item]))
  return items.map((item) => ({ ...item, imageFileId: reuseMediaUrl(item.imageFileId, existing.get(item[idKey])?.imageFileId) }))
}

module.exports = { imageKey, reuseMediaUrl, stablePictures }
