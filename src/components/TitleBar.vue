<template>
  <div id="titlebar">
    <div class="titlebar-drag">
      <i class="fa-solid fa-music titlebar-icon"></i>
      <span class="titlebar-title">KMusic</span>
    </div>
    <div class="titlebar-controls">
      <button id="btn-minimize" title="最小化" @click="minimize">
        <i class="fa-solid fa-window-minimize"></i>
      </button>
      <button id="btn-close" title="关闭" @click="closeWindow">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>
</template>

<script setup>
const isElectron = !!(window.electronAPI)

function minimize() {
  if (isElectron) window.electronAPI.window.minimize()
}

function closeWindow() {
  if (isElectron) window.electronAPI.window.close()
}
</script>
