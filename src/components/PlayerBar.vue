<template>
  <footer id="player-bar">
    <!-- 当前歌曲信息 -->
    <div class="player-info">
      <div class="player-cover" id="player-cover" :class="{ 'has-cover': hasCover }" :style="{ backgroundImage: coverUrl }">
        <i v-if="!hasCover" :class="coverIconClass"></i>
      </div>
      <div class="player-meta">
        <div class="player-title" id="player-title">{{ currentTitle }}</div>
        <div class="player-artist" id="player-artist">{{ currentArtist }}</div>
        <div class="player-lrc" id="player-lrc">{{ currentLrcText }}</div>
      </div>
    </div>

    <!-- 播放控制 -->
    <div class="player-controls" @click.stop>
      <div class="player-progress">
        <span id="time-current">{{ formatTime(audioEngine.currentTime.value) }}</span>
        <div class="progress-bar" id="progress-bar" @mousedown="startDragProgress" ref="progressBar">
          <div class="progress-track">
            <div class="progress-fill" id="progress-fill" :style="{ width: progressPercent + '%' }">
              <div class="progress-thumb"></div>
            </div>
          </div>
        </div>
        <span id="time-total">{{ formatTime(audioEngine.duration.value) }}</span>
      </div>
      <div class="player-actions">
        <button class="btn-ctrl btn-mode" :class="{ active: showModeActive }" :title="modeLabel" @click="player.togglePlayMode()">
          <i :class="'fa-solid ' + modeIcon"></i>
        </button>
        <button class="btn-ctrl" title="上一曲" @click.stop="playPrev()">
          <i class="fa-solid fa-backward-step"></i>
        </button>
        <button class="btn-ctrl btn-play" title="播放" @click.stop="togglePlay()">
          <i :class="player.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
        </button>
        <button class="btn-ctrl" title="下一曲" @click.stop="playNext()">
          <i class="fa-solid fa-forward-step"></i>
        </button>
        <button class="btn-volume-icon" title="静音" @click.stop="player.toggleMute()">
          <i :class="volumeIconClass"></i>
        </button>
        <div class="volume-bar" id="volume-bar" @mousedown="startDragVolume" ref="volumeBar">
          <div class="volume-track">
            <div class="volume-fill" id="volume-fill" :style="{ width: (player.effectiveVolume * 100) + '%' }">
              <div class="volume-thumb"></div>
            </div>
          </div>
        </div>
        <button class="btn-ctrl" title="播放列表" @click.stop="library.togglePlaylist()">
          <i class="fa-solid fa-list"></i>
        </button>
        <button class="btn-ctrl" title="设置" @click.stop="library.toggleSettings()">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>

    <audio
      ref="audioRef"
      id="audio-player"
      preload="auto"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMeta"
      @ended="onEnded"
      @play="onPlay"
      @pause="onPause"
      @error="onError"
      @canplay="onCanPlay"
    ></audio>
  </footer>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useAudioEngine } from '@/composables/useAudioEngine'
import { useApi } from '@/composables/useApi'
import { parseLrc, parseRawLyricsFirstLine, getCurrentLrcLine, formatTime } from '@/composables/useLyrics'
import { useVisualizer } from '@/composables/useVisualizer'

const library = useLibraryStore()
const player = usePlayerStore()
const api = useApi()
const audioEngine = useAudioEngine()
const visualizer = useVisualizer()

const audioRef = ref(null)
const progressBar = ref(null)
const volumeBar = ref(null)
const hasCover = ref(false)
const coverUrl = ref('')
const currentLrcText = ref('')
const lrcLines = ref([])
const lastLrcLine = ref(-1)
let isDraggingProgress = false
let isDraggingVolume = false

// Computed

const currentTitle = computed(() => player.currentSong?.title || '未在播放')
const currentArtist = computed(() => player.currentSong?.artist || '--')
const progressPercent = computed(() => {
  const dur = audioEngine.duration.value
  const cur = audioEngine.currentTime.value
  if (!dur || !isFinite(dur)) return 0
  return (cur / dur) * 100
})

