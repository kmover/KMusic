// ============================================================
// KMusic - 本地音乐播放器 (Vite + Electron + SQLite)
// ============================================================

// 检查 Electron 环境
const isElectron = !!(window.electronAPI)

// ========== 播放器状态 ==========
const state = {
  currentGroupId: null,
  currentGroupName: '默认列表',
  currentSongIndex: -1,
  playlist: [],
  isPlaying: false,
  volume: 0.7,
  isMuted: false,
  shuffleMode: false,
  repeatMode: 'all', // none | one | all
  sortKey: null,      // null | 'title' | 'artist'
  sortOrder: 'asc',   // 'asc' | 'desc'
  searchQuery: '',    // 搜索关键词
  searchActiveIndex: -1, // 当前高亮的搜索结果索引
  spectrumVisible: true,
  spectrumAnimId: null,
  spectrumMode: 'bar', // bar | square | 3d
  themeBg: './background/img-green.jpg',
  mediaKeysEnabled: true,
  lrcLines: [],       // [{time: 12.5, text: '...'}]
  customThemes: [],   // [{ name: '自定义1', path: 'covers/custom/xxx.jpg' }]
  autoClosePlaylist: true,
  // 环境混响
  reverbEnabled: false,
  reverbWetGain: 0.35,      // 混响增益
  // 低音增强
  bassBoostEnabled: false,
  bassBoostFreq: 80,        // 分频点 (40~300Hz)
  bassBoostGain: 8,         // 低音增益 (0~24dB)
  bassBoostWetGain: 0.5,    // 低音增强增益
  // 自定义快捷键
  shortcuts: {
    play: 'Space',
    prev: '',
    next: '',
    volup: 'ArrowUp',
    voldown: 'ArrowDown'
  }
}

// 频谱可视化（三种模式: bar / square / 3d）
let audioCtx = null
let analyserNode = null
let spectrumDataArray = null
// 音效处理节点
let sourceNode = null
let dryGainNode = null       // 共享干声通路
let revWetGainNode = null    // 混响湿声增益
let bassWetGainNode = null   // 低音增强湿声增益
let convolverNode = null     // 卷积混响
let bassFilterNode = null    // 低音增强滤波器

// 圆形频谱中心封面旋转
let circleCenterImage = new Image()
let circleRotationAngle = 0

function initSpectrumContext() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()

  // 频谱分析器（仅用于可视化，不连 destination）
  analyserNode = audioCtx.createAnalyser()
  analyserNode.fftSize = 256
  spectrumDataArray = new Uint8Array(analyserNode.frequencyBinCount)

  // 共享干声通路（原始信号）→ destination
  dryGainNode = audioCtx.createGain()
  dryGainNode.gain.value = 1.0
  dryGainNode.connect(audioCtx.destination)

  // 混响通路：卷积 → 湿声增益 → destination
  revWetGainNode = audioCtx.createGain()
  revWetGainNode.gain.value = state.reverbEnabled ? state.reverbWetGain : 0
  revWetGainNode.connect(audioCtx.destination)

  convolverNode = audioCtx.createConvolver()
  convolverNode.connect(revWetGainNode)
  updateConvolverIR()

  // 低音增强通路：lowshelf 滤波 → 湿声增益 → destination
  bassWetGainNode = audioCtx.createGain()
  bassWetGainNode.gain.value = state.bassBoostEnabled ? state.bassBoostWetGain : 0
  bassWetGainNode.connect(audioCtx.destination)

  bassFilterNode = audioCtx.createBiquadFilter()
  bassFilterNode.type = 'lowshelf'
  bassFilterNode.frequency.value = state.bassBoostFreq
  bassFilterNode.gain.value = state.bassBoostGain
  bassFilterNode.connect(bassWetGainNode)
}

/**
 * 生成合成脉冲响应（Impulse Response）
 * 固定使用中厅混响参数
 */
function generateImpulseResponse(sampleRate, duration) {
  const length = Math.floor(sampleRate * duration)
  const buffer = audioCtx.createBuffer(2, length, sampleRate)
  const decayRate = 3.5 // 中厅

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const noise = (Math.random() * 2 - 1)
      data[i] = noise * Math.exp(-t * decayRate)
    }
  }
  return buffer
}

function updateConvolverIR() {
  if (!convolverNode || !audioCtx) return
  const sr = audioCtx.sampleRate
  const ir = generateImpulseResponse(sr, 1.8)
  convolverNode.buffer = ir
}

function connectSpectrumSource() {
  if (!audioCtx || !analyserNode) initSpectrumContext()
  try {
    // MediaElementSource 只能创建一次
    sourceNode = audioCtx.createMediaElementSource(dom.audio)
    // 源 → 分析器（仅可视化）
    sourceNode.connect(analyserNode)
    // 源 → 干声通路
    sourceNode.connect(dryGainNode)
    // 源 → 混响通路
    sourceNode.connect(convolverNode)
    // 源 → 低音增强通路
    sourceNode.connect(bassFilterNode)
    dom.audio._spectrumConnected = true
  } catch (e) {
    // 已连接过，无需重复
  }
}


// === 混响控制 ===
function toggleReverb(enabled) {
  state.reverbEnabled = enabled
  if (revWetGainNode) {
    revWetGainNode.gain.value = enabled ? state.reverbWetGain : 0
  }
  saveSettings()
}

function syncReverbUI() {
  if (dom.reverbToggle) dom.reverbToggle.checked = state.reverbEnabled
  if (dom.reverbWetGain) dom.reverbWetGain.value = Math.round(state.reverbWetGain * 100)
  if (dom.reverbWetVal) dom.reverbWetVal.textContent = Math.round(state.reverbWetGain * 100) + '%'
}

// === 低音增强控制 ===
function updateBassFilter() {
  if (!bassFilterNode) return
  bassFilterNode.frequency.value = state.bassBoostFreq
  bassFilterNode.gain.value = state.bassBoostGain
}

function toggleBassBoost(enabled) {
  state.bassBoostEnabled = enabled
  if (bassWetGainNode) {
    bassWetGainNode.gain.value = enabled ? state.bassBoostWetGain : 0
  }
  saveSettings()
}

function syncBassUI() {
  if (dom.bassToggle) dom.bassToggle.checked = state.bassBoostEnabled
  if (dom.bassFreq) dom.bassFreq.value = state.bassBoostFreq
  if (dom.bassBoostGain) dom.bassBoostGain.value = state.bassBoostGain
  if (dom.bassWetGain) dom.bassWetGain.value = Math.round(state.bassBoostWetGain * 100)
  if (dom.bassFreqVal) dom.bassFreqVal.textContent = state.bassBoostFreq + 'Hz'
  if (dom.bassBoostVal) dom.bassBoostVal.textContent = '+' + state.bassBoostGain + 'dB'
  if (dom.bassWetVal) dom.bassWetVal.textContent = Math.round(state.bassBoostWetGain * 100) + '%'
}

// === 快捷键 ===
const KEY_DISPLAY = {
  Space: 'Space',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫', Delete: 'Del',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  Numpad0: 'Num0', Numpad1: 'Num1', Numpad2: 'Num2', Numpad3: 'Num3', Numpad4: 'Num4',
  Numpad5: 'Num5', Numpad6: 'Num6', Numpad7: 'Num7', Numpad8: 'Num8', Numpad9: 'Num9',
  NumpadAdd: 'Num+', NumpadSubtract: 'Num−'
}

