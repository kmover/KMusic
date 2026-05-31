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
  }
})
