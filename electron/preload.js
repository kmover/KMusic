const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // 数据库操作
  db: {
    getCategories: () => ipcRenderer.invoke('db:getCategories'),
    addCategory: (name) => ipcRenderer.invoke('db:addCategory', name),
    renameCategory: (id, newName) => ipcRenderer.invoke('db:renameCategory', id, newName),
    deleteCategory: (id) => ipcRenderer.invoke('db:deleteCategory', id),
    getSongsByCategory: (categoryId) => ipcRenderer.invoke('db:getSongsByCategory', categoryId),
    getAllSongsGrouped: () => ipcRenderer.invoke('db:getAllSongsGrouped'),
    importSongs: (categoryId) => ipcRenderer.invoke('db:importSongs', categoryId),
    deleteSong: (id) => ipcRenderer.invoke('db:deleteSong', id),
    getSongCount: () => ipcRenderer.invoke('db:getSongCount'),
    clearAllSongs: () => ipcRenderer.invoke('db:clearAllSongs'),
    refreshAllSongs: () => ipcRenderer.invoke('db:refreshAllSongs'),
    removeMissingSongs: () => ipcRenderer.invoke('db:removeMissingSongs'),
    scanDirectory: () => ipcRenderer.invoke('db:scanDirectory'),
    getCoverBase64: (coverPath) => ipcRenderer.invoke('db:getCoverBase64', coverPath)
  },

  // 应用设置（存储到项目 db/settings.json）
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s)
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    show: () => ipcRenderer.invoke('window:show'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  // 多媒体按键
  mediaKeys: {
    setEnabled: (enabled) => ipcRenderer.invoke('mediaKeys:setEnabled', enabled),
    onAction: (callback) => ipcRenderer.on('media-key-action', (_event, action) => callback(action))
  },

  // 自定义主题背景
  theme: {
    pickCustom: () => ipcRenderer.invoke('theme:pickCustom')
  },

  // 桌面歌词窗口
  lyrics: {
    // 主渲染进程：开启/关闭桌面歌词窗口
    setEnabled: (enabled) => ipcRenderer.invoke('lyrics:setEnabled', enabled),
    // 主渲染进程：推送当前歌词数据（主进程转发到歌词窗口）
    pushData: (data) => ipcRenderer.send('lyrics:data', data),
    // 主渲染进程：推送样式设置（主进程转发到歌词窗口）
    pushStyle: (style) => ipcRenderer.send('lyrics:style', style),
    // 主渲染进程：监听窗口状态变化（由主进程广播）
    onEnabledChanged: (callback) => ipcRenderer.on('lyrics:enabled', (_event, enabled) => callback(enabled)),
    // 歌词窗口：接收歌词数据更新
    onUpdate: (callback) => ipcRenderer.on('lyrics:update', (_event, data) => callback(data)),
    // 歌词窗口：接收样式设置更新
    onStyle: (callback) => ipcRenderer.on('lyrics:style', (_event, style) => callback(style))
  }
})