function keyToDisplay(code) {
  if (!code) return '—'
  if (KEY_DISPLAY[code]) return KEY_DISPLAY[code]
  // 字母键
  if (code.startsWith('Key')) return code.slice(3)
  // 数字键
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

let _recordingTarget = null  // 当前正在录制的 shortcut-input 元素

function startRecording(el) {
  if (_recordingTarget) _recordingTarget.classList.remove('recording')
  _recordingTarget = el
  el.classList.add('recording')
  el.textContent = '...'
}

function commitRecording(code) {
  if (!_recordingTarget) return
  const action = _recordingTarget.id  // e.g. 'sc-play'
  const key = action.replace('sc-', '')  // 'play'
  state.shortcuts[key] = code
  _recordingTarget.classList.remove('recording')
  _recordingTarget.textContent = keyToDisplay(code)
  _recordingTarget.dataset.key = code
  _recordingTarget = null
  saveSettings()
}

function cancelRecording() {
  if (!_recordingTarget) return
  const code = _recordingTarget.dataset.key
  _recordingTarget.classList.remove('recording')
  _recordingTarget.textContent = keyToDisplay(code)
  _recordingTarget = null
}

function syncShortcutUI() {
  const map = {
    scPlay: 'play', scPrev: 'prev', scNext: 'next',
    scVolup: 'volup', scVoldown: 'voldown'
  }
  for (const [domKey, stateKey] of Object.entries(map)) {
    const el = dom[domKey]
    if (!el) continue
    const code = state.shortcuts[stateKey]
    el.textContent = keyToDisplay(code)
    el.dataset.key = code
  }
}

// ---------- 颜色方案 ----------
function spectrumColor(index, total, value) {
  const intensity = value / 255
  const pos = index / total
  const hue = pos * 360
  const lightness = 30 + intensity * 40
  return `hsl(${hue}, 100%, ${lightness}%)`
}

// ---------- 模式1: 条形频谱 ----------
function drawBarVisualizer(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  if (!analyserNode) return
  analyserNode.getByteFrequencyData(spectrumDataArray)

  ctx.clearRect(0, 0, w, h)
  const barCount = spectrumDataArray.length
  const barWidth = Math.floor(w / barCount)

  let x = 0
  for (let i = 0; i < barCount; i++) {
    const val = spectrumDataArray[i]
    const barH = (val / 255) * h
    ctx.fillStyle = spectrumColor(i, barCount, val)
    ctx.fillRect(x, h - barH, barWidth - 1, barH)
    x += barWidth
  }
}

// ---------- 模式2: 方格频谱 ----------
function drawSquareVisualizer(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  if (!analyserNode) return
  analyserNode.getByteFrequencyData(spectrumDataArray)

  ctx.clearRect(0, 0, w, h)
  const barCount = spectrumDataArray.length
  const barWidth = Math.floor(w / barCount)
  const squareSize = Math.max(3, barWidth - 1)
  const squaresPerBar = Math.floor(h / squareSize)

  let x = 0
  for (let i = 0; i < barCount; i++) {
    const val = spectrumDataArray[i]
    const barH = (val / 255) * h + 2
    const filled = Math.floor((barH / h) * squaresPerBar)
    for (let j = 0; j < filled; j++) {
      const yPos = h - (j + 1) * squareSize
      ctx.fillStyle = spectrumColor(i, barCount, val)
      ctx.fillRect(x, yPos, squareSize - 1, squareSize - 1)
    }
    x += barWidth
    if (x >= w) break
  }
}

// ---------- 模式3: 3D立体条形频谱 ----------
function draw3DBarVisualizer(canvas) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  if (!analyserNode) return
  analyserNode.getByteFrequencyData(spectrumDataArray)

  ctx.clearRect(0, 0, w, h)
  const barCount = Math.floor(spectrumDataArray.length / 2)
  const barSpacing = 2
  const barWidth = (w - (barCount - 1) * barSpacing) / barCount
  const depth = 5

  for (let i = 0; i < barCount; i++) {
    const val = spectrumDataArray[i * 2]
    const barH = (val / 255) * h * 0.8
    const x = i * (barWidth + barSpacing)

    const mainC = spectrumColor(i, barCount, val)
    const topC = spectrumColor(i, barCount, val * 0.8)
    const sideC = spectrumColor(i, barCount, val * 0.6)

    // 主面
    ctx.fillStyle = mainC
    ctx.fillRect(x, h - barH, barWidth, barH)

    // 顶面
    ctx.fillStyle = topC
    ctx.beginPath()
    ctx.moveTo(x, h - barH)
    ctx.lineTo(x + depth, h - barH - depth)
    ctx.lineTo(x + barWidth + depth, h - barH - depth)
    ctx.lineTo(x + barWidth, h - barH)
    ctx.closePath()
    ctx.fill()

    // 侧面
    ctx.fillStyle = sideC
    ctx.beginPath()
    ctx.moveTo(x + barWidth, h - barH)
    ctx.lineTo(x + barWidth + depth, h - barH - depth)
    ctx.lineTo(x + barWidth + depth, h - depth)
    ctx.lineTo(x + barWidth, h)
    ctx.closePath()
    ctx.fill()
  }
}

// ---------- 模式4: 左上角圆形频谱 ----------
function drawCircleVisualizer() {
  const canvas = dom.circleCanvas
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  const dpr = window.devicePixelRatio || 1

  // 确保 canvas 实际像素匹配
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr
    canvas.height = ch * dpr
  }
  canvas.style.width = cw + 'px'
  canvas.style.height = ch + 'px'

  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const radius = Math.min(canvas.width, canvas.height) / 2 - 12

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 慢速旋转（无音频时使用默认转速）
  circleRotationAngle += 0.005

  // === 无音频时只显示封面与装饰环 ===
  if (!analyserNode) {
    const imgSize = radius * 0.4
    if (circleCenterImage.complete && circleCenterImage.naturalWidth) {
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(circleRotationAngle)
      ctx.beginPath()
      ctx.arc(0, 0, imgSize, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(circleCenterImage, -imgSize, -imgSize, imgSize * 2, imgSize * 2)
      ctx.restore()

      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(-circleRotationAngle * 2)
      ctx.strokeStyle = `hsla(${circleRotationAngle * 20 % 360}, 100%, 60%, 0.5)`
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, imgSize + 5, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, imgSize + 10, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    } else {
      ctx.beginPath()
      ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill()
      ctx.beginPath()
      ctx.arc(centerX, centerY, 14, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.lineWidth = 1; ctx.stroke()
    }
    return
  }

  // === 有音频时绘制完整频谱 ===
  analyserNode.getByteFrequencyData(spectrumDataArray)

  // 根据音频强度计算旋转速度
  let sum = 0
  for (let i = 0; i < spectrumDataArray.length; i++) sum += spectrumDataArray[i]
  const average = sum / spectrumDataArray.length
  const rotationSpeed = 0.005 + (average / 255) * 0.01
  circleRotationAngle += rotationSpeed

  // 中心旋转封面
  const imgSize = radius * 0.4
  if (circleCenterImage.complete && circleCenterImage.naturalWidth) {
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(circleRotationAngle)
    ctx.beginPath()
    ctx.arc(0, 0, imgSize, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(circleCenterImage, -imgSize, -imgSize, imgSize * 2, imgSize * 2)
    ctx.restore()

    // 反向旋转装饰环
    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(-circleRotationAngle * 2)
    ctx.strokeStyle = `hsla(${circleRotationAngle * 20 % 360}, 100%, 60%, 0.5)`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, imgSize + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, imgSize + 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  } else {
    // 无封面时显示中心光点
    ctx.beginPath()
    ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(centerX, centerY, 14, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 中部环绕条形
  const barCount = 48
  const innerRadius = imgSize + 15
  const barWidth = 3
  for (let i = 0; i < barCount; i++) {
    const angle = (i / barCount) * Math.PI * 2
    const dataIndex = Math.floor(i * spectrumDataArray.length / barCount)
    const val = spectrumDataArray[dataIndex]
    const barH = (val / 255) * (radius - innerRadius - 10)

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(angle)
    ctx.fillStyle = spectrumColor(i, barCount, val)
    ctx.fillRect(innerRadius, -barWidth / 2, barH, barWidth)
    ctx.restore()
  }

  // 外围辐射线
  const outerRadius = radius - 4
  const lineCount = 96
  for (let i = 0; i < lineCount; i++) {
    const angle = (i / lineCount) * Math.PI * 2
    const dataIndex = Math.floor(i * spectrumDataArray.length / lineCount)
    const val = spectrumDataArray[dataIndex]
    const lineLen = (val / 255) * 14 + 2

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(angle)
    ctx.strokeStyle = spectrumColor(i, lineCount, val)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(outerRadius, 0)
    ctx.lineTo(outerRadius + lineLen, 0)
    ctx.stroke()
    ctx.restore()
  }
}

// ---------- 模式分发 ----------
const spectrumDrawFns = {
  bar: drawBarVisualizer,
  square: drawSquareVisualizer,
  '3d': draw3DBarVisualizer
}

const spectrumModeLabels = {
  bar: '条形频谱',
  square: '方格频谱',
  '3d': '3D立体'
}

function drawSpectrum() {
  const canvas = dom.spectrumCanvas
  if (!analyserNode) return

  // 确保 canvas 分辨率与 CSS 尺寸一致（避免模糊）
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr
    canvas.height = ch * dpr
  }

  const fn = spectrumDrawFns[state.spectrumMode] || drawBarVisualizer
  fn(canvas)
}

function spectrumLoop() {
  if (!state.spectrumVisible) return
  drawSpectrum()
  drawCircleVisualizer()
  state.spectrumAnimId = requestAnimationFrame(spectrumLoop)
}

function startSpectrumAnimation() {
  if (state.spectrumAnimId) return
  state.spectrumAnimId = requestAnimationFrame(spectrumLoop)
}

function stopSpectrumAnimation() {
  if (state.spectrumAnimId) {
    cancelAnimationFrame(state.spectrumAnimId)
    state.spectrumAnimId = null
  }
}

// ---------- 切换频谱模式 ----------
function cycleSpectrumMode() {
  const modes = ['bar', 'square', '3d']
  const idx = modes.indexOf(state.spectrumMode)
  state.spectrumMode = modes[(idx + 1) % modes.length]
  // 更新提示
  const label = dom.spectrumLayer.querySelector('.spectrum-mode-label')
  if (label) {
    label.textContent = spectrumModeLabels[state.spectrumMode]
    label.classList.add('show')
    clearTimeout(label._timer)
    label._timer = setTimeout(() => label.classList.remove('show'), 1000)
  }
}

// ---------- 显示/隐藏 ----------
function toggleSpectrum() {
  state.spectrumVisible = !state.spectrumVisible
  const layer = dom.spectrumLayer

  if (state.spectrumVisible) {
    layer.style.display = 'block'
    // 调整 canvas 尺寸（画布固定在底部 300px）
    const dpr = window.devicePixelRatio || 1
    const cw = layer.clientWidth
    const ch = 300
    dom.spectrumCanvas.width = cw * dpr
    dom.spectrumCanvas.height = ch * dpr
    dom.spectrumCanvas.style.width = cw + 'px'
    dom.spectrumCanvas.style.height = ch + 'px'

    // 确保 AudioContext 已初始化并连接
    initSpectrumContext()
    if (!dom.audio._spectrumConnected) {
      connectSpectrumSource()
    }
    startSpectrumAnimation()
  } else {
    stopSpectrumAnimation()
    layer.style.display = 'none'
  }
}

// ---------- 显示/隐藏播放列表 ----------
function togglePlaylist() {
  const app = $('#app')
  if (app.style.display === 'none') {
    app.style.display = 'flex'
  } else {
    app.style.display = 'none'
  }
  saveSettings()
}

// ---------- 设置面板 & 主题切换 ----------
const themes = [
  { name: '绿意', path: './background/img-001.png' },
  { name: '山林', path: './background/img-002.png' },
  { name: '黄昏', path: './background/img-003.png' },
  { name: '极光', path: './background/img-004.png' },
  { name: '美好', path: './background/img-005.png' }
]

function bgPathToUrl(path) {
  // 自定义背景（存储在 covers/custom/ 下）通过 bg:// 协议访问
  if (path && path.startsWith('covers/custom/')) {
    const filename = path.replace('covers/custom/', '')
    return `bg://custom/${filename}`
  }
  return path
}

function renderThemeGrid() {
  const grid = dom.themeGrid
  if (!grid) return
  grid.innerHTML = ''
  const currentBg = state.themeBg || './background/img-green.jpg'

  // 内置主题
  themes.forEach(theme => {
    const div = document.createElement('div')
    div.className = 'theme-item'
    div.style.backgroundImage = `url(${bgPathToUrl(theme.path)})`
    div.title = theme.name
    if (theme.path === currentBg) div.classList.add('active')
    div.addEventListener('click', () => selectTheme(theme.path))
    grid.appendChild(div)
  })

  // 自定义主题
  state.customThemes.forEach((theme, idx) => {
    const div = document.createElement('div')
    div.className = 'theme-item theme-item-custom'
    div.style.backgroundImage = `url(${bgPathToUrl(theme.path)})`
    div.title = theme.name + '\n右键删除'
    if (theme.path === currentBg) div.classList.add('active')
    div.addEventListener('click', () => selectTheme(theme.path))
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (confirm(`确定要删除自定义背景「${theme.name}」吗？`)) {
        removeCustomTheme(idx)
      }
    })
    grid.appendChild(div)
  })

  // "+" 添加按钮
  const add = document.createElement('div')
  add.className = 'theme-item theme-item-add'
  add.title = '选择本地图片作为背景'
  add.innerHTML = '<i class="fa-solid fa-plus"></i>'
  add.addEventListener('click', addCustomTheme)
  grid.appendChild(add)
}

async function addCustomTheme() {
  if (!isElectron || !window.electronAPI.theme) {
    // 浏览器模式：用 file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const dataUrl = URL.createObjectURL(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      state.customThemes.push({ name, path: dataUrl })
      selectTheme(dataUrl)
    }
    input.click()
    return
  }
  const savedPath = await window.electronAPI.theme.pickCustom()
  if (!savedPath) return
  const name = '自定义' + (state.customThemes.length + 1)
  state.customThemes.push({ name, path: savedPath })
  selectTheme(savedPath)
}

