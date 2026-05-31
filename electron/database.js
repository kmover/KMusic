const path = require('path')
const fs = require('fs')
const { app } = require('electron')

let db = null

function getDataDir() {
  // 打包后用 userData 目录（可读写），开发时用项目根目录
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

function initDatabase() {
  const Database = require('better-sqlite3')
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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

  // 创建默认分组
  const count = db.prepare('SELECT COUNT(*) as cnt FROM categories').get()
  if (count.cnt === 0) {
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('默认列表')").run()
  }

  // 兼容旧数据库：追加 lyrics / cover 列
  try { db.exec('ALTER TABLE songs ADD COLUMN lyrics TEXT DEFAULT \'\'') } catch (_) {}
  try { db.exec('ALTER TABLE songs ADD COLUMN cover TEXT DEFAULT \'\'') } catch (_) {}

  // 清除之前因 bug 写入的错误歌词数据
  db.prepare("UPDATE songs SET lyrics = '' WHERE lyrics = '[object Object]'").run()

  // 归一化 file_path，解决普通导入(/)和扫描目录导入(\)路径分隔符不一致导致的重复问题
  normalizeFilePaths()

  console.log('[DB] 数据库初始化完成:', dbPath)
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

// 查找或创建分组（不存在则新建，返回 { id }）
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

// ========== 应用设置（持久化到 db/settings.json）==========

function getSettingsPath() {
  const dbDir = getDataDir()
  return path.join(dbDir, 'settings.json')
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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2), 'utf-8')
  return true
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
  return db.prepare(`UPDATE songs SET ${fields.join(', ')} WHERE id = ?`).run(...params)
}

function removeMissingSongs() {
  const songs = db.prepare('SELECT * FROM songs').all()
  let removed = 0
  for (const song of songs) {
    if (!fs.existsSync(song.file_path)) {
      // 删除关联的封面文件
      if (song.cover) {
        try {
          const dbDir = getDataDir()
          const p = path.join(dbDir, song.cover)
          if (fs.existsSync(p)) fs.unlinkSync(p)
        } catch (_) { /* 忽略删除失败 */ }
      }
      db.prepare('DELETE FROM songs WHERE id = ?').run(song.id)
      removed++
    }
  }
  return { removed }
}

// 归一化所有 file_path，消除因路径分隔符不一致（/ vs \）导致的重复条目
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
    for (const id of toDelete) {
      deleteStmt.run(id)
    }
    for (const { id, file_path } of toUpdate) {
      updateStmt.run(file_path, id)
    }
  })
  tx()

  if (toUpdate.length > 0) {
    console.log(`[DB] 归一化 ${toUpdate.length} 条路径记录`)
  }
  if (toDelete.length > 0) {
    console.log(`[DB] 移除 ${toDelete.length} 条因路径不一致产生的重复记录`)
  }
}

function clearAllSongs() {
  // 获取所有封面路径并删除文件
  const covers = db.prepare("SELECT cover FROM songs WHERE cover != ''").all()
  const dbDir = getDataDir()
  for (const { cover } of covers) {
    try {
      const p = path.join(dbDir, cover)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch (_) { /* 忽略删除失败 */ }
  }
  // 清空数据表并重置自增ID
  db.exec('DELETE FROM songs')
  db.exec("DELETE FROM sqlite_sequence WHERE name='songs'")
  return { deleted: covers.length }
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
