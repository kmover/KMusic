export function parseLrc(lrcText) {
  if (!lrcText) return []
  const lines = lrcText.replace(/\r/g, '').split('\n')
  const result = []
  for (const line of lines) {
    const timeReg = /\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g
    const matches = [...line.matchAll(timeReg)]
    if (matches.length === 0) continue

    let text = line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{2,3}))?\]/g, '').trim()
    if (!text) continue

    const lastMatch = matches[matches.length - 1]
    const min = parseInt(lastMatch[1])
    const sec = parseInt(lastMatch[2])
    const ms = lastMatch[3] ? parseInt(lastMatch[3].padEnd(3, '0')) : 0
    const time = min * 60 + sec + ms / 1000

    result.push({ time, text })
  }
  result.sort((a, b) => a.time - b.time)
  return result
}

export function parseRawLyricsFirstLine(lrcText) {
  if (!lrcText) return ''
  const lines = lrcText.replace(/\r/g, '').split('\n')
  for (const line of lines) {
    const t = line.trim()
    if (t && !/^\[(ti|ar|al|by|offset|length):/i.test(t)) return t
  }
  return ''
}

export function getCurrentLrcLine(lines, currentTime) {
  if (!lines.length) return -1
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (currentTime >= lines[i].time) {
      idx = i
    } else {
      break
    }
  }
  return idx
}

export function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
