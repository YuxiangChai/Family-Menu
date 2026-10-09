const { DatabaseSync, backup } = require('node:sqlite')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { migrateCategories } = require('./categories')
const { fail } = require('../cloudfunctions/menuService/lib/validation')

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
        is_chef INTEGER NOT NULL DEFAULT 0 CHECK(is_chef IN (0, 1)),
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
      CREATE TABLE IF NOT EXISTS menu_change_receipts (
        menu_id TEXT NOT NULL, actor_openid TEXT NOT NULL,
        request_key TEXT NOT NULL, PRIMARY KEY(menu_id, actor_openid, request_key)
      );
      CREATE TABLE IF NOT EXISTS menu_submission_receipts (
        menu_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id)
      );
      CREATE TABLE IF NOT EXISTS family_settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, openid TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), recipient_openid TEXT NOT NULL,
        created_at TEXT NOT NULL, read_at TEXT, data TEXT NOT NULL,
        UNIQUE(order_id, recipient_openid)
      );
      CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_openid, created_at DESC);
      CREATE TABLE IF NOT EXISTS notification_preferences (
        openid TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, template_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_outbox (
        id TEXT PRIMARY KEY, notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id),
        recipient_openid TEXT NOT NULL, template_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','sending','sent','failed')),
        error_code TEXT, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orders_history ON orders(json_extract(data, '$.createdAt') DESC, id DESC);
    `)
    this.migrateMemberRoles()
    migrateCategories(this)
  }

  migrateMemberRoles() {
    // Admin is a fixed independent permission; chef is additive to ordinary membership.
    this.transaction(() => {
      if (this.db.prepare("SELECT count(*) AS count FROM family_members WHERE role='admin'").get().count > 1) {
        throw new Error('数据库中存在多个管理员，请先在服务器确认唯一管理员后再升级；未修改原有成员')
      }
      const columns = this.db.prepare('PRAGMA table_info(family_members)').all()
      if (!columns.some((column) => column.name === 'is_chef')) {
        this.db.exec(`
          CREATE TABLE family_members_v4 (
            id TEXT PRIMARY KEY, openid TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
            is_chef INTEGER NOT NULL DEFAULT 0 CHECK(is_chef IN (0, 1)),
            enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), data TEXT NOT NULL
          );
          INSERT INTO family_members_v4
            SELECT id, openid, CASE WHEN role='chef' THEN 'member' ELSE role END,
              CASE WHEN role='chef' OR json_extract(data, '$.isChef')=1 THEN 1 ELSE 0 END,
              enabled, json_set(data, '$.role', CASE WHEN role='chef' THEN 'member' ELSE role END,
                '$.isChef', json(CASE WHEN role='chef' OR json_extract(data, '$.isChef')=1 THEN 'true' ELSE 'false' END))
            FROM family_members;
          DROP TABLE family_members;
          ALTER TABLE family_members_v4 RENAME TO family_members;
        `)
      }
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS family_single_admin ON family_members(role) WHERE role='admin'; PRAGMA user_version = 4;")
    })
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
    const value = { ...member, isChef: member.isChef === true, _id: this.member(member.openid)?._id || member._id || randomUUID() }
    this.db.prepare(`INSERT INTO family_members (id, openid, role, is_chef, enabled, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(openid) DO UPDATE SET role=excluded.role, is_chef=excluded.is_chef, enabled=excluded.enabled, data=excluded.data`)
      .run(value._id, value.openid, value.role, Number(value.isChef), Number(value.enabled), JSON.stringify(value))
    return value
  }

  members() {
    return this.db.prepare("SELECT data FROM family_members ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END, id").all().map((row) => JSON.parse(row.data))
  }

  memberById(id) {
    const row = this.db.prepare('SELECT data FROM family_members WHERE id=?').get(id)
    return row ? JSON.parse(row.data) : null
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

  listOrders(date, options = {}) {
    const limit = options.limit || 30
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('BAD_REQUEST', '每页订单数量需为 1 到 50')
    const conditions = [], parameters = []
    if (options.scope === 'today') { conditions.push('order_date = ?'); parameters.push(date) }
    if (options.cursor) {
      let cursor
      try {
        if (typeof options.cursor !== 'string' || options.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(options.cursor)) throw new Error()
        cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString())
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.createdAt) || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 80) throw new Error()
      } catch { fail('BAD_REQUEST', '订单分页标识不正确，请刷新') }
      conditions.push("(json_extract(data, '$.createdAt') < ? OR (json_extract(data, '$.createdAt') = ? AND id < ?))")
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }
    const rows = this.db.prepare(`SELECT id, data FROM orders ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY json_extract(data, '$.createdAt') DESC, id DESC LIMIT ?`).all(...parameters, limit + 1)
    const orders = rows.slice(0, limit).map((row) => JSON.parse(row.data))
    const last = orders.at(-1)
    return { orders, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last._id })).toString('base64url') : null }
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