function removeCustomTheme(index) {
  if (index < 0 || index >= state.customThemes.length) return
  const removed = state.customThemes[index]
  // 如果当前选中被删的主题，切回默认
  if (state.themeBg === removed.path) {
    state.themeBg = './background/img-green.jpg'
    dom.spectrumLayer.style.backgroundImage = `url(${state.themeBg})`
  }
  state.customThemes.splice(index, 1)
  renderThemeGrid()
  saveSettings()
}

function selectTheme(bgPath) {
  state.themeBg = bgPath
  dom.spectrumLayer.style.backgroundImage = `url(${bgPathToUrl(bgPath)})`
  renderThemeGrid()
  // 保存到本地
  saveSettings()
}

function renderSpectrumOptions() {
  const container = dom.spectrumOptions
  if (!container) return
  container.innerHTML = ''
  const modes = ['bar', 'square', '3d']
  modes.forEach(mode => {
    const btn = document.createElement('button')
    btn.className = 'spectrum-opt' + (state.spectrumMode === mode ? ' active' : '')
    btn.textContent = spectrumModeLabels[mode]
    btn.addEventListener('click', () => selectSpectrumMode(mode))
    container.appendChild(btn)
  })
}

function selectSpectrumMode(mode) {
  if (state.spectrumMode === mode) return
  state.spectrumMode = mode
  renderSpectrumOptions()
  saveSettings()
}

function toggleSettings() {
  const panel = dom.settingsPanel
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'flex'
    renderSpectrumOptions()
    renderThemeGrid()
    // 同步音效控件状态
    syncReverbUI()
    syncBassUI()
    syncShortcutUI()
  } else {
    panel.style.display = 'none'
  }
}

function hideSettings() {
  dom.settingsPanel.style.display = 'none'
}

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const dom = {
  // 侧边栏
  groupList: $('#group-list'),
  btnAddGroup: $('#btn-add-group'),
  currentGroupName: $('#current-group-name'),
  // 歌曲
  songTbody: $('#song-tbody'),
  emptyHint: $('#empty-hint'),
  songTable: $('#song-table'),
  sortTitle: $('#sort-title'),
  sortArtist: $('#sort-artist'),
  // 频谱
  spectrumLayer: $('#spectrum-layer'),
  spectrumCanvas: $('#spectrum-canvas'),
  circleCanvas: $('#circle-canvas'),
  lrcList: $('#lrc-list'),
  // 播放器
  audio: $('#audio-player'),
  btnPlay: $('#btn-play'),
  btnPrev: $('#btn-prev'),
  btnNext: $('#btn-next'),
  btnMode: $('#btn-mode'),
  btnPlaylist: $('#btn-playlist'),
  btnSettings: $('#btn-settings'),
  settingsPanel: $('#settings-panel'),
  spectrumOptions: $('#spectrum-options'),
  themeGrid: $('#theme-grid'),
  playerTitle: $('#player-title'),
  playerArtist: $('#player-artist'),
  playerLrc: $('#player-lrc'),
  playerCover: $('#player-cover'),
  circleTitle: $('#circle-title'),
  circleArtist: $('#circle-artist'),
  timeCurrent: $('#time-current'),
  timeTotal: $('#time-total'),
  progressFill: $('#progress-fill'),
  progressThumb: $('#progress-thumb'),
  progressBar: $('#progress-bar'),
  // 音量
  volumeFill: $('#volume-fill'),
  volumeThumb: $('#volume-thumb'),
  volumeBar: $('#volume-bar'),
  btnVolume: $('#btn-volume'),
  // 弹窗
  modalAddGroup: $('#modal-add-group'),
  inputGroupName: $('#input-group-name'),
  btnGroupCancel: $('#btn-group-cancel'),
  btnGroupConfirm: $('#btn-group-confirm'),
  modalConfirm: $('#modal-confirm'),
  confirmMessage: $('#confirm-message'),
  btnConfirmCancel: $('#btn-confirm-cancel'),
  btnConfirmOk: $('#btn-confirm-ok'),
  btnClearDB: $('#btn-clear-db'),
  btnRefreshSongs: $('#btn-refresh-songs'),
  btnRemoveMissing: $('#btn-remove-missing'),
  btnScanDirectory: $('#btn-scan-directory'),
  // 搜索
  searchInput: $('#search-input'),
  btnSearch: $('#btn-search'),
  // 标题栏
  btnMinimize: $('#btn-minimize'),
  btnClose: $('#btn-close'),
  // 环境混响
  reverbToggle: $('#reverb-toggle'),
  reverbWetGain: $('#reverb-wet-gain'),
  reverbWetVal: $('#reverb-wet-val'),
  // 低音增强
  bassToggle: $('#bass-toggle'),
  bassFreq: $('#bass-freq'),
  bassBoostGain: $('#bass-boost-gain'),
  bassWetGain: $('#bass-wet-gain'),
  bassFreqVal: $('#bass-freq-val'),
  bassBoostVal: $('#bass-boost-val'),
  bassWetVal: $('#bass-wet-val'),
  // 快捷键
  scPlay: $('#sc-play'),
  scPrev: $('#sc-prev'),
  scNext: $('#sc-next'),
  scVolup: $('#sc-volup'),
  scVoldown: $('#sc-voldown')
}

