const { app, BrowserWindow, protocol, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const database = require('./database')

// 禁用 Chromium 媒体键悬浮窗
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')

let mainWindow = null
let tray = null
let mediaKeysActive = true  // 默认开启
const isDev = !app.isPackaged

function getIconPath() {
  // app.png 在 electron/ 目录下，dev 和打包后路径一致
  return path.join(__dirname, 'app.png')
}

function createWindow() {
  const iconPath = getIconPath()
  mainWindow = new BrowserWindow({
    width: 1152,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    resizable: false,
    icon: iconPath,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 拦截关闭事件，改为隐藏窗口，保持渲染进程存活以继续播放
  mainWindow.on('close', (event) => {
    event.preventDefault()
    mainWindow.hide()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template = []

    if (params.isEditable) {
      template.push(
        { label: '撤销', role: 'undo', enabled: params.editFlags.canUndo },
        { label: '重做', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
        { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
        { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: '全选', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push({ label: '复制', role: 'copy' })
    }

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow })
    }
  })
}

// 根据扩展名返回 MIME 类型
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const types = {
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif'
  }
  return types[ext] || 'audio/mpeg'
}

// 注册自定义协议，用于访问本地音乐文件
function registerCustomProtocol() {
  // 音乐文件协议: music://local/ENCODED_FULL_PATH
  protocol.handle('music', (request) => {
    const urlStr = request.url
    const encoded = urlStr.replace(/^music:\/\/local\//, '')
    const fullPath = decodeURIComponent(encoded)
    if (!fullPath) {
      return new Response('Not Found', { status: 404 })
    }

    try {
      const stat = fs.statSync(fullPath)
      const fileSize = stat.size
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        // 处理 Range 请求（音频拖动进度条时需要）
        const parts = rangeHeader.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
        const chunkSize = (end - start) + 1

        const buf = Buffer.alloc(chunkSize)
        const fd = fs.openSync(fullPath, 'r')
        fs.readSync(fd, buf, 0, chunkSize, start)
        fs.closeSync(fd)

        return new Response(buf, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': getMimeType(fullPath)
          }
        })
      }

      // 完整文件响应
      const buf = fs.readFileSync(fullPath)
      return new Response(buf, {
        headers: {
          'Content-Length': String(fileSize),
          'Content-Type': getMimeType(fullPath),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (err) {
      console.error('[Music Protocol] Error:', err.message, 'Path:', fullPath)
      return new Response('File not found: ' + fullPath, { status: 404 })
    }
  })

  // 自定义背景图协议: bg://custom/FILENAME
  protocol.handle('bg', (request) => {
    const urlStr = request.url
    const filename = urlStr.replace(/^bg:\/\/custom\//, '')
    if (!filename) {
      return new Response('Not Found', { status: 404 })
    }
    const customDir = isDev
      ? path.join(__dirname, '..', 'db', 'covers', 'custom')
      : path.join(app.getPath('userData'), 'db', 'covers', 'custom')
    const fullPath = path.join(customDir, decodeURIComponent(filename))
    try {
      const stat = fs.statSync(fullPath)
      const buf = fs.readFileSync(fullPath)
      return new Response(buf, {
        headers: {
          'Content-Length': String(stat.size),
          'Content-Type': getMimeType(fullPath),
          'Cache-Control': 'max-age=31536000'
        }
      })
    } catch (err) {
      console.error('[Bg Protocol] Error:', err.message)
      return new Response('Not Found', { status: 404 })
    }
  })
}

// IPC 处理：数据库操作
function registerIpcHandlers() {
  // === 分组操作 ===
  ipcMain.handle('db:getCategories', () => {
    return database.getCategories()
  })

  ipcMain.handle('db:addCategory', (_event, name) => {
    return database.addCategory(name)
  })

  ipcMain.handle('db:renameCategory', (_event, id, newName) => {
    return database.renameCategory(id, newName)
  })

  ipcMain.handle('db:deleteCategory', (_event, id) => {
    return database.deleteCategory(id)
  })

  // === 歌曲操作 ===
  ipcMain.handle('db:getSongsByCategory', (_event, categoryId) => {
    return database.getSongsByCategory(categoryId)
  })

  ipcMain.handle('db:getAllSongsGrouped', () => {
    return database.getAllSongsGrouped()
  })

  ipcMain.handle('db:addSong', (_event, song) => {
    return database.addSong(song)
  })

  ipcMain.handle('db:importSongs', async (_event, categoryId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入歌曲',
      filters: [
        { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'wma'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, count: 0 }
    }

    // 延迟加载 music-metadata（ESM 模块）
    const mm = await import('music-metadata')

    // 确保封面目录存在
    const coversDir = isDev
      ? path.join(__dirname, '..', 'db', 'covers')
      : path.join(app.getPath('userData'), 'db', 'covers')
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true })
    }

    const imported = []
    for (const filePath of result.filePaths) {
      try {
        // 用 music-metadata 解析元数据
        const meta = await mm.parseFile(filePath, { skipCovers: false })
        const common = meta.common
        const format = meta.format

        // --- 歌曲名 ---
        let title = common.title || ''
        if (!title) {
          // 回退到文件名
          const ext = path.extname(filePath)
          title = path.basename(filePath, ext)
        }

        // --- 歌手 ---
        let artist = common.artist || common.albumartist || ''
        // 如果数组则取第一个
        if (Array.isArray(artist)) artist = artist[0] || ''
        // 回退到文件名解析
        if (!artist) {
          const ext = path.extname(filePath)
          const basename = path.basename(filePath, ext)
          const match = basename.match(/^(.+?)\s*[-–—]\s*(.+)$/)
          if (match) {
            title = title || match[2].trim()
            artist = match[1].trim()
          }
        }
        if (!artist) artist = '未知歌手'
        if (!title) title = '未知歌曲'

        // --- 时长 ---
        const duration = format.duration || 0

        // --- 歌词 ---
        let lyrics = ''
        if (common.lyrics && common.lyrics.length > 0) {
          const parts = []
          for (const l of common.lyrics) {
            if (typeof l === 'string') {
              parts.push(l)
              continue
            }
            // 优先从 syncText 重建带时间轴的 LRC（music-metadata 解析后 text 字段不含时间戳）
            if (l.syncText && l.syncText.length > 0) {
              for (const s of l.syncText) {
                if (!s.text) continue
                const ts = s.timestamp || 0
                const totalSec = Math.floor(ts / 1000)
                const min = Math.floor(totalSec / 60)
                const sec = totalSec % 60
                const ms = ts % 1000
                parts.push(
                  `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}]${s.text}`
                )
              }
            } else if (l.text) {
              // 非 LRC 格式的纯文本歌词
              parts.push(l.text)
            }
          }
          lyrics = parts.join('\n')
        }
        console.log(`[Import] ${path.basename(filePath)} lyrics length: ${lyrics.length}, preview: "${lyrics.slice(0, 80)}"`)

        // --- 封面 ---
        let cover = ''
        if (common.picture && common.picture.length > 0) {
          const pic = common.picture[0]
          // 根据 MIME 类型确定扩展名
          let ext = 'jpg'
          if (pic.format === 'image/png') ext = 'png'
          else if (pic.format === 'image/jpeg') ext = 'jpg'
          else if (pic.format === 'image/webp') ext = 'webp'
          else if (pic.format === 'image/bmp') ext = 'bmp'
          // 用文件路径的 hash 生成唯一封面名
          const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12)
          const coverFilename = `${hash}.${ext}`
          const coverPath = path.join(coversDir, coverFilename)
          fs.writeFileSync(coverPath, pic.data)
          cover = `covers/${coverFilename}` // 相对路径
        }

        imported.push({
          category_id: categoryId,
          title,
          artist,
          file_path: path.normalize(filePath),
          duration,
          lyrics,
          cover
        })
      } catch (e) {
        console.error('[Import] 解析元数据失败:', filePath, e.message)
        // 元数据解析失败时，回退到文件名解析
        const ext = path.extname(filePath)
        const basename = path.basename(filePath, ext)
        let title = basename
        let artist = '未知歌手'
        const match = basename.match(/^(.+?)\s*[-–—]\s*(.+)$/)
        if (match) {
          title = match[2].trim()
          artist = match[1].trim()
        }
        imported.push({
          category_id: categoryId,
          title,
          artist,
          file_path: path.normalize(filePath),
          duration: 0,
          lyrics: '',
          cover: ''
        })
      }
    }

    const count = database.importSongs(imported)
    return { success: true, count, total: result.filePaths.length }
  })

  ipcMain.handle('db:deleteSong', (_event, id) => {
    return database.deleteSong(id)
  })

  ipcMain.handle('db:getSongCount', () => {
    return database.getSongCount()
  })

  ipcMain.handle('db:clearAllSongs', () => {
    return database.clearAllSongs()
  })

  ipcMain.handle('db:removeMissingSongs', () => {
    return database.removeMissingSongs()
  })

  // === 按目录枚举音乐文件并导入 ===
  ipcMain.handle('db:scanDirectory', async () => {
    const dirResult = await dialog.showOpenDialog(mainWindow, {
      title: '选择音乐根目录（子目录名将作为分组名）',
      properties: ['openDirectory']
    })
    if (dirResult.canceled || dirResult.filePaths.length === 0) {
      return { success: false, message: '已取消' }
    }
    const rootPath = dirResult.filePaths[0]

    // 列出所有子目录
    let entries
    try {
      entries = fs.readdirSync(rootPath, { withFileTypes: true })
    } catch (e) {
      return { success: false, message: '无法读取目录: ' + e.message }
    }
    const subdirs = entries.filter(e => e.isDirectory())

    const mm = await import('music-metadata')
    const coversDir = isDev
      ? path.join(__dirname, '..', 'db', 'covers')
      : path.join(app.getPath('userData'), 'db', 'covers')
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true })
    }

    const musicExts = ['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.wma']
    let totalFiles = 0
    let totalImported = 0
    const groups = []

    for (const dir of subdirs) {
      const dirPath = path.join(rootPath, dir.name)
      let files
      try {
        files = fs.readdirSync(dirPath)
      } catch (e) {
        continue
      }

      const musicFiles = files
        .map(f => ({ name: f, path: path.join(dirPath, f), ext: path.extname(f).toLowerCase() }))
        .filter(f => musicExts.includes(f.ext) && !f.name.startsWith('.'))

      if (musicFiles.length === 0) continue

      // 找到或创建分组
      const category = database.findOrCreateCategory(dir.name)

      const imported = []
      for (const f of musicFiles) {
        try {
          const meta = await mm.parseFile(f.path, { skipCovers: false })
          const common = meta.common, format = meta.format

          let title = common.title || ''
          if (!title) title = path.basename(f.name, f.ext)

          let artist = common.artist || common.albumartist || ''
          if (Array.isArray(artist)) artist = artist[0] || ''
          if (!artist) {
            const match = path.basename(f.name, f.ext).match(/^(.+?)\s*[-–—]\s*(.+)$/)
            if (match) {
              title = title || match[2].trim()
              artist = match[1].trim()
            }
          }
          if (!artist) artist = '未知歌手'
          if (!title) title = '未知歌曲'

          const duration = format.duration || 0

          // --- 歌词 ---
          let lyrics = ''
          if (common.lyrics && common.lyrics.length > 0) {
            const parts = []
            for (const l of common.lyrics) {
              if (typeof l === 'string') { parts.push(l); continue }
              if (l.syncText && l.syncText.length > 0) {
                for (const s of l.syncText) {
                  if (!s.text) continue
                  const ts = s.timestamp || 0
                  const totalSec = Math.floor(ts / 1000)
                  const mm2 = Math.floor(totalSec / 60)
                  const sec2 = totalSec % 60
                  const ms2 = ts % 1000
                  parts.push(`[${String(mm2).padStart(2, '0')}:${String(sec2).padStart(2, '0')}.${String(ms2).padStart(3, '0')}]${s.text}`)
                }
              } else if (l.text) {
                parts.push(l.text)
              }
            }
            lyrics = parts.join('\n')
          }

          // --- 封面 ---
          let cover = ''
          if (common.picture && common.picture.length > 0) {
            const pic = common.picture[0]
            let ext = 'jpg'
            if (pic.format === 'image/png') ext = 'png'
            else if (pic.format === 'image/jpeg') ext = 'jpg'
            else if (pic.format === 'image/webp') ext = 'webp'
            else if (pic.format === 'image/bmp') ext = 'bmp'
            const hash = crypto.createHash('md5').update(f.path).digest('hex').slice(0, 12)
            const coverFilename = `${hash}.${ext}`
            fs.writeFileSync(path.join(coversDir, coverFilename), pic.data)
            cover = `covers/${coverFilename}`
          }

          imported.push({
            category_id: category.id,
            title,
            artist,
            file_path: path.normalize(f.path),
            duration,
            lyrics,
            cover
          })
        } catch (e) {
          // 跳过解析失败的文件，不添加
          console.warn('[Scan] 跳过无法解析的文件:', f.path, e.message)
        }
      }

      let count = 0
      if (imported.length > 0) {
        count = database.importSongs(imported)
      }
      totalFiles += musicFiles.length
      totalImported += count
      groups.push({ name: dir.name, files: musicFiles.length, imported: count })
    }

    return { success: true, rootPath, totalFiles, totalImported, groups }
  })

  // === 刷新所有歌曲元数据 ===
  ipcMain.handle('db:refreshAllSongs', async () => {
    const songs = database.getAllSongs()
    if (!songs || songs.length === 0) {
      return { success: true, updated: 0, total: 0 }
    }

    const mm = await import('music-metadata')
    const coversDir = isDev
      ? path.join(__dirname, '..', 'db', 'covers')
      : path.join(app.getPath('userData'), 'db', 'covers')
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true })
    }

    let updated = 0
    for (const song of songs) {
      try {
        // 检查文件是否存在
        if (!fs.existsSync(song.file_path)) {
          console.log('[Refresh] 文件不存在，跳过:', song.file_path)
          continue
        }
        const meta = await mm.parseFile(song.file_path, { skipCovers: false })
        const common = meta.common
        const format = meta.format

        // --- 歌曲名 ---
        let title = common.title || ''
        if (!title) {
          const ext = path.extname(song.file_path)
          title = path.basename(song.file_path, ext)
        }

        // --- 歌手 ---
        let artist = common.artist || common.albumartist || ''
        if (Array.isArray(artist)) artist = artist[0] || ''
        if (!artist) {
          const ext = path.extname(song.file_path)
          const basename = path.basename(song.file_path, ext)
          const match = basename.match(/^(.+?)\s*[-–—]\s*(.+)$/)
          if (match) {
            title = title || match[2].trim()
            artist = match[1].trim()
          }
        }
        if (!artist) artist = '未知歌手'
        if (!title) title = '未知歌曲'

        // --- 时长 ---
        const duration = format.duration || 0

        // --- 歌词 ---
        let lyrics = ''
        if (common.lyrics && common.lyrics.length > 0) {
          const parts = []
          for (const l of common.lyrics) {
            if (typeof l === 'string') {
              parts.push(l)
              continue
            }
            if (l.syncText && l.syncText.length > 0) {
              for (const s of l.syncText) {
                if (!s.text) continue
                const ts = s.timestamp || 0
                const totalSec = Math.floor(ts / 1000)
                const min = Math.floor(totalSec / 60)
                const sec = totalSec % 60
                const ms = ts % 1000
                parts.push(
                  `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}]${s.text}`
                )
              }
            } else if (l.text) {
              parts.push(l.text)
            }
          }
          lyrics = parts.join('\n')
        }

        // --- 封面 ---
        let cover = song.cover // 保留旧封面，有新的才替换
        if (common.picture && common.picture.length > 0) {
          const pic = common.picture[0]
          let ext = 'jpg'
          if (pic.format === 'image/png') ext = 'png'
          else if (pic.format === 'image/jpeg') ext = 'jpg'
          else if (pic.format === 'image/webp') ext = 'webp'
          else if (pic.format === 'image/bmp') ext = 'bmp'
          const hash = crypto.createHash('md5').update(song.file_path).digest('hex').slice(0, 12)
          const coverFilename = `${hash}.${ext}`
          const coverPath = path.join(coversDir, coverFilename)
          fs.writeFileSync(coverPath, pic.data)
          cover = `covers/${coverFilename}`
        }

        database.updateSong(song.id, { title, artist, duration, lyrics, cover })
        updated++
      } catch (e) {
        console.error('[Refresh] 解析失败:', song.file_path, e.message)
      }
    }

    return { success: true, updated, total: songs.length }
  })

  // === 封面图片 ===
  ipcMain.handle('db:getCoverBase64', (_event, coverRelPath) => {
    try {
      if (!coverRelPath) return null
      const fullPath = isDev
        ? path.join(__dirname, '..', 'db', coverRelPath)
        : path.join(app.getPath('userData'), 'db', coverRelPath)
      if (!fs.existsSync(fullPath)) return null
      const ext = path.extname(fullPath).toLowerCase()
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' }
      const mime = mimeMap[ext] || 'image/jpeg'
      const buf = fs.readFileSync(fullPath)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch (e) {
      console.error('[Cover] 读取失败:', e.message)
      return null
    }
  })

  // === 应用设置 ===
  ipcMain.handle('settings:get', () => {
    return database.getSettings()
  })

  ipcMain.handle('settings:set', (_event, settings) => {
    return database.setSettings(settings)
  })

  // === 窗口控制 ===
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
  })

  ipcMain.handle('window:show', () => {
    ensureWindow().show()
    ensureWindow().focus()
  })

  ipcMain.handle('window:isMaximized', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    return mainWindow.isMaximized()
  })

  // === 多媒体按键 ===
  ipcMain.handle('mediaKeys:setEnabled', (_event, enabled) => {
    if (enabled) {
      registerMediaKeys()
    } else {
      unregisterMediaKeys()
    }
    mediaKeysActive = enabled
  })

  // === 自定义主题背景 ===
  ipcMain.handle('theme:pickCustom', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景图片',
      filters: [
        { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    // 复制图片到应用数据目录
    const srcPath = result.filePaths[0]
    const ext = path.extname(srcPath).toLowerCase()
    const hash = crypto.createHash('md5').update(srcPath + Date.now()).digest('hex').slice(0, 12)
    const filename = `bg-${hash}${ext}`

    const customDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'db', 'covers', 'custom')
      : path.join(__dirname, '..', 'db', 'covers', 'custom')
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true })
    }
    const destPath = path.join(customDir, filename)
    try {
      fs.copyFileSync(srcPath, destPath)
      // 返回相对路径（与封面路径约定一致）
      return `covers/custom/${filename}`
    } catch (e) {
      console.error('[Theme] 复制背景图失败:', e.message)
      return null
    }
  })
}

function ensureWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  return mainWindow
}

function createTray() {
  const iconPath = getIconPath()
  let trayIcon
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } catch (e) {
    trayIcon = nativeImage.createEmpty()
  }
  tray = new Tray(trayIcon)
  tray.setToolTip('KMusic')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        const win = ensureWindow()
        win.show()
        win.focus()
      }
    },
    { type: 'separator' },
    {
      label: '播放',
      click: () => {
        const win = ensureWindow()
        win.webContents.send('media-key-action', 'play')
      }
    },
    {
      label: '暂停',
      click: () => {
        const win = ensureWindow()
        win.webContents.send('media-key-action', 'pause')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        unregisterMediaKeys()
        database.closeDatabase()
        app.exit(0)
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    const win = ensureWindow()
    win.show()
    win.focus()
  })
}

function registerMediaKeys() {
  try {
    globalShortcut.register('MediaPlayPause', () => {
      const win = ensureWindow()
      win.webContents.send('media-key-action', 'playpause')
    })
    globalShortcut.register('MediaNextTrack', () => {
      const win = ensureWindow()
      win.webContents.send('media-key-action', 'next')
    })
    globalShortcut.register('MediaPreviousTrack', () => {
      const win = ensureWindow()
      win.webContents.send('media-key-action', 'prev')
    })
  } catch (e) {
    console.error('[MediaKeys] 注册失败:', e.message)
  }
}

function unregisterMediaKeys() {
  try {
    globalShortcut.unregister('MediaPlayPause')
    globalShortcut.unregister('MediaNextTrack')
    globalShortcut.unregister('MediaPreviousTrack')
  } catch (e) {
    console.error('[MediaKeys] 注销失败:', e.message)
  }
}

app.whenReady().then(async () => {
  try {
    await database.initDatabase()
    registerCustomProtocol()
    registerIpcHandlers()
    createWindow()
    createTray()
    registerMediaKeys()
  } catch (e) {
    console.error('[KMusic] 启动失败:', e.message)
    dialog.showErrorBox('启动失败', e.message)
  }

  app.on('activate', () => {
    ensureWindow().show()
  })
})

app.on('window-all-closed', () => {
  // 不退出，交给托盘控制
})