const volumeIconClass = computed(() => {
  if (player.isMuted || player.volume === 0) return 'fa-solid fa-volume-xmark'
  if (player.volume < 0.5) return 'fa-solid fa-volume-low'
  return 'fa-solid fa-volume-high'
})

const coverIconClass = computed(() => {
  return player.isPlaying
    ? 'fa-solid fa-compact-disc fa-spin'
    : 'fa-solid fa-compact-disc'
})

const modeIcon = computed(() => {
  const modes = [
    { repeatMode: 'all', shuffleMode: false, icon: 'fa-arrow-rotate-right', title: '循环模式' },
    { repeatMode: 'none', shuffleMode: true, icon: 'fa-shuffle', title: '随机模式' },
    { repeatMode: 'one', shuffleMode: false, icon: 'fa-arrows-to-circle', title: '单曲重复' },
  ]
  const m = modes.find(m =>
    m.repeatMode === player.repeatMode && m.shuffleMode === player.shuffleMode
  ) || modes[0]
  return m.icon
})

const modeLabel = computed(() => {
  const modes = [
    { repeatMode: 'all', shuffleMode: false, icon: 'fa-arrow-rotate-right', title: '循环模式' },
    { repeatMode: 'none', shuffleMode: true, icon: 'fa-shuffle', title: '随机模式' },
    { repeatMode: 'one', shuffleMode: false, icon: 'fa-arrows-to-circle', title: '单曲重复' },
  ]
  const m = modes.find(m =>
    m.repeatMode === player.repeatMode && m.shuffleMode === player.shuffleMode
  ) || modes[0]
  return m.title
})

const showModeActive = computed(() => player.shuffleMode || player.repeatMode === 'one')

// Audio element events

function onTimeUpdate() {
  if (!audioRef.value || !audioRef.value.duration || !isFinite(audioRef.value.duration)) return
  audioEngine.currentTime.value = audioRef.value.currentTime
  audioEngine.duration.value = audioRef.value.duration

  // LRC sync
  if (lrcLines.value.length > 0) {
    const idx = getCurrentLrcLine(lrcLines.value, audioRef.value.currentTime)
    if (idx >= 0) {
      currentLrcText.value = lrcLines.value[idx].text
      if (idx !== lastLrcLine.value) {
        lastLrcLine.value = idx
        player.currentLrcLine = idx  // 同步到 store，供 SpectrumLayer 使用
      }
    } else {
      currentLrcText.value = ''
      player.currentLrcLine = -1
    }
  } else {
    currentLrcText.value = ''
    player.currentLrcLine = -1
  }
}

function onLoadedMeta() {
  if (audioRef.value) {
    audioEngine.duration.value = audioRef.value.duration
  }
}

function onEnded() {
  if (player.repeatMode === 'one') {
    if (audioRef.value) {
      audioRef.value.currentTime = 0
      audioRef.value.play()
    }
  } else {
    player.playNext()
  }
}

function onPlay() {
  player.isPlaying = true
}

function onPause() {
  player.isPlaying = false
}

function onError(e) {
  if (!audioRef.value || !audioRef.value.src || audioRef.value.src === window.location.href) return
  console.error('音频加载错误:', player.currentSong?.file_path, e)
  if (player.playlist.length > 0 && player.currentSongIndex >= 0) {
    player._errorSkipCount = (player._errorSkipCount || 0) + 1
    if (player._errorSkipCount >= player.playlist.length) {
      player._errorSkipCount = 0
      player.stopPlayback()
      return
    }
    player.playNext()
  }
}

function onCanPlay() {
  // Audio ready
}

// Playback controls

function togglePlay() {
  if (!audioRef.value || !audioRef.value.src || audioRef.value.src === window.location.href) return
  if (player.isPlaying) {
    audioRef.value.pause()
  } else {
    audioRef.value.play().catch(() => {})
  }
}

function playNext() {
  player.playNext()
}

function playPrev() {
  player.playPrev()
}