// ========== 工具函数 ==========
function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function resolveFilePath(filePath) {
  if (!filePath) return ''
  if (isElectron) {
    // Electron 自定义协议: 将完整绝对路径编码到路径中
    // D:/Music/song.mp3 → music://local/D%3A%2FMusic%2Fsong.mp3
    const normalized = filePath.replace(/\\/g, '/')
    return 'music://local/' + encodeURIComponent(normalized)
  }
  return filePath
}

// ========== 弹窗管理 ==========
let confirmCallback = null

function showModal(modal) {
  modal.classList.add('show')
}

function hideModal(modal) {
  modal.classList.remove('show')
}

function showConfirm(message, callback) {
  dom.confirmMessage.textContent = message
  confirmCallback = callback
  showModal(dom.modalConfirm)
}

// ========== API 调用（Electron 或 fallback）==========
const api = {
  async getCategories() {
    return (await invoke('db:getCategories')) || []
  },
  async addCategory(name) {
    return await invoke('db:addCategory', name)
  },
  async renameCategory(id, newName) {
    return await invoke('db:renameCategory', id, newName)
  },
  async deleteCategory(id) {
    return await invoke('db:deleteCategory', id)
  },
  async getSongsByCategory(categoryId) {
    return (await invoke('db:getSongsByCategory', categoryId)) || []
  },
  async importSongs(categoryId) {
    return await invoke('db:importSongs', categoryId)
  },
  async deleteSong(id) {
    return await invoke('db:deleteSong', id)
  },
  async getCoverBase64(coverPath) {
    return await invoke('db:getCoverBase64', coverPath)
  },
  async clearAllSongs() {
    return await invoke('db:clearAllSongs')
  },
  async refreshAllSongs() {
    return await invoke('db:refreshAllSongs')
  },
  async removeMissingSongs() {
    return await invoke('db:removeMissingSongs')
  },
  async scanDirectory() {
    return await invoke('db:scanDirectory')
  }
}

async function invoke(channel, ...args) {
  if (isElectron && window.electronAPI.db) {
    const method = channel.replace('db:', '')
    if (typeof window.electronAPI.db[method] === 'function') {
      return await window.electronAPI.db[method](...args)
    }
  }
  // 浏览器 fallback: 使用 localStorage
  return browserFallback(channel, ...args)
}

// 浏览器环境 fallback（开发调试用）
function browserFallback(channel, ...args) {
  const KEY = 'kmusic_data'
  let data = JSON.parse(localStorage.getItem(KEY) || '{"categories":[],"songs":[]}')

  switch (channel) {
    case 'db:getCategories':
      return data.categories
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
    case 'db:getSongsByCategory':
      return data.songs.filter(s => s.category_id === args[0])
    case 'db:importSongs':
      return { success: false, count: 0, message: '浏览器模式不支持导入文件' }
    case 'db:deleteSong': {
      data.songs = data.songs.filter(s => s.id !== args[0])
      localStorage.setItem(KEY, JSON.stringify(data))
      return { changes: 1 }
    }
    case 'db:getSongCount':
      return data.songs.length
    case 'db:getCoverBase64':
      return null  // 浏览器模式不支持本地封面
    case 'db:clearAllSongs': {
      data.songs = []
      localStorage.setItem(KEY, JSON.stringify(data))
      return { deleted: 0 }
    }
    case 'db:refreshAllSongs':
      return { success: true, updated: 0, total: 0 }  // 浏览器模式不支持
    case 'db:removeMissingSongs':
      return { removed: 0 }  // 浏览器模式不支持
    case 'db:scanDirectory':
      return { success: false, message: '浏览器模式不支持此功能' }
    default:
      return null
  }
}

// ========== 分组管理 ==========
async function loadGroups() {
  const categories = await api.getCategories()
  dom.groupList.innerHTML = ''

  categories.forEach(cat => {
    const li = document.createElement('li')
    li.className = 'group-item' + (cat.id === state.currentGroupId ? ' active' : '')
    li.innerHTML = `
      <span class="group-item-name">${escapeHtml(cat.name)}</span>
      <button class="group-item-import" title="导入歌曲"><i class="fa-solid fa-file-import"></i></button>
      <button class="group-item-rename" title="重命名"><i class="fa-solid fa-pen-to-square"></i></button>
      <button class="group-item-del" title="删除分组"><i class="fa-solid fa-trash-can"></i></button>
    `
    const nameSpan = li.querySelector('.group-item-name')

    // 点击分组名 → 选中
    li.addEventListener('click', (e) => {
      if (e.target.closest('.group-item-del') || e.target.closest('.group-item-rename') || e.target.closest('.group-item-import') || e.target.closest('.group-item-rename-input')) return
      selectGroup(cat.id, cat.name)
    })

    // 双击分组名 → 开始重命名
    nameSpan.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      startRenameGroup(cat.id, nameSpan)
    })

    // 导入按钮
    li.querySelector('.group-item-import').addEventListener('click', (e) => {
      e.stopPropagation()
      selectGroup(cat.id, cat.name)
      importSongs(cat.id)
    })

    // 重命名按钮
    li.querySelector('.group-item-rename').addEventListener('click', (e) => {
      e.stopPropagation()
      startRenameGroup(cat.id, nameSpan)
    })

    // 删除按钮
    li.querySelector('.group-item-del').addEventListener('click', (e) => {
      e.stopPropagation()
      deleteGroupConfirm(cat.id, cat.name)
    })

    dom.groupList.appendChild(li)
  })

  // 如果之前选中的分组被删除，选第一个
  if (state.currentGroupId && !categories.find(c => c.id === state.currentGroupId)) {
    if (categories.length > 0) {
      selectGroup(categories[0].id, categories[0].name)
    } else {
      state.currentGroupId = null
      state.currentGroupName = ''
      dom.currentGroupName.textContent = ''
      renderSongList([])
    }
  }
}

function startRenameGroup(catId, nameSpan) {
  const oldName = nameSpan.textContent
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'group-item-rename-input'
  input.value = oldName
  input.maxLength = 30
  nameSpan.replaceWith(input)
  input.focus()
  input.select()

  const finish = async (newName) => {
    newName = newName.trim()
    if (newName && newName !== oldName) {
      try {
        await api.renameCategory(catId, newName)
        // 更新当前选中分组名
        if (catId === state.currentGroupId) {
          state.currentGroupName = newName
          dom.currentGroupName.textContent = newName
        }
      } catch (err) {
        alert(err.message || '重命名失败')
      }
    }
    await loadGroups()
  }

  const cancel = () => {
    input.replaceWith(nameSpan)
    nameSpan.textContent = oldName
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      input.blur()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })

  input.addEventListener('blur', () => {
    finish(input.value)
  })
}

function selectGroup(id, name) {
  state.currentGroupId = id
  state.currentGroupName = name
  dom.currentGroupName.textContent = name

  // 更新侧边栏 active
  $$('.group-item').forEach(el => el.classList.remove('active'))
  const items = $$('.group-item')
  for (const item of items) {
    if (item.querySelector('.group-item-name').textContent === name) {
      item.classList.add('active')
      break
    }
  }

  loadSongs(id)
}

async function addGroup() {
  const name = dom.inputGroupName.value.trim()
  if (!name) return

  try {
    await api.addCategory(name)
    hideModal(dom.modalAddGroup)
    dom.inputGroupName.value = ''
    await loadGroups()
    // 选中新分组
    const categories = await api.getCategories()
    const newCat = categories.find(c => c.name === name)
    if (newCat) selectGroup(newCat.id, newCat.name)
  } catch (err) {
    alert(err.message || '添加失败')
  }
}

function deleteGroupConfirm(id, name) {
  showConfirm(`确定要删除分组「${name}」吗？\n分组内的所有歌曲也将被删除。`, async () => {
    await api.deleteCategory(id)
    await loadGroups()
  })
}

// ========== 歌曲管理 ==========
function sortSongs(songs) {
  if (!state.sortKey) return songs
  return [...songs].sort((a, b) => {
    const va = (a[state.sortKey] || '').toLowerCase()
    const vb = (b[state.sortKey] || '').toLowerCase()
    const cmp = va.localeCompare(vb, 'zh-Hans-CN')
    return state.sortOrder === 'asc' ? cmp : -cmp
  })
}

async function loadSongs(categoryId) {
  const songs = await api.getSongsByCategory(categoryId)
  state.playlist = sortSongs(songs)
  renderSongList(state.playlist, state.searchQuery)
  updateSortIndicators()
}

// 判断歌曲是否匹配搜索关键词
function matchesSong(song, query) {
  if (!query) return false
  const q = query.toLowerCase()
  return song.title.toLowerCase().includes(q) ||
    song.artist.toLowerCase().includes(q)
}

function doSearch() {
  const query = dom.searchInput.value.trim()
  state.searchQuery = query
  state.searchActiveIndex = 0
  renderSongList(state.playlist, query)
}

