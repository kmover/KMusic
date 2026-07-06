const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const initSqlJs = require('sql.js')

let db = null       // sql.js database instance
let dbPath = ''     // path to .db file on disk
let saveDb = null   // function to write database to disk
let _inTransaction = false

function getDataDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'db')
    : path.join(__dirname, '..', 'db')
}

function getDbPath() {
  const dbDir = getDataDir()
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }
  return path.join(dbDir, 'music.db')
}

// ──────────────────────────────────
// sql.js → better-sqlite3 API 适配层
// ──────────────────────────────────

/**
 * 包装 sql.js Database，使其 API 兼容 better-sqlite3：
 *   db.prepare(sql).run(params)   → { changes, lastInsertRowid }
 *   db.prepare(sql).get(params)   → row | undefined
 *   db.prepare(sql).all(params)   → row[]
 *   db.exec(sql)                  → void (DDL)
 *   db.transaction(fn)            → function
 *   db.pragma(str)                → void
 *   db.close()                    → void（自动落盘）
 */
function wrapDatabase(sqlDb) {
  const _origExec = sqlDb.exec.bind(sqlDb)
  const _origRun = sqlDb.run.bind(sqlDb)
  const _origPrepare = sqlDb.prepare.bind(sqlDb)

  // ── prepare ──
  sqlDb.prepare = function (sql) {
    return {
      run(...params) {
        _origRun(sql, _normalizeParams(params))
        const changes = sqlDb.getRowsModified()
        let lastInsertRowid
        try {
          const r = _origExec('SELECT last_insert_rowid() AS id')
          if (r.length && r[0].values.length) lastInsertRowid = r[0].values[0][0]
        } catch (_) { /* 非 INSERT 语句不会报错 */ }
        if (!_inTransaction) saveDb()
        return { changes, lastInsertRowid }
      },
      get(...params) {
        const stmt = _origPrepare(sql)
        _bindStmt(stmt, params)
        let row
        if (stmt.step()) row = stmt.getAsObject()
        stmt.free()
        return row
      },
      all(...params) {
        const stmt = _origPrepare(sql)
        _bindStmt(stmt, params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        stmt.free()
        return rows
      }
    }
  }

  // ── exec ──
  sqlDb.exec = function (sql) {
    const result = _origExec(sql)
    if (!/^\s*SELECT\b/i.test(sql) && !_inTransaction) saveDb()
    return result
  }

  // ── run ──
  sqlDb.run = function (sql, ...params) {
    _origRun(sql, _normalizeParams(params))
    if (!_inTransaction) saveDb()
  }

  // ── transaction ──
  sqlDb.transaction = function (fn) {
    return function (...args) {
      _inTransaction = true
      sqlDb.exec('BEGIN')
      try {
        const result = fn(...args)
        sqlDb.exec('COMMIT')
        saveDb()
        return result
      } catch (e) {
        sqlDb.exec('ROLLBACK')
        throw e
      } finally {
        _inTransaction = false
      }
    }
  }

  // ── pragma ──
  sqlDb.pragma = function (pragmaStr) {
    sqlDb.exec('PRAGMA ' + pragmaStr)
  }

  // ── close ──
  sqlDb.close = function () {
    if (saveDb) saveDb()
    if (typeof sqlDb._close === 'function') sqlDb._close()
  }

  return sqlDb
}

/** 将参数标准化为 sql.js 接受的数组或对象 */
function _normalizeParams(args) {
  if (!Array.isArray(args)) args = [args]
  if (args.length === 0) return []

  const params = args.length === 1 ? args[0] : args
  if (params === undefined || params === null) return []
  if (Array.isArray(params)) return params

  if (_isPlainObject(params)) {
    const named = {}
    for (const [key, value] of Object.entries(params)) {
      named[key] = value
      if (!/^[:@$]/.test(key)) {
        named[`@${key}`] = value
        named[`:${key}`] = value
        named[`$${key}`] = value
      }
    }
    return named
  }

  return [params] // 原始值（string/number）包装为单元素数组
}

function _isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** 安全绑定参数到 Statement */
function _bindStmt(stmt, params) {
  const p = _normalizeParams(params)
  if (Array.isArray(p) ? p.length > 0 : p) {
    stmt.bind(p)
  }
}

// ──────────────────────────────────
// 数据库 API（接口不变）
// ──────────────────────────────────

async function initDatabase() {
  // 加载 sql.js（自动下载/使用内置 WASM）
  const SQL = await initSqlJs()

  dbPath = getDbPath()
  const dbDir = getDataDir()
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  // 从磁盘加载已有数据库，或创建新库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 落盘函数
  saveDb = () => {
    try {
      const data = db.export()
      fs.writeFileSync(dbPath, Buffer.from(data))
    } catch (e) {
      console.error('[DB] 保存数据库失败:', e.message)
    }
  }

  // 包装为 better-sqlite3 兼容 API
  db = wrapDatabase(db)

  // 表结构初始化
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '未知歌手',
      file_path TEXT NOT NULL UNIQUE,
      duration REAL DEFAULT 0,
      lyrics TEXT DEFAULT '',
      cover TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_songs_category ON songs(category_id);
    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
  `)

  // 默认分组
  const count = db.prepare('SELECT COUNT(*) as cnt FROM categories').get()
  if (count.cnt === 0) {
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('默认列表')").run()
  }

  // 兼容旧数据库
  try { db.exec("ALTER TABLE songs ADD COLUMN lyrics TEXT DEFAULT ''") } catch (_) {}
  try { db.exec("ALTER TABLE songs ADD COLUMN cover TEXT DEFAULT ''") } catch (_) {}

  // 清除错误歌词
  db.prepare("UPDATE songs SET lyrics = '' WHERE lyrics = '[object Object]'").run()

  // 归一化文件路径
  normalizeFilePaths()

  console.log('[DB] 数据库初始化完成 (sql.js):', dbPath)
}

function closeDatabase() {
  if (db) {
    db.close()
    console.log('[DB] 数据库已关闭')
  }
}

// ========== 分组 CRUD ==========

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY created_at ASC').all()
}

function addCategory(name) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分组名称不能为空')
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed)
  if (existing) throw new Error('分组名称已存在')
  return db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed)
}

function findOrCreateCategory(name) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('分组名称不能为空')
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed)
  if (existing) return existing
  const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed)
  return { id: result.lastInsertRowid }
}

function renameCategory(id, newName) {
  const trimmed = newName.trim()
  if (!trimmed) throw new Error('分组名称不能为空')
  const existing = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(trimmed, id)
  if (existing) throw new Error('分组名称已存在')
  return db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmed, id)
}

function deleteCategory(id) {
  return db.prepare('DELETE FROM categories WHERE id = ?').run(id)
}

// ========== 歌曲 CRUD ==========

function getSongsByCategory(categoryId) {
  return db.prepare(
    'SELECT * FROM songs WHERE category_id = ? ORDER BY created_at DESC'
  ).all(categoryId)
}

function getAllSongsGrouped() {
  const categories = db.prepare('SELECT * FROM categories ORDER BY created_at ASC').all()
  const result = {}
  for (const cat of categories) {
    result[cat.name] = db.prepare(
      'SELECT * FROM songs WHERE category_id = ? ORDER BY created_at DESC'
    ).all(cat.id)
  }
  return { categories, data: result }
}

function addSong(song) {
  return db.prepare(`
    INSERT OR IGNORE INTO songs (category_id, title, artist, file_path, duration, lyrics, cover)
    VALUES (@category_id, @title, @artist, @file_path, @duration, @lyrics, @cover)
  `).run(song)
}

function importSongs(songs) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO songs (category_id, title, artist, file_path, duration, lyrics, cover)
    VALUES (@category_id, @title, @artist, @file_path, @duration, @lyrics, @cover)
  `)
  let count = 0
  const tx = db.transaction((songs) => {
    for (const s of songs) {
      const r = insert.run(s)
      if (r.changes > 0) count++
    }
  })
  tx(songs)
  return count
}

