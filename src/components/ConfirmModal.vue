<template>
  <div id="modal-confirm" class="modal" :class="{ show: library.showConfirmModal }" @click.self="library.closeConfirm()">
    <div class="modal-content modal-small">
      <p>{{ library.confirmMessage }}</p>
      <div class="modal-buttons">
        <button class="btn" @click="library.closeConfirm()">取消</button>
        <button class="btn btn-danger" @click="library.confirmOk()">删除</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useLibraryStore } from '@/stores/library'
const library = useLibraryStore()
</script>
