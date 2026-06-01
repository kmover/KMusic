<template>
  <div id="modal-add-group" class="modal" :class="{ show: library.showGroupModal }" @click.self="library.closeGroupModal()">
    <div class="modal-content">
      <h3>新建分组</h3>
      <input
        type="text"
        v-model="groupName"
        placeholder="输入分组名称"
        maxlength="30"
        @keydown.enter="confirm"
        @keydown.escape="library.closeGroupModal()"
        ref="inputRef"
      />
      <div class="modal-buttons">
        <button class="btn" @click="library.closeGroupModal()">取消</button>
        <button class="btn btn-primary" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'

const library = useLibraryStore()
const groupName = ref('')
const inputRef = ref(null)

watch(() => library.showGroupModal, (show) => {
  if (show) {
    groupName.value = ''
    nextTick(() => inputRef.value?.focus())
  }
})

async function confirm() {
  const name = groupName.value.trim()
  if (!name) return
  try {
    await library.addGroup(name)
    library.closeGroupModal()
    // select the new group
    const cat = library.categories.find(c => c.name === name)
    if (cat) library.selectGroup(cat.id, cat.name)
  } catch (err) {
    alert(err.message || '添加失败')
  }
}
</script>