// Progress drag

function startDragProgress(e) {
  isDraggingProgress = true
  seekProgress(e)
}

function seekProgress(e) {
  if (!audioRef.value || !audioRef.value.duration || !isFinite(audioRef.value.duration)) return
  const rect = progressBar.value.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  audioRef.value.currentTime = percent * audioRef.value.duration
}

// Volume drag

function startDragVolume(e) {
  isDraggingVolume = true
  seekVolume(e)
}

function seekVolume(e) {
  const rect = volumeBar.value.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  player.setVolume(percent)
  if (audioRef.value) {
    audioRef.value.volume = player.effectiveVolume
  }
}

// Mouse events for drag
onMounted(() => {
  document.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) seekProgress(e)
    if (isDraggingVolume) seekVolume(e)
  })
  document.addEventListener('mouseup', () => {
    isDraggingProgress = false
    isDraggingVolume = false
  })
})

// Watch current song change → load audio

watch(() => player.currentSongIndex, async (newIdx) => {
  if (newIdx < 0) return
  const song = player.playlist[newIdx]
  if (!song) return

  await nextTick()

  // Load cover
  loadCover(song)

  // Parse LRC
  const rawLyrics = song.lyrics || ''
  lrcLines.value = parseLrc(rawLyrics)
  player.lrcLines = lrcLines.value  // 同步到 store，供 SpectrumLayer 使用
  player.currentLrcLine = -1
  if (lrcLines.value.length === 0 && rawLyrics) {
    currentLrcText.value = parseRawLyricsFirstLine(rawLyrics)
  } else {
    currentLrcText.value = ''
  }

  // Load audio
  if (audioRef.value) {
    const fileUrl = audioEngine.resolveFilePath(song.file_path)
    audioRef.value.src = fileUrl
    audioRef.value.volume = player.effectiveVolume
    audioEngine.initAudioContext()
    if (!audioRef.value._spectrumConnected) {
      audioEngine.connectSource(audioRef.value)
    }
    try {
      await audioRef.value.play()
      player.isPlaying = true
    } catch (err) {
      console.error('播放失败:', err)
      player.isPlaying = false
    }
  }
})

// Watch isPlaying → 控制音频播放/暂停（响应键盘快捷键和媒体键）
watch(() => player.isPlaying, (playing) => {
  if (!audioRef.value || !audioRef.value.src || audioRef.value.src === window.location.href) return
  if (playing) {
    audioRef.value.play().catch(() => {})
  } else {
    audioRef.value.pause()
  }
})

// Watch volume
watch(() => player.effectiveVolume, (vol) => {
  if (audioRef.value) {
    audioRef.value.volume = vol
  }
})

// Watch audio effects
watch(() => player.reverbEnabled, (val) => {
  audioEngine.updateReverb()
})

watch(() => player.reverbWetGain, () => {
  audioEngine.updateReverb()
})

watch(() => player.bassBoostEnabled, () => {
  audioEngine.updateBassFilter()
})

watch(() => player.bassBoostFreq, () => {
  audioEngine.updateBassFilter()
})

watch(() => player.bassBoostGain, () => {
  audioEngine.updateBassFilter()
})

watch(() => player.bassBoostWetGain, () => {
  audioEngine.updateBassFilter()
})

async function loadCover(song) {
  if (!song.cover) {
    hasCover.value = false
    coverUrl.value = ''
    return
  }
  try {
    const base64 = await api.getCoverBase64(song.cover)
    if (base64) {
      hasCover.value = true
      coverUrl.value = `url(${base64})`
      // Load into circle center image
      const img = new Image()
      img.src = base64
      img.onload = () => {
        audioEngine.setCircleImage(img)
      }
    } else {
      hasCover.value = false
      coverUrl.value = ''
    }
  } catch (e) {
    hasCover.value = false
    coverUrl.value = ''
  }
}

// Expose audio ref for visualizer
defineExpose({ audioRef })
</script>

<style scoped>
/* PlayerBar styles are in global style.css */
</style>
