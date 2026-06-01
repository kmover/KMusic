const isElectron = !!(window.electronAPI)

function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

let _api = null

export function useApi() {
  if (_api) return _api

  async function invoke(channel, ...args) {
    if (isElectron && window.electronAPI.db) {
      const method = channel.replace('db:', '')
      if (typeof window.electronAPI.db[method] === 'function') {
        return await window.electronAPI.db[method](...args)
      }
    }
    return browserFallback(channel, ...args)
  }

  function browserFallback(channel, ...args) {
    const KEY = 'kmusic_data'
    let data = JSON.parse(localStorage.getItem(KEY) || '{"categories":[],"songs":[]}')

    switch (channel) {
      case 'db:getCategories': return data.categories
      case 'db:addCategory': {
        const name = args[0].trim()
        if (!name) throw new Error('分组名称不能为空')
        if (data.categories.find(c => c.name === name)) throw new Error('分组名称已存在')
        const cat = { id: Date.now(), name, created_at: new Date().toISOString() }
        data.categories.push(cat)
        localStorage.setItem(KEY, JSON.stringify(data))
        return cat
      }
      case 'db:deleteCategory': {
        const id = args[0]
        data.categories = data.categories.filter(c => c.id !== id)
        data.songs = data.songs.filter(s => s.category_id !== id)
        localStorage.setItem(KEY, JSON.stringify(data))
        return { changes: 1 }
      }
      case 'db:renameCategory': {
        const id = args[0]
        const newName = args[1].trim()
        if (!newName) throw new Error('分组名称不能为空')
        if (data.categories.find(c => c.name === newName && c.id !== id)) throw new Error('分组名称已存在')
        const cat = data.categories.find(c => c.id === id)
        if (!cat) throw new Error('分组不存在')
        cat.name = newName
        localStorage.setItem(KEY, JSON.stringify(data))
        return { changes: 1 }
      }
      case 'db:getSongsByCategory': return data.songs.filter(s => s.category_id === args[0])
      case 'db:importSongs': return { success: false, count: 0, message: '浏览器模式不支持导入文件' }
      case 'db:deleteSong': {
        data.songs = data.songs.filter(s => s.id !== args[0])
        localStorage.setItem(KEY, JSON.stringify(data))
        return { changes: 1 }
      }
      case 'db:getCoverBase64': return null
      case 'db:clearAllSongs': {
        data.songs = []
        localStorage.setItem(KEY, JSON.stringify(data))
        return { deleted: 0 }
      }
      case 'db:refreshAllSongs': return { success: true, updated: 0, total: 0 }
      case 'db:removeMissingSongs': return { removed: 0 }
      case 'db:scanDirectory': return { success: false, message: '浏览器模式不支持此功能' }
      default: return null
    }
  }

  _api = {
    async getCategories() { return (await invoke('db:getCategories')) || [] },
    async addCategory(name) { return await invoke('db:addCategory', name) },
    async renameCategory(id, newName) { return await invoke('db:renameCategory', id, newName) },
    async deleteCategory(id) { return await invoke('db:deleteCategory', id) },
    async getSongsByCategory(categoryId) { return (await invoke('db:getSongsByCategory', categoryId)) || [] },
    async importSongs(categoryId) { return await invoke('db:importSongs', categoryId) },
    async deleteSong(id) { return await invoke('db:deleteSong', id) },
    async getCoverBase64(coverPath) { return await invoke('db:getCoverBase64', coverPath) },
    async clearAllSongs() { return await invoke('db:clearAllSongs') },
    async refreshAllSongs() { return await invoke('db:refreshAllSongs') },
    async removeMissingSongs() { return await invoke('db:removeMissingSongs') },
    async scanDirectory() { return await invoke('db:scanDirectory') },
    async pickCustomTheme() {
      if (isElectron && window.electronAPI.theme) {
        return await window.electronAPI.theme.pickCustom()
      }
      return null
    },
  }

  return _api
}