function saveSettings() {
  const currentSong = state.playlist[state.currentSongIndex]
  const settings = {
    sortKey: state.sortKey,
    sortOrder: state.sortOrder,
    themeBg: state.themeBg,
    spectrumMode: state.spectrumMode,
    volume: state.volume,
    isMuted: state.isMuted,
    repeatMode: state.repeatMode,
    shuffleMode: state.shuffleMode,
    mediaKeysEnabled: state.mediaKeysEnabled,
    customThemes: state.customThemes,
    autoClosePlaylist: state.autoClosePlaylist,
    reverbEnabled: state.reverbEnabled,
    reverbWetGain: state.reverbWetGain,
    bassBoostEnabled: state.bassBoostEnabled,
    bassBoostFreq: state.bassBoostFreq,
    bassBoostGain: state.bassBoostGain,
    bassBoostWetGain: state.bassBoostWetGain,
    shortcuts: state.shortcuts,
    lastGroupId: state.currentGroupId,
    lastSongId: currentSong ? currentSong.id : null,
    playlistVisible: $('#app').style.display !== 'none'
  }
  if (isElectron && window.electronAPI.settings) {
    window.electronAPI.settings.set(settings)
  } else {
    localStorage.setItem('kmusic_settings', JSON.stringify(settings))
  }
}

async function loadSettings() {
  let settings = {}
  if (isElectron && window.electronAPI.settings) {
    settings = (await window.electronAPI.settings.get()) || {}
  } else {
    try {
      settings = JSON.parse(localStorage.getItem('kmusic_settings') || '{}')
    } catch (e) { }
  }
  state.sortKey = settings.sortKey || null
  state.sortOrder = settings.sortOrder || 'asc'
  state.themeBg = settings.themeBg || './background/img-green.jpg'
  state.spectrumMode = settings.spectrumMode || 'bar'
  state.volume = (settings.volume !== undefined) ? settings.volume : 0.7
  state.isMuted = !!settings.isMuted
  state.repeatMode = settings.repeatMode || 'all'
  state.shuffleMode = !!settings.shuffleMode
  state.mediaKeysEnabled = settings.mediaKeysEnabled !== false  // 默认开启
  state.autoClosePlaylist = settings.autoClosePlaylist !== false  // 默认开启
  state.reverbEnabled = !!settings.reverbEnabled
  state.reverbWetGain = (settings.reverbWetGain !== undefined) ? settings.reverbWetGain : 0.35
  state.bassBoostEnabled = !!settings.bassBoostEnabled
  state.bassBoostFreq = settings.bassBoostFreq || 80
  state.bassBoostGain = (settings.bassBoostGain !== undefined) ? settings.bassBoostGain : 8
  state.bassBoostWetGain = (settings.bassBoostWetGain !== undefined) ? settings.bassBoostWetGain : 0.5
  state.shortcuts = (settings.shortcuts && typeof settings.shortcuts === 'object')
    ? Object.assign({
        play: 'Space', prev: '', next: '',
        volup: 'ArrowUp', voldown: 'ArrowDown'
      }, settings.shortcuts)
    : { play: 'Space', prev: '', next: '', volup: 'ArrowUp', voldown: 'ArrowDown' }
  state.customThemes = Array.isArray(settings.customThemes) ? settings.customThemes : []
  state._restoreGroupId = settings.lastGroupId || null
  state._restoreSongId = settings.lastSongId || null
  state._restorePlaylistVisible = settings.playlistVisible
}

function toggleSort(key) {
  if (state.sortKey === key) {
    state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc'
  } else {
    state.sortKey = key
    state.sortOrder = 'asc'
  }
  saveSettings()
  loadSongs(state.currentGroupId)
}

function updateSortIndicators() {
  const thTitle = dom.sortTitle
  const thArtist = dom.sortArtist
  // 清除所有排序图标
  thTitle.classList.remove('sort-asc', 'sort-desc')
  thArtist.classList.remove('sort-asc', 'sort-desc')
  // 设置当前排序图标
  const target = state.sortKey === 'artist' ? thArtist : (state.sortKey === 'title' ? thTitle : null)
  if (target) {
    target.classList.add(state.sortOrder === 'asc' ? 'sort-asc' : 'sort-desc')
  }
}

