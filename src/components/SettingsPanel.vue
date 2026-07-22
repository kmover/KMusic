<template>
  <div id="settings-panel" @click.stop>
    <!-- 频谱样式 -->
    <div class="settings-section">
      <div class="settings-label">频谱样式</div>
      <div class="spectrum-options">
        <button
          v-for="mode in spectrumModes"
          :key="mode.key"
          class="spectrum-opt"
          :class="{ active: player.spectrumMode === mode.key }"
          @click="player.selectSpectrumMode(mode.key)"
        >{{ mode.label }}</button>
      </div>
    </div>

    <!-- 环境混响音效 -->
    <div class="settings-section">
      <div class="settings-label">环境混响音效</div>
      <div class="convolution-grid">
        <button
          v-for="preset in convolutionPresets"
          :key="preset.name"
          class="convolution-opt"
          :class="{ active: player.convolutionSelectionKey === `builtin:${preset.name}` }"
          @click="onSelectConvolution(preset)"
        >{{ preset.label }}</button>
      </div>
      <div class="convolution-sliders" :class="{ disabled: !player.convolutionFileName }">
        <div class="reverb-slider-row">
          <span class="reverb-label">原始音频增益</span>
          <input type="range" class="reverb-range" min="0" max="30" step="1" v-model.number="convMainGain" @input="onMainGainChange" />
          <span class="reverb-val">{{ convMainGainDisplay }}%</span>
        </div>
        <div class="reverb-slider-row">
          <span class="reverb-label">环境音效增益</span>
          <input type="range" class="reverb-range" min="0" max="30" step="1" v-model.number="convSendGain" @input="onSendGainChange" />
          <span class="reverb-val">{{ convSendGainDisplay }}%</span>
        </div>
      </div>
      <!-- 预设管理 -->
      <div class="convolution-presets">
        <button
          v-for="preset in player.convolutionPresets"
          :key="preset.id"
          class="convolution-preset-btn"
          :class="{ active: player.convolutionSelectionKey === `user:${preset.id}` }"
          :title="`加载预设: ${preset.name}\n右键删除`"
          @click="onLoadPreset(preset)"
          @contextmenu.prevent="onDeletePreset(preset.id)"
        >{{ preset.name }}</button>
        <button
          class="convolution-preset-btn convolution-preset-add"
          title="保存当前设置为预设"
          @click="showSavePreset = true"
        >+ 保存预设</button>
      </div>
      <!-- 保存预设输入框 -->
      <div v-if="showSavePreset" class="convolution-save-row">
        <input
          v-model="newPresetName"
          class="convolution-save-input"
          placeholder="输入预设名称"
          @keyup.enter="onSavePreset"
          @keyup.escape="showSavePreset = false"
          ref="saveInputRef"
        />
        <button class="convolution-save-ok" @click="onSavePreset">保存</button>
        <button class="convolution-save-cancel" @click="showSavePreset = false">取消</button>
      </div>
    </div>

    <!-- 低音增强 -->
    <div class="settings-section">
      <div class="settings-label">低音增强</div>
      <label class="settings-toggle">
        <input type="checkbox" v-model="player.bassBoostEnabled" @change="onBassToggle" />
        <span>启用低音增强</span>
      </label>
      <div class="reverb-slider-row">
        <span class="reverb-label">分频点</span>
        <input type="range" class="reverb-range" min="40" max="300" v-model.number="player.bassBoostFreq" @input="saveSettings" />
        <span class="reverb-val">{{ player.bassBoostFreq }}Hz</span>
      </div>
      <div class="reverb-slider-row">
        <span class="reverb-label">低音增益</span>
        <input type="range" class="reverb-range" min="0" max="24" v-model.number="player.bassBoostGain" @input="saveSettings" />
        <span class="reverb-val">+{{ player.bassBoostGain }}dB</span>
      </div>
      <div class="reverb-slider-row">
        <span class="reverb-label">增强增益</span>
        <input type="range" class="reverb-range" min="0" max="200" v-model.number="bassWetPercent" @input="onBassWetChange" />
        <span class="reverb-val">{{ bassWetPercent }}%</span>
      </div>
    </div>

    <!-- 主题选择 -->
    <div class="settings-section">
      <div class="settings-label">主题选择</div>
      <div class="theme-grid">
        <div
          v-for="theme in builtinThemes"
          :key="theme.path"
          class="theme-item"
          :class="{ active: library.themeBg === theme.path }"
          :style="{ backgroundImage: `url(${themeUrl(theme.path)})` }"
          :title="theme.name"
          @click="selectTheme(theme.path)"
        ></div>
        <div
          v-for="(theme, idx) in library.customThemes"
          :key="'custom-' + idx"
          class="theme-item theme-item-custom"
          :class="{ active: library.themeBg === theme.path }"
          :style="{ backgroundImage: `url(${themeUrl(theme.path)})` }"
          :title="theme.name + '\n右键删除'"
          @click="selectTheme(theme.path)"
          @contextmenu.prevent="removeCustomTheme(idx)"
        ></div>
        <div class="theme-item theme-item-add" title="选择本地图片作为背景" @click="addCustomTheme">
          <i class="fa-solid fa-plus"></i>
        </div>
      </div>
    </div>

    <!-- 按键设置 -->
    <div class="settings-section">
      <div class="settings-label">按键设置</div>
      <label class="settings-toggle">
        <input type="checkbox" v-model="library.mediaKeysEnabled" @change="saveSettings" />
        <span>响应键盘媒体按键</span>
      </label>
      <div class="shortcut-grid">
        <div class="shortcut-row" v-for="sc in shortcutList" :key="sc.key">
          <span class="shortcut-label">{{ sc.label }}</span>
          <div
            class="shortcut-input"
            :class="{ recording: recordingEl === sc.key }"
            :data-key="library.shortcuts[sc.key]"
            @click="startRec(sc.key, $event)"
            @contextmenu.prevent="resetShortcut(sc.key)"
          >{{ keyToDisplay(library.shortcuts[sc.key]) }}</div>
        </div>
      </div>
    </div>

    <!-- 播放列表 -->
    <div class="settings-section">
      <div class="settings-label">播放列表</div>
      <label class="settings-toggle">
        <input type="checkbox" v-model="library.autoClosePlaylist" @change="saveSettings" />
        <span>点击歌曲后自动关闭播放列表</span>
      </label>
    </div>

    <!-- 桌面歌词 -->
    <div class="settings-section">
      <div class="settings-label">桌面歌词</div>
      <p class="settings-hint">在控制条点击「桌面歌词」按钮开启悬浮窗</p>
      <div class="reverb-slider-row">
        <span class="reverb-label">字号</span>
        <input type="range" class="reverb-range" min="20" max="72" step="1" v-model.number="library.desktopLyrics.fontSize" @input="saveSettings" />
        <span class="reverb-val">{{ library.desktopLyrics.fontSize }}px</span>
      </div>
      <div class="reverb-slider-row">
        <span class="reverb-label">文字颜色</span>
        <input type="color" class="lyrics-color" v-model="library.desktopLyrics.color" @input="saveSettings" />
      </div>
      <div class="reverb-slider-row">
        <span class="reverb-label">背景不透明度</span>
        <input type="range" class="reverb-range" min="0" max="100" step="1" v-model.number="lyricsBgPercent" @input="saveSettings" />
        <span class="reverb-val">{{ lyricsBgPercent }}%</span>
      </div>
      <div class="reverb-slider-row">
        <span class="reverb-label">对齐</span>
        <select v-model="library.desktopLyrics.align" @change="saveSettings" class="settings-select">
          <option value="center">居中</option>
          <option value="left">居左</option>
        </select>
      </div>
      <label class="settings-toggle">
        <input type="checkbox" v-model="library.desktopLyrics.alwaysOnTop" @change="saveSettings" />
        <span>始终置顶显示</span>
      </label>
      <label class="settings-toggle">
        <input type="checkbox" v-model="library.desktopLyrics.clickThrough" @change="saveSettings" />
        <span>鼠标穿透（点击穿透到后方窗口）</span>
      </label>
      <label class="settings-toggle">
        <input type="checkbox" v-model="library.desktopLyrics.showNext" @change="saveSettings" />
        <span>显示下一句歌词</span>
      </label>
    </div>

    <!-- 数据管理 -->
    <div class="settings-section">
      <div class="settings-label">数据管理</div>
      <div class="settings-data-actions">
        <button class="settings-action-btn scan" @click="scanDirectory">
          <i class="fa-solid fa-folder-open"></i> 扫描目录导入
        </button>
        <button class="settings-action-btn refresh" @click="refreshSongs">
          <i class="fa-solid fa-rotate"></i> 刷新歌曲数据
        </button>
        <button class="settings-action-btn remove" @click="removeMissing">
          <i class="fa-solid fa-eraser"></i> 删除失效歌曲
        </button>
        <button class="settings-clear-btn" @click="clearAllData">
          <i class="fa-solid fa-broom"></i> 清空歌曲数据
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useApi } from '@/composables/useApi'
import { convolutionPresets } from '@/composables/useAudioEngine'
import { keyToDisplay } from '@/composables/useShortcuts'

