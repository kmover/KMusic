import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApi } from '@/composables/useApi'

export const useLibraryStore = defineStore('library', () => {
  const api = useApi()

  // ---- State ----
  const categories = ref([])
  const currentGroupId = ref(null)
  const currentGroupName = ref('')
  const songs = ref([])
  const sortKey = ref(null)       // null | 'title' | 'artist'
  const sortOrder = ref('asc')
  const searchQuery = ref('')
  const searchActiveIndex = ref(0)
  const themeBg = ref('./background/img-green.jpg')
  const customThemes = ref([])
  const mediaKeysEnabled = ref(true)
  const autoClosePlaylist = ref(true)
  const shortcuts = ref({
    play: 'Space', prev: '', next: '',
    volup: 'ArrowUp', voldown: 'ArrowDown'
  })
  const showSettings = ref(false)
  const showPlaylist = ref(false)
  const showGroupModal = ref(false)
  const showConfirmModal = ref(false)
  const confirmMessage = ref('')
  const confirmCallback = ref(null)

  // restore state
  const _restoreGroupId = ref(null)
  const _restoreSongId = ref(null)
  const _restorePlaylistVisible = ref(false)

  // ---- Getters ----
  const filteredSongs = computed(() => {
    let list = [...songs.value]

    // sort
    if (sortKey.value) {
      list.sort((a, b) => {
        const va = (a[sortKey.value] || '').toLowerCase()
        const vb = (b[sortKey.value] || '').toLowerCase()
        const cmp = va.localeCompare(vb, 'zh-Hans-CN')
        return sortOrder.value === 'asc' ? cmp : -cmp
      })
    }
    return list
  })

  const currentThemeUrl = computed(() => {
    const path = themeBg.value
    if (path && path.startsWith('covers/custom/')) {
      return `bg://custom/${path.replace('covers/custom/', '')}`
    }
    return path
  })

  const modeDisplay = computed(() => {
    const modes = [
      { repeatMode: 'all', shuffleMode: false, icon: 'fa-arrow-rotate-right', title: '循环模式' },
      { repeatMode: 'none', shuffleMode: true, icon: 'fa-shuffle', title: '随机模式' },
      { repeatMode: 'one', shuffleMode: false, icon: 'fa-arrows-to-circle', title: '单曲重复' },
    ]
    // this would need player store but we avoid circular dep
    // handled in component
    return { modes }
  })

  // ---- Actions ----
  async function loadGroups() {
    categories.value = await api.getCategories()
  }

  async function selectGroup(id, name) {
    currentGroupId.value = id
    currentGroupName.value = name
    await loadSongs(id)
  }

  async function addGroup(name) {
    await api.addCategory(name)
    await loadGroups()
  }

  async function deleteGroup(id) {
    await api.deleteCategory(id)
    await loadGroups()
  }

  async function renameGroup(id, newName) {
    await api.renameCategory(id, newName)
    if (id === currentGroupId.value) {
      currentGroupName.value = newName
    }
    await loadGroups()
  }

  async function loadSongs(categoryId) {
    const sid = categoryId || currentGroupId.value
    if (!sid) return
    songs.value = await api.getSongsByCategory(sid)
    searchActiveIndex.value = 0
  }

  async function importSongs(categoryId) {
    const targetId = categoryId || currentGroupId.value
    if (!targetId) return { success: false, message: '请先选择分组' }
    const result = await api.importSongs(targetId)
    if (result.success) {
      await loadSongs(targetId)
    }
    return result
  }

  async function deleteSong(songId) {
    await api.deleteSong(songId)
    await loadSongs(currentGroupId.value)
  }

  function toggleSort(key) {
    if (sortKey.value === key) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortKey.value = key
      sortOrder.value = 'asc'
    }
  }

  function doSearch() {
    searchActiveIndex.value = 0
  }

  function selectTheme(path) {
    themeBg.value = path
  }

  function addCustomTheme(theme) {
    customThemes.value.push(theme)
  }

  function removeCustomTheme(index) {
    customThemes.value.splice(index, 1)
  }

  function toggleSettings() {
    showSettings.value = !showSettings.value
  }

  function closeSettings() {
    showSettings.value = false
  }

  function togglePlaylist() {
    showPlaylist.value = !showPlaylist.value
  }

  function openGroupModal() {
    showGroupModal.value = true
  }

  function closeGroupModal() {
    showGroupModal.value = false
  }

  function showConfirm(message, cb) {
    confirmMessage.value = message
    confirmCallback.value = cb
    showConfirmModal.value = true
  }

  function closeConfirm() {
    showConfirmModal.value = false
    confirmCallback.value = null
  }

  function confirmOk() {
    if (confirmCallback.value) confirmCallback.value()
    closeConfirm()
  }

  // Settings persistence
  function saveSettings(playerStore) {
    const currentSong = playerStore ? playerStore.currentSong : null
    const settings = {
      sortKey: sortKey.value,
      sortOrder: sortOrder.value,
      themeBg: themeBg.value,
      spectrumMode: playerStore ? playerStore.spectrumMode : 'bar',
      volume: playerStore ? playerStore.volume : 0.7,
      isMuted: playerStore ? playerStore.isMuted : false,
      repeatMode: playerStore ? playerStore.repeatMode : 'all',
      shuffleMode: playerStore ? playerStore.shuffleMode : false,
      mediaKeysEnabled: mediaKeysEnabled.value,
      customThemes: customThemes.value,
      autoClosePlaylist: autoClosePlaylist.value,
      reverbEnabled: playerStore ? playerStore.reverbEnabled : false,
      reverbWetGain: playerStore ? playerStore.reverbWetGain : 0.35,
      bassBoostEnabled: playerStore ? playerStore.bassBoostEnabled : false,
      bassBoostFreq: playerStore ? playerStore.bassBoostFreq : 80,
      bassBoostGain: playerStore ? playerStore.bassBoostGain : 8,
      bassBoostWetGain: playerStore ? playerStore.bassBoostWetGain : 0.5,
      shortcuts: shortcuts.value,
      lastGroupId: currentGroupId.value,
      lastSongId: currentSong ? currentSong.id : null,
      playlistVisible: showPlaylist.value,
    }
    const isElectron = !!(window.electronAPI)
    // 深拷贝去除 Vue 响应式 Proxy，避免 IPC 结构化克隆报错
    const plainSettings = JSON.parse(JSON.stringify(settings))
    if (isElectron && window.electronAPI.settings) {
      window.electronAPI.settings.set(plainSettings)
    } else {
      localStorage.setItem('kmusic_settings', JSON.stringify(plainSettings))
    }
  }

  async function loadSettings() {
    let settings = {}
    const isElectron = !!(window.electronAPI)
    if (isElectron && window.electronAPI.settings) {
      settings = (await window.electronAPI.settings.get()) || {}
    } else {
      try {
        settings = JSON.parse(localStorage.getItem('kmusic_settings') || '{}')
      } catch (e) { /* ignore */ }
    }
    sortKey.value = settings.sortKey || null
    sortOrder.value = settings.sortOrder || 'asc'
    themeBg.value = settings.themeBg || './background/img-green.jpg'
    mediaKeysEnabled.value = settings.mediaKeysEnabled !== false
    autoClosePlaylist.value = settings.autoClosePlaylist !== false
    customThemes.value = Array.isArray(settings.customThemes) ? settings.customThemes : []
    shortcuts.value = (settings.shortcuts && typeof settings.shortcuts === 'object')
      ? Object.assign({
          play: 'Space', prev: '', next: '',
          volup: 'ArrowUp', voldown: 'ArrowDown'
        }, settings.shortcuts)
      : { play: 'Space', prev: '', next: '', volup: 'ArrowUp', voldown: 'ArrowDown' }
    _restoreGroupId.value = settings.lastGroupId || null
    _restoreSongId.value = settings.lastSongId || null
    _restorePlaylistVisible.value = settings.playlistVisible

    return settings
  }

  return {
    // state
    categories, currentGroupId, currentGroupName,
    songs, sortKey, sortOrder, searchQuery, searchActiveIndex,
    themeBg, customThemes,
    mediaKeysEnabled, autoClosePlaylist, shortcuts,
    showSettings, showPlaylist,
    showGroupModal, showConfirmModal,
    confirmMessage, confirmCallback,
    _restoreGroupId, _restoreSongId, _restorePlaylistVisible,
    // getters
    filteredSongs, currentThemeUrl, modeDisplay,
    // actions
    loadGroups, selectGroup, addGroup, deleteGroup, renameGroup,
    loadSongs, importSongs, deleteSong,
    toggleSort, doSearch,
    selectTheme, addCustomTheme, removeCustomTheme,
    toggleSettings, closeSettings, togglePlaylist,
    openGroupModal, closeGroupModal,
    showConfirm, closeConfirm, confirmOk,
    saveSettings, loadSettings,
  }
})