function deleteSong(id) {
  return db.prepare('DELETE FROM songs WHERE id = ?').run(id)
}

function getSongCount() {
  return db.prepare('SELECT COUNT(*) as cnt FROM songs').get().cnt
}

function getAllSongs() {
  return db.prepare('SELECT * FROM songs ORDER BY category_id, id').all()
}

function updateSong(id, data) {
  const fields = []
  const params = []
  for (const [key, val] of Object.entries(data)) {
    fields.push(`${key} = ?`)
    params.push(val)
  }
  if (fields.length === 0) return { changes: 0 }
  params.push(id)
  return db.prepare(`UPDATE songs SET ${fields.join(', ')} WHERE id = ?`).run(params)
}

function removeMissingSongs() {
  const songs = db.prepare('SELECT * FROM songs').all()
  let removed = 0
  for (const song of songs) {
    if (!fs.existsSync(song.file_path)) {
      if (song.cover) {
        try {
          const dbDir = getDataDir()
          const p = path.join(dbDir, song.cover)
          if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch (_) {}
      }
      db.prepare('DELETE FROM songs WHERE id = ?').run(song.id)
      removed++
    }
  }
  return { removed }
}

function normalizeFilePaths() {
  const songs = db.prepare('SELECT * FROM songs ORDER BY id ASC').all()
  const seen = new Set()
  const toDelete = []
  const toUpdate = []

  for (const song of songs) {
    const normalized = path.normalize(song.file_path)
    if (seen.has(normalized)) {
      toDelete.push(song.id)
    } else {
      seen.add(normalized)
      if (normalized !== song.file_path) {
        toUpdate.push({ id: song.id, file_path: normalized })
      }
    }
  }

  if (toUpdate.length === 0 && toDelete.length === 0) return

  const deleteStmt = db.prepare('DELETE FROM songs WHERE id = ?')
  const updateStmt = db.prepare('UPDATE songs SET file_path = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const id of toDelete) deleteStmt.run(id)
    for (const { id, file_path } of toUpdate) updateStmt.run(file_path, id)
  })
  tx()

  if (toUpdate.length > 0) console.log(`[DB] 归一化 ${toUpdate.length} 条路径记录`)
  if (toDelete.length > 0) console.log(`[DB] 移除 ${toDelete.length} 条因路径不一致产生的重复记录`)
}

