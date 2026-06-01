<template>
  <div id="app-root" @click="onRootClick">
    <!-- 自定义标题栏 -->
    <TitleBar />

    <!-- 频谱可视化层（始终显示） -->
    <SpectrumLayer />

    <!-- 播放列表（可切换显示） -->
    <div id="app" v-show="library.showPlaylist">
      <Sidebar />
      <main id="main-content">
        <SongTable />
      </main>
    </div>

    <!-- 底部播放器 -->
    <PlayerBar />

    <!-- 设置面板 -->
    <SettingsPanel v-if="library.showSettings" />

    <!-- 弹窗 -->
    <GroupModal />
    <ConfirmModal />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useAudioEngine } from '@/composables/useAudioEngine'

import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import SongTable from './components/SongTable.vue'
import PlayerBar from './components/PlayerBar.vue'
import SpectrumLayer from './components/SpectrumLayer.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import GroupModal from './components/GroupModal.vue'
import ConfirmModal from './components/ConfirmModal.vue'

const library = useLibraryStore()
const player = usePlayerStore()
const audioEngine = useAudioEngine()

const isElectron = !!(window.electronAPI)

function onRootClick() {
  if (library.showSettings) library.closeSettings()
}

onMounted(async () => {
  // Load settings
  const settings = await library.loadSettings()

  // Apply settings to player
  player.volume = (settings.volume !== undefined) ? settings.volume : 0.7
  player.isMuted = !!settings.isMuted
  player.repeatMode = settings.repeatMode || 'all'
  player.shuffleMode = !!settings.shuffleMode
  player.spectrumMode = settings.spectrumMode || 'bar'
  player.reverbEnabled = !!settings.reverbEnabled
  player.reverbWetGain = (settings.reverbWetGain !== undefined) ? settings.reverbWetGain : 0.35
  player.bassBoostEnabled = !!settings.bassBoostEnabled
  player.bassBoostFreq = settings.bassBoostFreq || 80
  player.bassBoostGain = (settings.bassBoostGain !== undefined) ? settings.bassBoostGain : 8
  player.bassBoostWetGain = (settings.bassBoostWetGain !== undefined) ? settings.bassBoostWetGain : 0.5

  // 恢复播放列表可见性：首次渲染时 showPlaylist 已为 true（浏览器已完成首帧布局），
  // 此处根据持久化设置决定是否隐藏。上次关闭时可见则保持显示，否则隐藏。
  if (!library._restorePlaylistVisible) {
    library.showPlaylist = false
  }

  // Load groups
  await library.loadGroups()

  const categories = library.categories
  const restoreGroupId = library._restoreGroupId
  const restoreSongId = library._restoreSongId

  if (restoreGroupId && categories.find(c => c.id === restoreGroupId)) {
    await library.selectGroup(restoreGroupId, categories.find(c => c.id === restoreGroupId).name)
  } else if (categories.length > 0) {
    await library.selectGroup(categories[0].id, categories[0].name)
  }

  // Restore last song (don't auto play)
  if (restoreSongId && restoreGroupId) {
    const idx = library.filteredSongs.findIndex(s => s.id === restoreSongId)
    if (idx >= 0) {
      player.currentSongIndex = idx
    }
  }

  // Keyboard shortcuts (global)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return

    const shortcuts = library.shortcuts
    const action = Object.entries(shortcuts).find(([, code]) => code && code === e.code)
    if (action) {
      switch (action[0]) {
        case 'play':
          e.preventDefault()
          player.togglePlay()
          return
        case 'prev':
          player.playPrev()
          return
        case 'next':
          player.playNext()
          return
        case 'volup':
          e.preventDefault()
          player.adjustVolume(0.05)
          return
        case 'voldown':
          e.preventDefault()
          player.adjustVolume(-0.05)
          return
      }
    }

    // Arrow keys for seeking
    if (e.code === 'ArrowLeft') {
      audioEngine.adjustTime(-5)
    } else if (e.code === 'ArrowRight') {
      audioEngine.adjustTime(5)
    }
  })

  // Media keys (Electron)
  if (isElectron && window.electronAPI.mediaKeys) {
    window.electronAPI.mediaKeys.onAction((action) => {
      if (action === 'playpause') player.togglePlay()
      else if (action === 'play') { if (!player.isPlaying) player.togglePlay() }
      else if (action === 'pause') { if (player.isPlaying) player.togglePlay() }
      else if (action === 'next') player.playNext()
      else if (action === 'prev') player.playPrev()
    })
  }

  // Auto-save settings periodically
  window.addEventListener('beforeunload', () => {
    library.saveSettings(player)
  })

  // Save settings on song change
  const originalPlaySong = player.playSong
  player.playSong = (index) => {
    originalPlaySong.call(player, index)
    library.saveSettings(player)
    // Auto-close playlist
    if (library.autoClosePlaylist && library.showPlaylist) {
      library.showPlaylist = false
    }
  }
})

// Save settings when closing
import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => {
  library.saveSettings(player)
})
</script>

<style scoped>
#app-root {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

#app {
  display: flex;
  flex: 1;
  overflow: hidden;
  height: calc(100vh - var(--titlebar-height) - var(--player-height));
  position: relative;
  z-index: 11;
  background: var(--bg-primary);
}
</style>
