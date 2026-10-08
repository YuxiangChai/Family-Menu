const { DatabaseSync, backup } = require('node:sqlite')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path.join(dataDir, 'menu.sqlite'), { timeout: 5000 })
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS family_members (
        id TEXT PRIMARY KEY, openid TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dishes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        category_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, creator_openid TEXT NOT NULL, order_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cooking','completed','cancelled')),
        idempotency_key TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(creator_openid, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS orders_date ON orders(order_date);
      CREATE INDEX IF NOT EXISTS orders_creator ON orders(creator_openid);
      CREATE TABLE IF NOT EXISTS family_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, openid TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `)
    for (const [id, name, sortOrder] of [['cat-home', '家常小炒', 10], ['cat-meat', '肉香满屋', 20], ['cat-soup', '汤汤水水', 30]]) {
      this.db.prepare('INSERT OR IGNORE INTO categories VALUES (?, ?)').run(id, JSON.stringify({ _id: id, name, sortOrder, enabled: true }))
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  member(openid) {
    const row = this.db.prepare('SELECT data FROM family_members WHERE openid = ?').get(openid)
    return row ? JSON.parse(row.data) : null
  }

  saveMember(member) {
    const value = { ...member, _id: this.member(member.openid)?._id || member._id || randomUUID() }
    this.db.prepare(`INSERT INTO family_members VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(openid) DO UPDATE SET role=excluded.role, enabled=excluded.enabled, data=excluded.data`)
      .run(value._id, value.openid, value.role, Number(value.enabled), JSON.stringify(value))
    return value
  }

  get(table, id) {
    this.checkTable(table)
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id)
    return row ? JSON.parse(row.data) : null
  }

  all(table) {
    this.checkTable(table)
    return this.db.prepare(`SELECT data FROM ${table}`).all().map((row) => JSON.parse(row.data))
  }

  checkTable(table) {
    if (!['categories', 'dishes', 'orders', 'family_settings'].includes(table)) throw new Error('Unknown table')
  }

  save(table, document) {
    this.checkTable(table)
    const item = { ...document, _id: document._id || randomUUID() }
    const data = JSON.stringify(item)
    if (table === 'dishes') {
      this.db.prepare(`INSERT INTO dishes VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, category_id=excluded.category_id, enabled=excluded.enabled, data=excluded.data`)
        .run(item._id, item.name, item.categoryId || '', Number(item.enabled), data)
    } else if (table === 'orders') {
      this.db.prepare(`INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data`)
        .run(item._id, item.creatorOpenid, item.orderDate, item.status, item.idempotencyKey, data)
    } else {
      this.db.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(item._id, data)
    }
    return item
  }

  findOrder(openid, key) {
    const row = this.db.prepare('SELECT data FROM orders WHERE creator_openid = ? AND idempotency_key = ?').get(openid, key)
    return row ? JSON.parse(row.data) : null
  }

  listOrders(openid, date, admin) {
    const rows = admin
      ? this.db.prepare('SELECT data FROM orders WHERE order_date = ?').all(date)
      : this.db.prepare('SELECT data FROM orders WHERE creator_openid = ?').all(openid)
    return rows.map((row) => JSON.parse(row.data)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
  }

  rateLimit(key, limit, windowMs) {
    const now = Date.now()
    this.db.prepare('DELETE FROM rate_limits WHERE resets_at <= ?').run(now)
    this.db.prepare(`INSERT INTO rate_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, now + windowMs)
    return this.db.prepare('SELECT count FROM rate_limits WHERE key=?').get(key).count <= limit
  }

  async backup(destination) { await backup(this.db, destination) }
  close() { this.db.close() }
}

module.exports = { Store }