function renderSongList(songs, highlightQuery) {
  dom.songTbody.innerHTML = ''

  if (songs.length === 0) {
    dom.emptyHint.style.display = 'block'
    dom.songTable.style.display = 'none'
    return
  }

  dom.emptyHint.style.display = 'none'
  dom.songTable.style.display = 'table'

  let firstMatch = null
  let matchIndex = 0

  songs.forEach((song, index) => {
    const tr = document.createElement('tr')
    if (index === state.currentSongIndex &&
        state.currentGroupId === song.category_id) {
      tr.classList.add('playing')
    }

    // 搜索高亮
    if (matchesSong(song, highlightQuery)) {
      tr.classList.add('search-highlight')
      if (matchIndex === state.searchActiveIndex) {
        tr.classList.add('search-active')
        firstMatch = firstMatch || tr
      }
      matchIndex++
    }

    tr.innerHTML = `
      <td class="col-index">${index + 1}</td>
      <td class="col-title">${escapeHtml(song.title)}</td>
      <td class="col-artist">${escapeHtml(song.artist)}</td>
      <td class="col-duration">${formatTime(song.duration)}</td>
      <td class="col-action">
        <button class="btn-song-del" title="删除"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-song-del')) return
      playSong(index)
    })

    tr.querySelector('.btn-song-del').addEventListener('click', (e) => {
      e.stopPropagation()
      deleteSongConfirm(song.id)
    })

    dom.songTbody.appendChild(tr)
  })

  // 定位到当前活跃的匹配项
  if (firstMatch) {
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

async function importSongs(categoryId) {
  const targetId = categoryId || state.currentGroupId
  if (!targetId) {
    alert('请先选择或创建一个分组')
    return
  }

  if (isElectron) {
    const result = await api.importSongs(targetId)
    if (result.success) {
      const skipped = result.total - result.count
      let msg = `成功导入 ${result.count} 首歌曲。`
      if (skipped > 0) {
        msg += `\n跳过 ${skipped} 首重复歌曲。`
      }
      alert(msg)
      await loadSongs(targetId)
    }
  } else {
    alert('浏览器模式不支持导入文件，请使用 Electron 运行')
  }
}

function deleteSongConfirm(songId) {
  showConfirm('确定要从播放列表中删除这首歌曲吗？', async () => {
    await api.deleteSong(songId)
    // 如果正在播放这首歌，停止播放
    if (state.playlist[state.currentSongIndex]?.id === songId) {
      stopPlayback()
    }
    await loadSongs(state.currentGroupId)
  })
}

// ========== 播放控制 ==========
async function loadPlayerCover(song) {
  if (!song.cover) {
    // 无封面，显示默认图标
    dom.playerCover.innerHTML = state.isPlaying
      ? '<i class="fa-solid fa-compact-disc fa-spin"></i>'
      : '<i class="fa-solid fa-compact-disc"></i>'
    dom.playerCover.style.backgroundImage = ''
    dom.playerCover.classList.remove('has-cover')
    circleCenterImage = new Image()
    return
  }

  try {
    const base64 = await api.getCoverBase64(song.cover)
    if (base64) {
      dom.playerCover.innerHTML = ''
      dom.playerCover.style.backgroundImage = `url(${base64})`
      dom.playerCover.classList.add('has-cover')
      // 同时加载到圆形频谱的中心旋转封面
      circleCenterImage = new Image()
      circleCenterImage.src = base64
    } else {
      // 封面文件不存在，显示默认图标
      dom.playerCover.innerHTML = '<i class="fa-solid fa-compact-disc fa-spin"></i>'
      dom.playerCover.style.backgroundImage = ''
      dom.playerCover.classList.remove('has-cover')
      circleCenterImage = new Image()
    }
  } catch (e) {
    console.error('加载封面失败:', e)
    dom.playerCover.innerHTML = '<i class="fa-solid fa-compact-disc fa-spin"></i>'
    dom.playerCover.style.backgroundImage = ''
    dom.playerCover.classList.remove('has-cover')
    circleCenterImage = new Image()
  }
}

async function playSong(index) {
  if (index < 0 || index >= state.playlist.length) return

  state.currentSongIndex = index
  const song = state.playlist[index]
  const audio = dom.audio

  // 更新播放器信息
  dom.playerTitle.textContent = song.title
  dom.playerArtist.textContent = song.artist
  dom.circleTitle.textContent = song.title
  dom.circleArtist.textContent = song.artist

  // 加载封面
  loadPlayerCover(song)

  // 解析 LRC 歌词
  const rawLyrics = song.lyrics || ''
  console.log('[LRC] 原始歌词长度:', rawLyrics.length, '前100字:', rawLyrics.slice(0, 100))
  state.lrcLines = parseLrc(rawLyrics)
  console.log('[LRC] 解析结果行数:', state.lrcLines.length)
  // 渲染遮罩层歌词面板
  renderLrcPanel()
  // 如果没有 LRC 时间轴，尝试显示纯文本首行
  if (state.lrcLines.length === 0 && rawLyrics) {
    dom.playerLrc.textContent = parseRawLyricsFirstLine(rawLyrics)
    console.log('[LRC] 非 LRC 格式，显示首行:', dom.playerLrc.textContent)
  } else {
    dom.playerLrc.textContent = ''
  }

  // 设置音频源
  const fileUrl = resolveFilePath(song.file_path)
  audio.src = fileUrl
  audio.volume = state.isMuted ? 0 : state.volume

  // 连接频谱分析
  connectSpectrumSource()

  try {
    await audio.play()
    state.isPlaying = true
    state._errorSkipCount = 0  // 播放成功，重置错误跳过计数
    updatePlayButton()
    // 如启用自动关闭且播放列表层可见，切回频谱层
    if (state.autoClosePlaylist && $('#app').style.display !== 'none') {
      togglePlaylist()
    }
  } catch (err) {
    console.error('播放失败:', err)
    state.isPlaying = false
    updatePlayButton()
  }

  // 更新列表高亮
  renderSongList(state.playlist)

  // 滚动定位到当前播放项
  const playingRow = dom.songTbody.querySelector('tr.playing')
  if (playingRow) {
    playingRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // 保存播放状态
  saveSettings()
}

function togglePlay() {
  const audio = dom.audio
  if (!audio.src || audio.src === window.location.href) return

  if (state.isPlaying) {
    audio.pause()
  } else {
    audio.play().catch(err => console.error('播放失败:', err))
  }
  state.isPlaying = !state.isPlaying
  updatePlayButton()
}

function stopPlayback() {
  const audio = dom.audio
  audio.pause()
  audio.src = ''
  state.isPlaying = false
  state.currentSongIndex = -1
  dom.playerTitle.textContent = '未在播放'
  dom.playerArtist.textContent = '--'
  dom.circleTitle.textContent = '歌曲名称'
  dom.circleArtist.textContent = '歌手'
  dom.playerCover.innerHTML = '<i class="fa-solid fa-compact-disc"></i>'
  dom.playerCover.style.backgroundImage = ''
  dom.playerCover.classList.remove('has-cover')
  dom.playerLrc.textContent = ''
  state.lrcLines = []
  state._lastLrcLine = -1
  renderLrcPanel()
  dom.timeCurrent.textContent = '00:00'
  dom.timeTotal.textContent = '00:00'
  dom.progressFill.style.width = '0%'
  updatePlayButton()
  saveSettings()
}

function playNext() {
  if (state.playlist.length === 0) return
  let nextIndex

  if (state.shuffleMode) {
    // 随机模式：随机选取下一首
    const others = state.playlist
      .map((_, i) => i)
      .filter(i => i !== state.currentSongIndex)
    if (others.length === 0) {
      if (state.repeatMode === 'one') {
        playSong(state.currentSongIndex)
        return
      }
      stopPlayback()
      return
    }
    nextIndex = others[Math.floor(Math.random() * others.length)]
  } else {
    nextIndex = state.currentSongIndex + 1
    if (nextIndex >= state.playlist.length) {
      nextIndex = state.repeatMode === 'all' ? 0 : state.currentSongIndex
      if (nextIndex === state.currentSongIndex && state.repeatMode !== 'all') {
        stopPlayback()
        return
      }
    }
  }

  playSong(nextIndex)
}

// 切换播放模式：循环 → 随机 → 单曲重复
function togglePlayMode() {
  const modes = [
    { repeatMode: 'all',  shuffleMode: false, icon: 'fa-repeat',              title: '循环模式' },
    { repeatMode: 'none', shuffleMode: true,  icon: 'fa-shuffle',             title: '随机模式' },
    { repeatMode: 'one',  shuffleMode: false, icon: 'fa-arrows-to-circle',    title: '单曲重复' },
  ]
  // 找到当前模式
  let idx = modes.findIndex(m => m.repeatMode === state.repeatMode && m.shuffleMode === state.shuffleMode)
  if (idx === -1) idx = 0
  const next = modes[(idx + 1) % modes.length]

  state.repeatMode = next.repeatMode
  state.shuffleMode = next.shuffleMode

  const btn = dom.btnMode
  btn.title = next.title
  btn.querySelector('i').className = `fa-solid ${next.icon}`
  btn.classList.toggle('active', state.shuffleMode || state.repeatMode === 'one')
  saveSettings()
}

function playPrev() {
  if (state.playlist.length === 0) return

  let prevIndex
  if (state.shuffleMode) {
    // 随机模式：随机选一首（不同于当前）
    const others = state.playlist
      .map((_, i) => i)
      .filter(i => i !== state.currentSongIndex)
    if (others.length > 0) {
      prevIndex = others[Math.floor(Math.random() * others.length)]
    }
  }
  if (prevIndex === undefined) {
    prevIndex = state.currentSongIndex - 1
    if (prevIndex < 0) prevIndex = state.playlist.length - 1
  }
  playSong(prevIndex)
}

function updatePlayButton() {
  const icon = dom.btnPlay.querySelector('i')
  if (icon) {
    icon.className = state.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'
  }
}

// ========== 进度条 ==========
function updateProgress() {
  const audio = dom.audio
  if (!audio.duration || !isFinite(audio.duration)) return

  const percent = (audio.currentTime / audio.duration) * 100
  dom.progressFill.style.width = percent + '%'
  dom.timeCurrent.textContent = formatTime(audio.currentTime)
  dom.timeTotal.textContent = formatTime(audio.duration)

  // 同步 LRC 歌词
  updateLrcLine(audio.currentTime)
}

// LRC 歌词解析
function parseLrc(lrcText) {
  if (!lrcText) return []
  const lines = lrcText.replace(/\r/g, '').split('\n')
  const result = []
  for (const line of lines) {
    // 每行用全新正则，避免 /g 的 lastIndex 脏状态
    const timeReg = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g
    const matches = [...line.matchAll(timeReg)]
    if (matches.length === 0) continue

    // 去掉所有时间标签，取纯文本
    let text = line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g, '').trim()
    if (!text) continue

    // 取最后一个时间标签作为该行时间
    const lastMatch = matches[matches.length - 1]
    const min = parseInt(lastMatch[1])
    const sec = parseInt(lastMatch[2])
    const ms = lastMatch[3] ? parseInt(lastMatch[3].padEnd(3, '0')) : 0
    const time = min * 60 + sec + ms / 1000

    result.push({ time, text })
  }
  // 按时间排序
  result.sort((a, b) => a.time - b.time)
  return result
}

// 从纯文本歌词中取首行作简单显示（非 LRC 格式回退）
function parseRawLyricsFirstLine(lrcText) {
  if (!lrcText) return ''
  const lines = lrcText.replace(/\r/g, '').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (t && !/^\[(ti|ar|al|by|offset|length):/i.test(t)) return t
  }
  return ''
}

function updateLrcLine(currentTime) {
  const lines = state.lrcLines
  if (!lines.length) return

  // 找到当前时间对应的歌词行
  let currentLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (currentTime >= lines[i].time) {
      currentLine = i
    } else {
      break
    }
  }

  // 更新底部播放器的单行歌词
  if (currentLine >= 0) {
    dom.playerLrc.textContent = lines[currentLine].text
    // 行变更时打日志
    if (currentLine !== state._lastLrcLine) {
      console.log(`[LRC] time=${currentTime.toFixed(1)}s, line#${currentLine}: "${lines[currentLine].text}"`)
      state._lastLrcLine = currentLine
    }
  } else {
    dom.playerLrc.textContent = ''
    state._lastLrcLine = -1
  }

  // 更新遮罩层歌词面板高亮
  updateLrcPanelHighlight(currentLine)
}

// 渲染歌词列表到遮罩层面板
function renderLrcPanel() {
  const container = dom.lrcList
  if (!container) return
  container.innerHTML = ''
  const lines = state.lrcLines
  if (!lines.length) {
    container.innerHTML = '<div class="lrc-line" style="color:rgba(255,255,255,0.25)">暂无歌词</div>'
    return
  }
  lines.forEach((line, index) => {
    const div = document.createElement('div')
    div.className = 'lrc-line'
    div.textContent = line.text
    div.dataset.index = index
    container.appendChild(div)
  })
}