const library = useLibraryStore()
const player = usePlayerStore()
const api = useApi()
const spectrumModes = [
  { key: 'bar', label: '条形频谱' },
  { key: 'square', label: '方格频谱' },
  { key: '3d', label: '3D立体' },
]

const builtinThemes = [
  { name: '绿意', path: './background/img-001.png' },
  { name: '山林', path: './background/img-002.png' },
  { name: '黄昏', path: './background/img-003.png' },
  { name: '极光', path: './background/img-004.png' },
  { name: '美好', path: './background/img-005.png' },
]

const shortcutList = [
  { key: 'play', label: '播放/暂停' },
  { key: 'prev', label: '上一曲' },
  { key: 'next', label: '下一曲' },
  { key: 'volup', label: '音量 ↑' },
  { key: 'voldown', label: '音量 ↓' },
]

const recordingEl = ref(null)
const bassWetPercent = ref(Math.round(player.bassBoostWetGain * 100))
const showSavePreset = ref(false)
const newPresetName = ref('')
const saveInputRef = ref(null)

// Convolution gain display (stored as ×10, display as percentage)
const convMainGain = ref(player.convolutionMainGain)
const convSendGain = ref(player.convolutionSendGain)

const convMainGainDisplay = computed(() => Math.round(convMainGain.value * 10))
const convSendGainDisplay = computed(() => Math.round(convSendGain.value * 10))

