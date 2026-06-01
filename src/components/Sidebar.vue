<template>
  <aside id="sidebar">
    <div class="sidebar-header">
      <h3><i class="fa-solid fa-list"></i> 我的歌单</h3>
      <button class="btn-icon" title="新建分组" @click="library.openGroupModal()">
        <i class="fa-solid fa-plus"></i>
      </button>
    </div>
    <ul id="group-list">
      <li
        v-for="cat in library.categories"
        :key="cat.id"
        class="group-item"
        :class="{ active: cat.id === library.currentGroupId }"
        @click="selectGroupIfNotEditing(cat, $event)"
      >
        <span class="group-item-name" @dblclick.stop="startRename(cat)">{{ cat.name }}</span>
        <button class="group-item-import" title="导入歌曲" @click.stop="importToGroup(cat)">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="group-item-rename" title="重命名" @click.stop="startRename(cat)">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="group-item-del" title="删除分组" @click.stop="confirmDelete(cat)">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </li>
    </ul>
  </aside>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { useApi } from '@/composables/useApi'

const library = useLibraryStore()
const player = usePlayerStore()
const api = useApi()

const editingCatId = ref(null)

function selectGroupIfNotEditing(cat, e) {
  if (e.target.closest('.group-item-del') ||
      e.target.closest('.group-item-rename') ||
      e.target.closest('.group-item-import') ||
      e.target.closest('.group-item-rename-input')) return
  library.selectGroup(cat.id, cat.name)
}

function importToGroup(cat) {
  library.selectGroup(cat.id, cat.name)
  doImport(cat.id)
}

async function doImport(catId) {
  const result = await library.importSongs(catId)
  if (result.success) {
    const skipped = (result.total || result.count) - result.count
    let msg = `成功导入 ${result.count} 首歌曲。`
    if (skipped > 0) msg += `\n跳过 ${skipped} 首重复歌曲。`
    alert(msg)
  } else if (result.message) {
    alert(result.message)
  }
}

function startRename(cat) {
  editingCatId.value = cat.id
  nextTick(() => {
    const input = document.querySelector('.group-item-rename-input')
    if (input) { input.focus(); input.select() }
  })
}

function finishRename(cat, newName) {
  newName = newName.trim()
  if (newName && newName !== cat.name) {
    api.renameCategory(cat.id, newName).then(() => {
      if (cat.id === library.currentGroupId) {
        library.currentGroupName = newName
      }
      library.loadGroups()
    }).catch(err => alert(err.message || '重命名失败'))
  }
  editingCatId.value = null
}

function onRenameKeydown(cat, e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    finishRename(cat, e.target.value)
  }
  if (e.key === 'Escape') {
    editingCatId.value = null
  }
}

function confirmDelete(cat) {
  library.showConfirm(`确定要删除分组「${cat.name}」吗？\n分组内的所有歌曲也将被删除。`, async () => {
    await library.deleteGroup(cat.id)
  })
}
</script>

<style scoped>
/* Sidebar styles are in global style.css */
</style>
