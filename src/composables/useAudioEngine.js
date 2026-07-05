import { ref } from 'vue'
import { usePlayerStore } from '@/stores/player'

// Singleton audio engine
let audioCtx = null
let analyserNode = null
let spectrumDataArray = null
let sourceNode = null
let dryGainNode = null

// Convolution reverb chain
let convolverNode = null
let convolverOutputGainNode = null
let convolverDynamicsCompressor = null
let activeConvolutionFileName = null
let convolutionUpdateToken = 0

// Bass boost chain
let bassWetGainNode = null
let bassFilterNode = null

let audioEl = null
let circleCenterImage = new Image()

// Buffer cache for convolution IR files
const bufferCache = new Map()

// Built-in convolution presets list
// 预设值与 lx-music-desktop 完全一致，mainGain=干声增益，sendGain=混响湿声混入量
export const convolutionPresets = [
  { name: 'default',                label: '默认',         mainGain: 1.0, sendGain: 0.0, source: null },
  { name: 'telephone',              label: '电话',         mainGain: 0.0, sendGain: 3.0, source: 'filter-telephone.wav' },
  { name: 's2_r4_bd',              label: '教堂',         mainGain: 1.8, sendGain: 0.9, source: 's2_r4_bd.wav' },
  { name: 'bright_hall',           label: '大厅',         mainGain: 0.8, sendGain: 2.4, source: 'bright-hall.wav' },
  { name: 'cinema_diningroom',     label: '电影院',       mainGain: 0.6, sendGain: 2.3, source: 'cinema-diningroom.wav' },
  { name: 'dining_living_true_stereo', label: '餐厅',     mainGain: 0.6, sendGain: 1.8, source: 'dining-living-true-stereo.wav' },
  { name: 'living_bedroom_leveled', label: '卫生间',      mainGain: 0.6, sendGain: 2.1, source: 'living-bedroom-leveled.wav' },
  { name: 'spreader50_65ms',       label: '室内',         mainGain: 1.0, sendGain: 2.5, source: 'spreader50-65ms.wav' },
  { name: 'medium_room',           label: '中室',         mainGain: 0.8, sendGain: 2.4, source: 'medium-room1.wav' },
  { name: 's3_r1_bd',              label: '立体声',       mainGain: 1.8, sendGain: 0.8, source: 's3_r1_bd.wav' },
  { name: 'matrix_1',              label: '矩阵混响（1）', mainGain: 1.5, sendGain: 0.9, source: 'matrix-reverb1.wav' },
  { name: 'matrix_2',              label: '矩阵混响（2）', mainGain: 1.3, sendGain: 1.0, source: 'matrix-reverb2.wav' },
  { name: 'cardiod_35_10_spread',  label: '心形扩散',     mainGain: 1.8, sendGain: 0.6, source: 'cardiod-35-10-spread.wav' },
  { name: 'tim_omni_35_10_magnetic', label: '磁性立体声', mainGain: 1.0, sendGain: 0.2, source: 'tim-omni-35-10-magnetic.wav' },
  { name: 'feedback_spring',       label: '反馈弹簧',     mainGain: 1.8, sendGain: 0.8, source: 'feedback-spring.wav' },
]

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
    audioEl.addEventListener('play', () => { player.isPlaying = true })
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

  function initAudioContext() {
    if (audioCtx) return
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()

    // Analyser
    analyserNode = audioCtx.createAnalyser()
    analyserNode.fftSize = 256
    spectrumDataArray = new Uint8Array(analyserNode.frequencyBinCount)

    // Dry path
    dryGainNode = audioCtx.createGain()
    dryGainNode.gain.value = 1.0
    dryGainNode.connect(audioCtx.destination)

    // Convolution reverb chain (wet-only — 压缩器仅处理混响湿声)
    convolverOutputGainNode = audioCtx.createGain()
    convolverOutputGainNode.gain.value = 0

    convolverDynamicsCompressor = audioCtx.createDynamicsCompressor()

    convolverNode = audioCtx.createConvolver()
    convolverNode.connect(convolverOutputGainNode)
    convolverOutputGainNode.connect(convolverDynamicsCompressor)
    convolverDynamicsCompressor.connect(audioCtx.destination)

    // Bass boost chain
    bassWetGainNode = audioCtx.createGain()
    bassWetGainNode.gain.value = player.bassBoostEnabled ? player.bassBoostWetGain : 0
    bassWetGainNode.connect(audioCtx.destination)

    bassFilterNode = audioCtx.createBiquadFilter()
    bassFilterNode.type = 'lowshelf'
    bassFilterNode.frequency.value = player.bassBoostFreq
    bassFilterNode.gain.value = player.bassBoostGain
    bassFilterNode.connect(bassWetGainNode)
  }

  // 确保 AudioContext 处于 running 状态（切歌前必须调用）
  async function ensureAudioContext() {
    initAudioContext()
    if (audioCtx && audioCtx.state === 'suspended') {
      await audioCtx.resume()
    }
  }

  function connectSource(el) {
    const targetEl = el || audioEl
    if (!targetEl) return
    if (!audioCtx) initAudioContext()
    try {
      sourceNode = audioCtx.createMediaElementSource(targetEl)
      sourceNode.connect(analyserNode)
      sourceNode.connect(dryGainNode)
      // Convolution wet path: 原始信号仅送混响器，不复制干声到压缩器
      if (convolverNode) {
        sourceNode.connect(convolverNode)
      }
      sourceNode.connect(bassFilterNode)
      targetEl._spectrumConnected = true
    } catch (e) {
      // already connected
    }
  }

  // Load a convolution IR WAV file
  async function loadConvolutionBuffer(fileName) {
    if (!audioCtx) initAudioContext()
    if (bufferCache.has(fileName)) {
      return bufferCache.get(fileName)
    }
    try {
      const response = await fetch(`./filters/${fileName}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      bufferCache.set(fileName, audioBuffer)
      return audioBuffer
    } catch (err) {
      console.error(`加载混响脉冲文件失败: ${fileName}`, err)
      return null
    }
  }

  function replaceConvolverNode(buffer) {
    if (!audioCtx || !convolverOutputGainNode) {
      initAudioContext()
    }
    const oldConvolver = convolverNode
    if (sourceNode && oldConvolver) {
      try {
        sourceNode.disconnect(oldConvolver)
      } catch (_) {}
    }
    if (oldConvolver) {
      try {
        oldConvolver.disconnect()
      } catch (_) {}
    }

    convolverNode = audioCtx.createConvolver()
    convolverNode.buffer = buffer || null
    convolverNode.connect(convolverOutputGainNode)

    if (sourceNode) {
      try {
        sourceNode.connect(convolverNode)
      } catch (_) {}
    }
  }

  // Set convolution with loaded buffer and gains
  function applyConvolution(buffer, mainGain, sendGain, fileName = null) {
    if (!convolverNode || !convolverOutputGainNode) {
      initAudioContext()
    }
    if (activeConvolutionFileName !== fileName) {
      replaceConvolverNode(buffer)
      activeConvolutionFileName = fileName
    }
    if (buffer) {
      // mainGain 控制干声增益，sendGain 控制混响湿声增益 — 正确的干湿比
      dryGainNode.gain.value = mainGain
      convolverOutputGainNode.gain.value = sendGain
    } else {
      // 禁用混响：干声恢复，湿声静音
      dryGainNode.gain.value = 1.0
      convolverOutputGainNode.gain.value = 0
    }
  }

  // Load and apply convolution from file name
  async function loadAndApplyConvolution(fileName, mainGain, sendGain) {
    const token = ++convolutionUpdateToken
    if (!fileName) {
      applyConvolution(null, 0, 0, null)
      return
    }
    const buffer = await loadConvolutionBuffer(fileName)
    if (token !== convolutionUpdateToken) {
      return
    }
    if (buffer) {
      applyConvolution(buffer, mainGain, sendGain, fileName)
    }
  }

  // Exposed for external use (called when settings change)
  async function setConvolution(fileName, mainGain, sendGain) {
    await loadAndApplyConvolution(fileName, mainGain, sendGain)
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

  function destroyAudioEngine() {
    if (audioCtx) {
      audioCtx.close().catch(() => {})
      audioCtx = null
    }
    analyserNode = null
    spectrumDataArray = null
    sourceNode = null
    dryGainNode = null
    convolverNode = null
    convolverOutputGainNode = null
    convolverDynamicsCompressor = null
    activeConvolutionFileName = null
    bassWetGainNode = null
    bassFilterNode = null
    if (audioEl) {
      audioEl.removeEventListener('timeupdate', onTimeUpdate)
      audioEl.removeEventListener('loadedmetadata', onLoadedMeta)
      audioEl.removeEventListener('ended', onEnded)
    }
    bufferCache.clear()
  }

  return {
    currentTime, duration, lrcCurrentLine,
    setAudioElement,
    initAudioContext, ensureAudioContext, connectSource,
    loadAndPlay, pause, resume, stop,
    seek, seekTime, adjustTime,
    setConvolution, updateBassFilter,
    destroyAudioEngine,
    resolveFilePath, loadConvolutionBuffer,
    // expose for visualizer
    getAnalyserNode: () => analyserNode,
    getSpectrumData: () => spectrumDataArray,
    getCircleImage: () => circleCenterImage,
    setCircleImage: (img) => { circleCenterImage = img },
  }
}
