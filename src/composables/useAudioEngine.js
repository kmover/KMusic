import { ref, watch, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '@/stores/player'

// Singleton audio engine
let audioCtx = null
let analyserNode = null
let spectrumDataArray = null
let sourceNode = null
let dryGainNode = null
let revWetGainNode = null
let bassWetGainNode = null
let convolverNode = null
let bassFilterNode = null
let audioEl = null
let circleCenterImage = new Image()

export function useAudioEngine() {
  const player = usePlayerStore()
  const currentTime = ref(0)
  const duration = ref(0)
  const lrcCurrentLine = ref(-1)
  const progressAnimId = ref(null)

  function setAudioElement(el) {
    audioEl = el
    bindAudioEvents()
  }

  function bindAudioEvents() {
    if (!audioEl) return
    audioEl.addEventListener('timeupdate', onTimeUpdate)
    audioEl.addEventListener('loadedmetadata', onLoadedMeta)
    audioEl.addEventListener('ended', onEnded)
    audioEl.addEventListener('play', () => { player.togglePlay(); player.isPlaying = true })
    audioEl.addEventListener('pause', () => { player.isPlaying = false })
    audioEl.addEventListener('error', onError)
  }

  function onTimeUpdate() {
    if (!audioEl || !audioEl.duration || !isFinite(audioEl.duration)) return
    currentTime.value = audioEl.currentTime
    duration.value = audioEl.duration
  }

  function onLoadedMeta() {
    if (!audioEl) return
    duration.value = audioEl.duration
  }

  function onEnded() {
    if (player.repeatMode === 'one') {
      if (audioEl) { audioEl.currentTime = 0; audioEl.play() }
    } else {
      player.playNext()
      // Component will watch currentSongIndex and reload
    }
  }

  function onError(e) {
    if (!audioEl || !audioEl.src || audioEl.src === window.location.href) return
    const song = player.currentSong
    console.error('音频加载错误:', song ? song.file_path : '(无歌曲)', e)
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

  // ---- Web Audio API ----

  function generateImpulseResponse(sampleRate, duration) {
    const length = Math.floor(sampleRate * duration)
    const buffer = audioCtx.createBuffer(2, length, sampleRate)
    const decayRate = 3.5
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * decayRate)
      }
    }
    return buffer
  }

  function updateConvolverIR() {
    if (!convolverNode || !audioCtx) return
    convolverNode.buffer = generateImpulseResponse(audioCtx.sampleRate, 1.8)
  }

  function initAudioContext() {
    if (audioCtx) return
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()

    analyserNode = audioCtx.createAnalyser()
    analyserNode.fftSize = 256
    spectrumDataArray = new Uint8Array(analyserNode.frequencyBinCount)

    dryGainNode = audioCtx.createGain()
    dryGainNode.gain.value = 1.0
    dryGainNode.connect(audioCtx.destination)

    revWetGainNode = audioCtx.createGain()
    revWetGainNode.gain.value = player.reverbEnabled ? player.reverbWetGain : 0
    revWetGainNode.connect(audioCtx.destination)

    convolverNode = audioCtx.createConvolver()
    convolverNode.connect(revWetGainNode)
    updateConvolverIR()

    bassWetGainNode = audioCtx.createGain()
    bassWetGainNode.gain.value = player.bassBoostEnabled ? player.bassBoostWetGain : 0
    bassWetGainNode.connect(audioCtx.destination)

    bassFilterNode = audioCtx.createBiquadFilter()
    bassFilterNode.type = 'lowshelf'
    bassFilterNode.frequency.value = player.bassBoostFreq
    bassFilterNode.gain.value = player.bassBoostGain
    bassFilterNode.connect(bassWetGainNode)
  }

  function connectSource(el) {
    const targetEl = el || audioEl
    if (!targetEl) return
    if (!audioCtx) initAudioContext()
    try {
      sourceNode = audioCtx.createMediaElementSource(targetEl)
      sourceNode.connect(analyserNode)
      sourceNode.connect(dryGainNode)
      sourceNode.connect(convolverNode)
      sourceNode.connect(bassFilterNode)
      targetEl._spectrumConnected = true
    } catch (e) {
      // already connected
    }
  }

  function updateReverb() {
    if (revWetGainNode) {
      revWetGainNode.gain.value = player.reverbEnabled ? player.reverbWetGain : 0
    }
  }

  function updateBassFilter() {
    if (bassFilterNode) {
      bassFilterNode.frequency.value = player.bassBoostFreq
      bassFilterNode.gain.value = player.bassBoostGain
    }
    if (bassWetGainNode) {
      bassWetGainNode.gain.value = player.bassBoostEnabled ? player.bassBoostWetGain : 0
    }
  }

  function resolveFilePath(filePath) {
    if (!filePath) return ''
    const isElectron = !!(window.electronAPI)
    if (isElectron) {
      const normalized = filePath.replace(/\\/g, '/')
      return 'music://local/' + encodeURIComponent(normalized)
    }
    return filePath
  }

  async function loadAndPlay(song) {
    if (!audioEl || !song) return
    initAudioContext()
    audioEl.src = resolveFilePath(song.file_path)
    audioEl.volume = player.effectiveVolume
    if (!audioEl._spectrumConnected) {
      connectSource()
    }
    try {
      await audioEl.play()
      player.isPlaying = true
      player._errorSkipCount = 0
    } catch (err) {
      console.error('播放失败:', err)
      player.isPlaying = false
    }
  }

  function pause() {
    if (audioEl) audioEl.pause()
  }

  function resume() {
    if (audioEl) audioEl.play().catch(e => console.error('恢复失败:', e))
  }

  function stop() {
    if (audioEl) {
      audioEl.pause()
      audioEl.src = ''
    }
  }

  function seek(percent) {
    if (audioEl && audioEl.duration && isFinite(audioEl.duration)) {
      audioEl.currentTime = Math.max(0, Math.min(1, percent)) * audioEl.duration
    }
  }

  function seekTime(seconds) {
    if (audioEl) {
      audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || 0, seconds))
    }
  }

  function adjustTime(delta) {
    if (audioEl) {
      audioEl.currentTime = Math.max(0, Math.min(audioEl.duration || 0, audioEl.currentTime + delta))
    }
  }

  // Cleanup
  onBeforeUnmount(() => {
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
    if (audioEl) {
      audioEl.removeEventListener('timeupdate', onTimeUpdate)
      audioEl.removeEventListener('loadedmetadata', onLoadedMeta)
      audioEl.removeEventListener('ended', onEnded)
    }
  })

  return {
    currentTime, duration, lrcCurrentLine,
    setAudioElement,
    initAudioContext, connectSource,
    loadAndPlay, pause, resume, stop,
    seek, seekTime, adjustTime,
    updateReverb, updateBassFilter,
    resolveFilePath,
    // expose for visualizer
    getAnalyserNode: () => analyserNode,
    getSpectrumData: () => spectrumDataArray,
    getCircleImage: () => circleCenterImage,
    setCircleImage: (img) => { circleCenterImage = img },
  }
}