// 桌面歌词：背景不透明度（0~1）与滑动条（0~100）互转
const lyricsBgPercent = computed({
  get: () => Math.round((library.desktopLyrics.bgOpacity ?? 0.25) * 100),
  set: (v) => { library.desktopLyrics.bgOpacity = v / 100 }
})

function onSelectConvolution(preset) {
  player.selectConvolution(preset)
  convMainGain.value = player.convolutionMainGain
  convSendGain.value = player.convolutionSendGain
  // PlayerBar watch 统一响应 convolution 变化，此处不重复调用 setConvolution
  saveSettings()
}

function onMainGainChange() {
  player.setConvolutionGains(convMainGain.value, player.convolutionSendGain)
  // 增益变化由 PlayerBar watch 统一处理，避免与 AudioContext 并发冲突
  saveSettings()
}

function onSendGainChange() {
  player.setConvolutionGains(player.convolutionMainGain, convSendGain.value)
  saveSettings()
}

function onLoadPreset(preset) {
  player.loadConvolutionPreset(preset)
  convMainGain.value = player.convolutionMainGain
  convSendGain.value = player.convolutionSendGain
  saveSettings()
}

function onDeletePreset(id) {
  player.deleteConvolutionPreset(id)
  saveSettings()
}

async function onSavePreset() {
  const name = newPresetName.value.trim()
  if (!name) return
  player.saveConvolutionPreset(name)
  showSavePreset.value = false
  newPresetName.value = ''
  saveSettings()
}

