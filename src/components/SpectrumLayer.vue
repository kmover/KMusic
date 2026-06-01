<template>
  <div id="spectrum-layer" :style="{ backgroundImage: `url(${library.currentThemeUrl})` }">
    <canvas id="spectrum-canvas" ref="spectrumCanvas"></canvas>
    <canvas id="circle-canvas" ref="circleCanvas"></canvas>
    <div class="circle-song-info" id="circle-title">{{ circleTitle }}</div>
    <div class="circle-song-info" id="circle-artist">{{ circleArtist }}</div>
    <div id="lrc-panel">
      <div id="lrc-list" ref="lrcListRef">
        <div v-if="lrcLines.length === 0" class="lrc-line" style="color:rgba(255,255,255,0.25)">暂无歌词</div>
        <div
          v-for="(line, index) in lrcLines"
          :key="index"
          class="lrc-line"
          :class="{ active: index === player.currentLrcLine, past: index < player.currentLrcLine }"
          :data-index="index"
        >{{ line.text }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useAudioEngine } from '@/composables/useAudioEngine'
import { useVisualizer } from '@/composables/useVisualizer'

const library = useLibraryStore()
const player = usePlayerStore()
const audioEngine = useAudioEngine()
const { startLoop, stopLoop } = useVisualizer()

const spectrumCanvas = ref(null)
const circleCanvas = ref(null)
const lrcListRef = ref(null)

const circleTitle = computed(() => player.currentSong?.title || '歌曲名称')
const circleArtist = computed(() => player.currentSong?.artist || '歌手')
const lrcLines = computed(() => player.lrcLines)

// 歌词自动滚动：当前行变化时滚动到可见区域
watch(() => player.currentLrcLine, async (lineIdx) => {
  await nextTick()
  const container = lrcListRef.value
  if (!container || lineIdx < 0) return
  const items = container.querySelectorAll('.lrc-line')
  if (lineIdx < items.length) {
    const item = items[lineIdx]
    // 逐行滚动：让当前行显示在容器上 1/3 位置，避免一直顶在顶部
    container.scrollTo({
      top: item.offsetTop - container.clientHeight * 0.3,
      behavior: 'smooth'
    })
  }
})

// 切歌时重置滚动位置到顶部
watch(() => player.currentSongIndex, () => {
  const container = lrcListRef.value
  if (container) container.scrollTop = 0
})

// Start visualizer on mount
onMounted(() => {
  if (spectrumCanvas.value && circleCanvas.value) {
    startLoop(
      spectrumCanvas.value,
      circleCanvas.value,
      () => audioEngine.getAnalyserNode(),
      () => audioEngine.getSpectrumData(),
      () => audioEngine.getCircleImage()
    )
  }
})

// Watch spectrum visibility
watch(() => player.spectrumVisible, (visible) => {
  if (visible) {
    startLoop(
      spectrumCanvas.value,
      circleCanvas.value,
      () => audioEngine.getAnalyserNode(),
      () => audioEngine.getSpectrumData(),
      () => audioEngine.getCircleImage()
    )
  } else {
    stopLoop()
  }
})
</script>

<style scoped>
/* SpectrumLayer styles are in global style.css */
</style>