// 更新歌词面板高亮
function updateLrcPanelHighlight(activeIndex) {
  const container = dom.lrcList
  if (!container) return
  const lineEls = container.querySelectorAll('.lrc-line')
  if (!lineEls.length) return

  lineEls.forEach((el) => {
    const idx = parseInt(el.dataset.index)
    el.classList.remove('active', 'past')
    if (idx === activeIndex) {
      el.classList.add('active')
      // 自动滚动到当前行居中
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (idx < activeIndex) {
      el.classList.add('past')
    }
  })
}

function seekProgress(e) {
  const audio = dom.audio
  if (!audio.duration || !isFinite(audio.duration)) return

  const rect = dom.progressBar.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  audio.currentTime = percent * audio.duration
}

// ========== 音量控制 ==========
function updateVolumeUI() {
  const volume = state.isMuted ? 0 : state.volume
  dom.volumeFill.style.width = (volume * 100) + '%'
  dom.audio.volume = volume

  const icon = dom.btnVolume.querySelector('i')
  if (!icon) return

  if (state.isMuted || state.volume === 0) {
    icon.className = 'fa-solid fa-volume-xmark'
  } else if (state.volume < 0.5) {
    icon.className = 'fa-solid fa-volume-low'
  } else {
    icon.className = 'fa-solid fa-volume-high'
  }
}

function toggleMute() {
  state.isMuted = !state.isMuted
  updateVolumeUI()
  saveSettings()
}

function seekVolume(e) {
  const rect = dom.volumeBar.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  state.volume = percent
  state.isMuted = false
  updateVolumeUI()
  // 拖拽中实时保存
  saveSettings()
}

// ========== 进度条拖拽 ==========
let isDraggingProgress = false
dom.progressBar.addEventListener('mousedown', (e) => {
  isDraggingProgress = true
  seekProgress(e)
})
document.addEventListener('mousemove', (e) => {
  if (isDraggingProgress) seekProgress(e)
})
document.addEventListener('mouseup', () => {
  isDraggingProgress = false
})

// 音量拖拽
let isDraggingVolume = false
dom.volumeBar.addEventListener('mousedown', (e) => {
  isDraggingVolume = true
  seekVolume(e)
})
document.addEventListener('mousemove', (e) => {
  if (isDraggingVolume) seekVolume(e)
})
document.addEventListener('mouseup', () => {
  isDraggingVolume = false
})

// ========== 事件绑定 ==========
function bindEvents() {
  // 音频事件
  dom.audio.addEventListener('timeupdate', updateProgress)
  dom.audio.addEventListener('loadedmetadata', updateProgress)
  dom.audio.addEventListener('ended', () => {
    if (state.repeatMode === 'one') {
      dom.audio.currentTime = 0
      dom.audio.play()
    } else {
      playNext()
    }
  })
  dom.audio.addEventListener('play', () => {
    state.isPlaying = true
    updatePlayButton()
  })
  dom.audio.addEventListener('pause', () => {
    state.isPlaying = false
    updatePlayButton()
  })
  dom.audio.addEventListener('error', (e) => {
    // 跳过因 stopPlayback() 清空 src 引发的误报
    if (!dom.audio.src || dom.audio.src === window.location.href) return
    const song = state.playlist[state.currentSongIndex]
    console.error('音频加载错误:', song ? song.file_path : '(无歌曲)', e)
    if (state.playlist.length > 0 && state.currentSongIndex >= 0) {
      // 累加失败计数，超过 playlist 长度则停止，防止全部损坏时无限循环
      state._errorSkipCount = (state._errorSkipCount || 0) + 1
      if (state._errorSkipCount >= state.playlist.length) {
        console.warn('播放列表所有文件均无法加载，停止播放')
        state._errorSkipCount = 0
        stopPlayback()
        return
      }
      // 自动跳到下一首
      playNext()
    } else {
      stopPlayback()
    }
  })

  // 播放按钮
  dom.btnPlay.addEventListener('click', togglePlay)
  dom.btnPrev.addEventListener('click', playPrev)
  dom.btnNext.addEventListener('click', playNext)
  dom.btnMode.addEventListener('click', togglePlayMode)

  // 音量按钮
  dom.btnVolume.addEventListener('click', toggleMute)

  // 播放列表切换按钮
  dom.btnPlaylist.addEventListener('click', togglePlaylist)

  // 设置面板
  dom.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleSettings()
  })
  dom.settingsPanel.addEventListener('click', (e) => e.stopPropagation())
  document.addEventListener('click', hideSettings)

  // 分组操作
  dom.btnAddGroup.addEventListener('click', () => {
    showModal(dom.modalAddGroup)
    dom.inputGroupName.focus()
  })
  dom.btnGroupCancel.addEventListener('click', () => hideModal(dom.modalAddGroup))
  dom.btnGroupConfirm.addEventListener('click', addGroup)
  dom.inputGroupName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addGroup()
    if (e.key === 'Escape') hideModal(dom.modalAddGroup)
  })

  // 表头排序
  dom.sortTitle.addEventListener('click', () => toggleSort('title'))
  dom.sortArtist.addEventListener('click', () => toggleSort('artist'))

  // 清空数据库
  dom.btnClearDB.addEventListener('click', () => {
    showConfirm('确定要清空所有歌曲数据吗？\n此操作不可恢复，封面文件也将被删除。', async () => {
      stopPlayback()
      await api.clearAllSongs()
      await loadSongs(state.currentGroupId)
    })
  })

  // 刷新歌曲数据
  dom.btnRefreshSongs.addEventListener('click', async () => {
    const btn = dom.btnRefreshSongs
    const origText = btn.innerHTML
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 刷新中...'
    btn.disabled = true
    try {
      const result = await api.refreshAllSongs()
      if (result.success) {
        alert(`刷新完成！\n共 ${result.total} 首歌曲，成功更新 ${result.updated} 首。`)
        // 重新加载
        await loadSongs(state.currentGroupId)
        saveSettings()
        // 如果当前播放的歌曲数据变了，刷新播放信息
        if (state.playlist.length > 0 && state.currentSongIndex >= 0) {
          const song = state.playlist[state.currentSongIndex]
          if (song) {
            updatePlayerInfo(song)
          }
        }
      } else {
        alert('刷新失败，请查看控制台日志。')
      }
    } catch (e) {
      console.error('[Refresh] 刷新失败:', e)
      alert('刷新失败: ' + e.message)
    } finally {
      btn.innerHTML = origText
      btn.disabled = false
    }
  })

  // 删除失效歌曲
  dom.btnRemoveMissing.addEventListener('click', async () => {
    const btn = dom.btnRemoveMissing
    const origText = btn.innerHTML
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 扫描中...'
    btn.disabled = true
    try {
      const result = await api.removeMissingSongs()
      if (result.removed > 0) {
        alert(`已删除 ${result.removed} 首失效歌曲记录。`)
      } else {
        alert('没有找到失效的歌曲记录，所有文件均可正常访问。')
      }
      // 重新加载
      stopPlayback()
      await loadSongs(state.currentGroupId)
      saveSettings()
    } catch (e) {
      console.error('[RemoveMissing] 失败:', e)
      alert('扫描失败: ' + e.message)
    } finally {
      btn.innerHTML = origText
      btn.disabled = false
    }
  })

  // 按目录扫描导入
  dom.btnScanDirectory.addEventListener('click', async () => {
    const btn = dom.btnScanDirectory
    const origText = btn.innerHTML
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 扫描中...'
    btn.disabled = true
    try {
      const result = await api.scanDirectory()
      if (!result.success) {
        if (result.message !== '已取消') alert(result.message || '扫描失败')
        return
      }
      const totalSkipped = result.totalFiles - result.totalImported
      let msg = `扫描完成！\n\n根目录: ${result.rootPath}\n共 ${result.totalFiles} 个文件，成功导入 ${result.totalImported} 首。`
      if (totalSkipped > 0) msg += `\n跳过 ${totalSkipped} 首重复歌曲。`
      msg += `\n\n各分组详情:\n`
      for (const g of result.groups) {
        const gSkipped = g.files - g.imported
        let line = `\n  「${g.name}」— ${g.files} 个文件，导入 ${g.imported} 首`
        if (gSkipped > 0) line += `（跳过 ${gSkipped} 首重复）`
        msg += line
      }
      alert(msg)
      // 刷新界面
      stopPlayback()
      await loadGroups()
      const categories = await api.getCategories()
      if (categories.length > 0) {
        selectGroup(categories[0].id, categories[0].name)
      }
      saveSettings()
    } catch (e) {
      console.error('[ScanDirectory] 失败:', e)
      alert('扫描失败: ' + e.message)
    } finally {
      btn.innerHTML = origText
      btn.disabled = false
    }
  })

  // 频谱层无点击事件（样式切换已移至设置面板）

  // === 混响控件 ===
  if (dom.reverbToggle) {
    dom.reverbToggle.addEventListener('change', () => {
      toggleReverb(dom.reverbToggle.checked)
    })
  }
  if (dom.reverbWetGain) {
    dom.reverbWetGain.addEventListener('input', () => {
      state.reverbWetGain = dom.reverbWetGain.value / 100
      if (state.reverbEnabled && revWetGainNode) revWetGainNode.gain.value = state.reverbWetGain
      if (dom.reverbWetVal) dom.reverbWetVal.textContent = Math.round(state.reverbWetGain * 100) + '%'
      saveSettings()
    })
  }
  // === 低音增强控件 ===
  if (dom.bassToggle) {
    dom.bassToggle.addEventListener('change', () => {
      toggleBassBoost(dom.bassToggle.checked)
    })
  }
  if (dom.bassFreq) {
    dom.bassFreq.addEventListener('input', () => {
      state.bassBoostFreq = parseInt(dom.bassFreq.value)
      updateBassFilter()
      if (dom.bassFreqVal) dom.bassFreqVal.textContent = state.bassBoostFreq + 'Hz'
      saveSettings()
    })
  }
  if (dom.bassBoostGain) {
    dom.bassBoostGain.addEventListener('input', () => {
      state.bassBoostGain = parseInt(dom.bassBoostGain.value)
      updateBassFilter()
      if (dom.bassBoostVal) dom.bassBoostVal.textContent = '+' + state.bassBoostGain + 'dB'
      saveSettings()
    })
  }
  if (dom.bassWetGain) {
    dom.bassWetGain.addEventListener('input', () => {
      state.bassBoostWetGain = dom.bassWetGain.value / 100
      if (state.bassBoostEnabled && bassWetGainNode) bassWetGainNode.gain.value = state.bassBoostWetGain
      if (dom.bassWetVal) dom.bassWetVal.textContent = Math.round(state.bassBoostWetGain * 100) + '%'
      saveSettings()
    })
  }

  // === 快捷键录入 ===
  const scElements = [dom.scPlay, dom.scPrev, dom.scNext, dom.scVolup, dom.scVoldown]
  scElements.forEach(el => {
    if (!el) return
    el.addEventListener('click', () => {
      if (_recordingTarget === el) { cancelRecording(); return }
      startRecording(el)
    })
    // 右键清除恢复默认
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (_recordingTarget) cancelRecording()
      const action = el.id.replace('sc-', '')
      const defaults = { play: 'Space', prev: '', next: '', volup: 'ArrowUp', voldown: 'ArrowDown' }
      state.shortcuts[action] = defaults[action]
      el.textContent = keyToDisplay(defaults[action])
      el.dataset.key = defaults[action]
      el.classList.remove('recording')
      saveSettings()
    })
  })

  // 确认弹窗
  dom.btnConfirmCancel.addEventListener('click', () => {
    hideModal(dom.modalConfirm)
    confirmCallback = null
  })
  dom.btnConfirmOk.addEventListener('click', () => {
    if (confirmCallback) confirmCallback()
    hideModal(dom.modalConfirm)
    confirmCallback = null
  })

  // 点击弹窗背景关闭
  dom.modalAddGroup.addEventListener('click', (e) => {
    if (e.target === dom.modalAddGroup) hideModal(dom.modalAddGroup)
  })
  dom.modalConfirm.addEventListener('click', (e) => {
    if (e.target === dom.modalConfirm) hideModal(dom.modalConfirm)
  })

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    // 正在录制快捷键
    if (_recordingTarget) {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') { cancelRecording(); return }
      commitRecording(e.code)
      return
    }
    if (e.target.tagName === 'INPUT') return

    // 自定义快捷键（绑定到 state.shortcuts 的操作）
    const action = Object.entries(state.shortcuts).find(([, code]) => code && code === e.code)
    if (action) {
      switch (action[0]) {
        case 'play':
          e.preventDefault()
          togglePlay()
          return
        case 'prev':
          playPrev()
          return
        case 'next':
          playNext()
          return
        case 'volup':
          e.preventDefault()
          state.volume = Math.min(1, state.volume + 0.05)
          state.isMuted = false
          updateVolumeUI()
          saveSettings()
          return
        case 'voldown':
          e.preventDefault()
          state.volume = Math.max(0, state.volume - 0.05)
          state.isMuted = false
          updateVolumeUI()
          saveSettings()
          return
      }
    }

    // 硬编码：←/→ 跳进度 ±5秒（不被快捷键覆盖时生效）
    if (e.code === 'ArrowLeft') {
      dom.audio.currentTime = Math.max(0, dom.audio.currentTime - 5)
    } else if (e.code === 'ArrowRight') {
      dom.audio.currentTime = Math.min(dom.audio.duration || 0, dom.audio.currentTime + 5)
    }
  })

  // 搜索
  dom.searchInput.addEventListener('input', () => doSearch())
  dom.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { dom.searchInput.value = ''; doSearch() }
    if (e.key === 'Enter') {
      e.preventDefault()
      const highlighted = dom.songTbody.querySelectorAll('tr.search-highlight')
      if (highlighted.length === 0) return
      state.searchActiveIndex = (state.searchActiveIndex + 1) % highlighted.length
      // 去掉旧 active，加新 active
      highlighted.forEach(el => el.classList.remove('search-active'))
      const target = highlighted[state.searchActiveIndex]
      target.classList.add('search-active')
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
  dom.btnSearch.addEventListener('click', () => dom.searchInput.focus())

  // 窗口控制（Electron 环境）
  if (isElectron) {
    dom.btnMinimize.addEventListener('click', () => window.electronAPI.window.minimize())
    dom.btnClose.addEventListener('click', () => window.electronAPI.window.close())
  } else {
    // 浏览器模式下隐藏窗口控制按钮
    dom.btnMinimize.style.display = 'none'
    dom.btnClose.style.display = 'none'
  }

  // 多媒体按键开关
  dom.toggleMediaKeys = $('#toggle-media-keys')
  dom.toggleMediaKeys.addEventListener('change', () => {
    state.mediaKeysEnabled = dom.toggleMediaKeys.checked
    saveSettings()
    if (isElectron && window.electronAPI.mediaKeys) {
      window.electronAPI.mediaKeys.setEnabled(state.mediaKeysEnabled)
    }
  })

  // 自动关闭播放列表开关
  dom.toggleAutoClose = $('#toggle-auto-close')
  dom.toggleAutoClose.addEventListener('change', () => {
    state.autoClosePlaylist = dom.toggleAutoClose.checked
    saveSettings()
  })

  // 接收主进程发送的媒体按键事件
  if (isElectron && window.electronAPI.mediaKeys) {
    window.electronAPI.mediaKeys.onAction((action) => {
      if (action === 'playpause') togglePlay()
      else if (action === 'play') { if (!state.playing) togglePlay() }
      else if (action === 'pause') { if (state.playing) togglePlay() }
      else if (action === 'next') playNext()
      else if (action === 'prev') playPrev()
    })
  }
}

