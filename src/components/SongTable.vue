<template>
  <div id="playlist-header">
    <h2 id="current-group-name">{{ library.currentGroupName || '默认列表' }}</h2>
    <div class="search-input-wrap">
      <input
        type="text"
        id="search-input"
        v-model="searchText"
        placeholder="搜索歌曲、歌手..."
        @input="onSearch"
        @keydown="onSearchKeydown"
      />
      <button id="btn-search" title="搜索" @click="focusSearch">
        <i class="fa-solid fa-magnifying-glass"></i>
      </button>
    </div>
  </div>

  <div id="song-list-container">
    <table id="song-table" v-show="library.filteredSongs.length > 0">
      <thead>
        <tr>
          <th class="col-index">#</th>
          <th class="col-title sortable" :class="sortTitleClass" @click="library.toggleSort('title')">标题</th>
          <th class="col-artist sortable" :class="sortArtistClass" @click="library.toggleSort('artist')">歌手</th>
          <th class="col-duration">时长</th>
          <th class="col-action">操作</th>
        </tr>
      </thead>
      <tbody id="song-tbody">
        <tr
          v-for="(song, index) in library.filteredSongs"
          :key="song.id"
          :class="{
            playing: isCurrentSong(song),
            'search-highlight': matchesSearch(song),
            'search-active': isSearchActive(song, index)
          }"
          @click="playSong(index)"
        >
          <td class="col-index">{{ index + 1 }}</td>
          <td class="col-title">{{ song.title }}</td>
          <td class="col-artist">{{ song.artist }}</td>
          <td class="col-duration">{{ formatDuration(song.duration) }}</td>
          <td class="col-action">
            <button class="btn-song-del" title="删除" @click.stop="confirmDeleteSong(song)">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div id="empty-hint" class="empty-hint" v-show="library.filteredSongs.length === 0">
      <div class="empty-icon"><i class="fa-solid fa-music"></i></div>
      <p>暂无歌曲，点击「导入歌曲」添加</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useLibraryStore } from '@/stores/library'
import { usePlayerStore } from '@/stores/player'
import { formatTime } from '@/composables/useLyrics'

const library = useLibraryStore()
const player = usePlayerStore()

const searchText = ref('')
let searchMatchCount = 0
let searchMatchIndices = []

const sortTitleClass = computed(() => ({
  'sort-asc': library.sortKey === 'title' && library.sortOrder === 'asc',
  'sort-desc': library.sortKey === 'title' && library.sortOrder === 'desc',
}))

const sortArtistClass = computed(() => ({
  'sort-asc': library.sortKey === 'artist' && library.sortOrder === 'asc',
  'sort-desc': library.sortKey === 'artist' && library.sortOrder === 'desc',
}))

function isCurrentSong(song) {
  return player.currentSongIndex >= 0 &&
    library.filteredSongs[player.currentSongIndex]?.id === song.id
}

function matchesSearch(song) {
  if (!searchText.value) return false
  const q = searchText.value.toLowerCase()
  return song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q)
}

function isSearchActive(song, index) {
  if (!searchText.value) return false
  // count search matches
  return false // handled by render logic
}

function formatDuration(dur) {
  return formatTime(dur)
}

function onSearch() {
  library.searchQuery = searchText.value
  library.searchActiveIndex = 0
}

function onSearchKeydown(e) {
  if (e.key === 'Escape') { searchText.value = ''; onSearch() }
  if (e.key === 'Enter') {
    e.preventDefault()
    const highlighted = document.querySelectorAll('#song-tbody tr.search-highlight')
    if (highlighted.length === 0) return
    library.searchActiveIndex = (library.searchActiveIndex + 1) % highlighted.length
    highlighted.forEach(el => el.classList.remove('search-active'))
    const target = highlighted[library.searchActiveIndex]
    target.classList.add('search-active')
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

function focusSearch() {
  document.querySelector('#search-input')?.focus()
}

function playSong(index) {
  player.playSong(index)
}

function confirmDeleteSong(song) {
  library.showConfirm('确定要从播放列表中删除这首歌曲吗？', async () => {
    if (player.currentSong?.id === song.id) {
      player.stopPlayback()
    }
    await library.deleteSong(song.id)
  })
}

// Auto-scroll to active result
watch(() => library.searchActiveIndex, () => {
  nextTick(() => {
    const active = document.querySelector('#song-tbody tr.search-active')
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
})
</script>

<style scoped>
/* SongTable styles are in global style.css */
</style>