// Show save input and focus
watch(showSavePreset, async (val) => {
  if (val) {
    await nextTick()
    if (saveInputRef.value) saveInputRef.value.focus()
  }
})

function themeUrl(path) {
  if (path && path.startsWith('covers/custom/')) {
    return `bg://custom/${path.replace('covers/custom/', '')}`
  }
  return path
}

function selectTheme(path) {
  library.selectTheme(path)
  saveSettings()
}

async function addCustomTheme() {
  const isElectron = !!(window.electronAPI)
  if (!isElectron || !window.electronAPI.theme) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (!file) return
      const dataUrl = URL.createObjectURL(file)
      const name = file.name.replace(/\.[^.]+$/, '')
      library.addCustomTheme({ name, path: dataUrl })
      selectTheme(dataUrl)
    }
    input.click()
    return
  }
  const savedPath = await api.pickCustomTheme()
  if (!savedPath) return
  const name = '自定义' + (library.customThemes.length + 1)
  library.addCustomTheme({ name, path: savedPath })
  selectTheme(savedPath)
}

function removeCustomTheme(index) {
  if (index < 0 || index >= library.customThemes.length) return
  const removed = library.customThemes[index]
  if (library.themeBg === removed.path) {
    library.selectTheme('./background/img-green.jpg')
  }
  library.removeCustomTheme(index)
  saveSettings()
}

function onBassToggle() {
  player.toggleBassBoost(player.bassBoostEnabled)
  saveSettings()
}

function onBassWetChange() {
  player.bassBoostWetGain = bassWetPercent.value / 100
  saveSettings()
}

function saveSettings() {
  library.saveSettings(player)
}

// Shortcut recording
function startRec(key, e) {
  const el = e.target
  if (recordingEl.value === key) {
    recordingEl.value = null
    el.classList.remove('recording')
    el.textContent = keyToDisplay(library.shortcuts[key])
    return
  }
  recordingEl.value = key
  el.classList.add('recording')
  el.textContent = '...'
}

function resetShortcut(key) {
  recordingEl.value = null
  const defaults = { play: 'Space', prev: '', next: '', volup: 'ArrowUp', voldown: 'ArrowDown' }
  library.shortcuts[key] = defaults[key]
  saveSettings()
}

function handleKeydown(e) {
  if (!recordingEl.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') {
    recordingEl.value = null
    return
  }
  const key = recordingEl.value
  library.shortcuts[key] = e.code
  recordingEl.value = null
  saveSettings()
}

// Register global keydown for recording
import { onMounted, onBeforeUnmount } from 'vue'
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))

// Data management actions
async function scanDirectory() {
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
  player.stopPlayback()
  await library.loadGroups()
  if (library.categories.length > 0) {
    library.selectGroup(library.categories[0].id, library.categories[0].name)
  }
  saveSettings()
}

async function refreshSongs() {
  const result = await api.refreshAllSongs()
  if (result.success) {
    alert(`刷新完成！\n共 ${result.total} 首歌曲，成功更新 ${result.updated} 首。`)
    await library.loadSongs()
    saveSettings()
  } else {
    alert('刷新失败')
  }
}

async function removeMissing() {
  const result = await api.removeMissingSongs()
  if (result.removed > 0) {
    alert(`已删除 ${result.removed} 首失效歌曲记录。`)
  } else {
    alert('没有找到失效的歌曲记录。')
  }
  player.stopPlayback()
  await library.loadSongs()
  saveSettings()
}

function clearAllData() {
  library.showConfirm('确定要清空所有歌曲数据吗？\n此操作不可恢复，封面文件也将被删除。', async () => {
    player.stopPlayback()
    await api.clearAllSongs()
    await library.loadSongs()
    saveSettings()
  })
}

// Sync sliders
watch(() => player.bassBoostWetGain, (val) => { bassWetPercent.value = Math.round(val * 100) })
watch(() => player.convolutionMainGain, (val) => { convMainGain.value = val })
watch(() => player.convolutionSendGain, (val) => { convSendGain.value = val })
</script>

<style scoped>
/* SettingsPanel styles are in global style.css */
</style>
