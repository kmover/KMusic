import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useLibraryStore } from './library'

export const usePlayerStore = defineStore('player', () => {
  const library = useLibraryStore()

  // ---- State ----
  const currentSongIndex = ref(-1)
  const isPlaying = ref(false)
  const volume = ref(0.7)
  const isMuted = ref(false)
  const repeatMode = ref('all')     // none | one | all
  const shuffleMode = ref(false)
  const spectrumVisible = ref(true)
  const spectrumMode = ref('bar')   // bar | square | 3d
  const reverbEnabled = ref(false)
  const reverbWetGain = ref(0.35)
  const bassBoostEnabled = ref(false)
  const bassBoostFreq = ref(80)
  const bassBoostGain = ref(8)
  const bassBoostWetGain = ref(0.5)
  const lrcLines = ref([])
  const currentLrcLine = ref(-1)

  // ---- Getters ----
  const currentSong = computed(() => {
    const list = library.filteredSongs
    if (currentSongIndex.value >= 0 && currentSongIndex.value < list.length) {
      return list[currentSongIndex.value]
    }
    return null
  })

  const playlist = computed(() => library.filteredSongs)

  const effectiveVolume = computed(() => isMuted.value ? 0 : volume.value)

  // ---- Actions ----
  function playSong(index) {
    if (index < 0 || index >= playlist.value.length) return
    currentSongIndex.value = index
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value
  }

  function playNext() {
    const list = playlist.value
    if (list.length === 0) return
    let nextIndex
    if (shuffleMode.value) {
      const others = list.map((_, i) => i).filter(i => i !== currentSongIndex.value)
      if (others.length === 0) {
        if (repeatMode.value === 'one') { return currentSongIndex.value }
        stopPlayback()
        return
      }
      nextIndex = others[Math.floor(Math.random() * others.length)]
    } else {
      nextIndex = currentSongIndex.value + 1
      if (nextIndex >= list.length) {
        nextIndex = repeatMode.value === 'all' ? 0 : currentSongIndex.value
        if (nextIndex === currentSongIndex.value && repeatMode.value !== 'all') {
          stopPlayback()
          return
        }
      }
    }
    currentSongIndex.value = nextIndex
  }

  function playPrev() {
    const list = playlist.value
    if (list.length === 0) return
    let prevIndex
    if (shuffleMode.value) {
      const others = list.map((_, i) => i).filter(i => i !== currentSongIndex.value)
      if (others.length > 0) {
        prevIndex = others[Math.floor(Math.random() * others.length)]
      }
    }
    if (prevIndex === undefined) {
      prevIndex = currentSongIndex.value - 1
      if (prevIndex < 0) prevIndex = list.length - 1
    }
    currentSongIndex.value = prevIndex
  }

  function stopPlayback() {
    isPlaying.value = false
    currentSongIndex.value = -1
    lrcLines.value = []
    currentLrcLine.value = -1
  }

  function togglePlayMode() {
    const modes = [
      { repeatMode: 'all', shuffleMode: false, icon: 'fa-arrow-rotate-right', title: '循环模式' },
      { repeatMode: 'none', shuffleMode: true, icon: 'fa-shuffle', title: '随机模式' },
      { repeatMode: 'one', shuffleMode: false, icon: 'fa-arrows-to-circle', title: '单曲重复' },
    ]
    let idx = modes.findIndex(m => m.repeatMode === repeatMode.value && m.shuffleMode === shuffleMode.value)
    if (idx === -1) idx = 0
    const next = modes[(idx + 1) % modes.length]
    repeatMode.value = next.repeatMode
    shuffleMode.value = next.shuffleMode
  }

  function toggleSpectrum() {
    spectrumVisible.value = !spectrumVisible.value
  }

  function cycleSpectrumMode() {
    const modes = ['bar', 'square', '3d']
    const idx = modes.indexOf(spectrumMode.value)
    spectrumMode.value = modes[(idx + 1) % modes.length]
  }

  function selectSpectrumMode(mode) {
    if (spectrumMode.value !== mode) {
      spectrumMode.value = mode
    }
  }

  function toggleMute() {
    isMuted.value = !isMuted.value
  }

  function setVolume(val) {
    volume.value = Math.max(0, Math.min(1, val))
    isMuted.value = false
  }

  function adjustVolume(delta) {
    setVolume(volume.value + delta)
  }

  function toggleReverb(enabled) {
    reverbEnabled.value = enabled
  }

  function toggleBassBoost(enabled) {
    bassBoostEnabled.value = enabled
  }

  return {
    // state
    currentSongIndex, isPlaying, volume, isMuted,
    repeatMode, shuffleMode,
    spectrumVisible, spectrumMode,
    reverbEnabled, reverbWetGain,
    bassBoostEnabled, bassBoostFreq, bassBoostGain, bassBoostWetGain,
    lrcLines, currentLrcLine,
    // getters
    currentSong, playlist, effectiveVolume,
    // actions
    playSong, togglePlay, playNext, playPrev, stopPlayback,
    togglePlayMode, toggleSpectrum, cycleSpectrumMode, selectSpectrumMode,
    toggleMute, setVolume, adjustVolume,
    toggleReverb, toggleBassBoost,
  }
})