function clearAllSongs() {
  const covers = db.prepare("SELECT cover FROM songs WHERE cover != ''").all()
  const dbDir = getDataDir()
  for (const { cover } of covers) {
    try {
      const p = path.join(dbDir, cover)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch (_) {}
  }
  db.exec('DELETE FROM songs')
  db.exec("DELETE FROM sqlite_sequence WHERE name='songs'")
  return { deleted: covers.length }
}

// ========== 应用设置（JSON 持久化） ==========

function getSettingsPath() {
  return path.join(getDataDir(), 'settings.json')
}

function getSettings() {
  const sp = getSettingsPath()
  try {
    if (fs.existsSync(sp)) {
      return JSON.parse(fs.readFileSync(sp, 'utf-8'))
    }
  } catch (e) {
    console.error('[DB] 读取设置失败:', e.message)
  }
  return {}
}

function setSettings(settings) {
  const sp = getSettingsPath()
  const dir = path.dirname(sp)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2), 'utf-8')
  return true
}

module.exports = {
  initDatabase,
  closeDatabase,
  getDataDir,
  getCategories,
  addCategory,
  findOrCreateCategory,
  renameCategory,
  deleteCategory,
  getSongsByCategory,
  getAllSongsGrouped,
  addSong,
  importSongs,
  deleteSong,
  getSongCount,
  getAllSongs,
  updateSong,
  clearAllSongs,
  removeMissingSongs,
  getSettings,
  setSettings
}
