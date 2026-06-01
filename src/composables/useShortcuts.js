const KEY_DISPLAY = {
  Space: 'Space',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫', Delete: 'Del',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
}

export function keyToDisplay(code) {
  if (!code) return '—'
  if (KEY_DISPLAY[code]) return KEY_DISPLAY[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}