// ========== HTML 转义 ==========
function escapeHtml(str) {
  if (!str) return ''
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ========== 初始化 ==========
async function init() {
  bindEvents()
  startSpectrumAnimation()

  // 加载本地配置
  await loadSettings()

  // 同步快捷键 UI
  syncShortcutUI()

  // 应用音量
  updateVolumeUI()

  // 应用多媒体按键设置
  if (dom.toggleMediaKeys) {
    dom.toggleMediaKeys.checked = state.mediaKeysEnabled
  }

  // 应用自动关闭播放列表设置
  if (dom.toggleAutoClose) {
    dom.toggleAutoClose.checked = state.autoClosePlaylist
  }

  // 应用循环/随机模式按钮
  const modes = [
    { repeatMode: 'all',  shuffleMode: false, icon: 'fa-repeat',              title: '循环模式' },
    { repeatMode: 'none', shuffleMode: true,  icon: 'fa-shuffle',             title: '随机模式' },
    { repeatMode: 'one',  shuffleMode: false, icon: 'fa-arrows-to-circle',    title: '单曲重复' },
  ]
  const mode = modes.find(m => m.repeatMode === state.repeatMode && m.shuffleMode === state.shuffleMode) || modes[0]
  const btnMode = dom.btnMode
  btnMode.title = mode.title
  btnMode.querySelector('i').className = `fa-solid ${mode.icon}`
  btnMode.classList.toggle('active', state.shuffleMode || state.repeatMode === 'one')

  updatePlayButton()

  // 应用主题背景
  dom.spectrumLayer.style.backgroundImage = `url(${bgPathToUrl(state.themeBg)})`

  // 应用播放列表显示状态
  if (state._restorePlaylistVisible) {
    $('#app').style.display = 'flex'
  }

  // 加载分组列表
  const categories = await api.getCategories()
  const restoreGroupId = state._restoreGroupId
  const restoreSongId = state._restoreSongId

  if (restoreGroupId && categories.find(c => c.id === restoreGroupId)) {
    selectGroup(restoreGroupId, categories.find(c => c.id === restoreGroupId).name)
  } else if (categories.length > 0) {
    selectGroup(categories[0].id, categories[0].name)
  }
  await loadGroups()

  // 恢复上次播放的歌曲（不自动播放）
  if (restoreSongId && restoreGroupId) {
    const idx = state.playlist.findIndex(s => s.id === restoreSongId)
    if (idx >= 0) {
      state.currentSongIndex = idx
      const song = state.playlist[idx]
      dom.playerTitle.textContent = song.title
      dom.playerArtist.textContent = song.artist
      dom.circleTitle.textContent = song.title
      dom.circleArtist.textContent = song.artist
      dom.timeTotal.textContent = formatTime(song.duration)
      loadPlayerCover(song)
      state.lrcLines = parseLrc(song.lyrics || '')
      renderLrcPanel()
      if (state.lrcLines.length === 0 && song.lyrics) {
        dom.playerLrc.textContent = parseRawLyricsFirstLine(song.lyrics)
      }
      // 预加载音频源
      dom.audio.src = resolveFilePath(song.file_path)
      dom.audio.volume = state.isMuted ? 0 : state.volume
      renderSongList(state.playlist)
    }
  }
}

init().catch(console.error)
