import { ref, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '@/stores/player'

export function useVisualizer() {
  const player = usePlayerStore()
  const animId = ref(null)
  let circleRotationAngle = 0

  function spectrumColor(index, total, value) {
    const intensity = value / 255
    const pos = index / total
    const hue = pos * 360
    const lightness = 30 + intensity * 40
    return `hsl(${hue}, 100%, ${lightness}%)`
  }

  function drawBar(canvas, analyserNode, spectrumDataArray) {
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

  function drawSquare(canvas, analyserNode, spectrumDataArray) {
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

  function draw3D(canvas, analyserNode, spectrumDataArray) {
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

      ctx.fillStyle = mainC
      ctx.fillRect(x, h - barH, barWidth, barH)

      ctx.fillStyle = topC
      ctx.beginPath()
      ctx.moveTo(x, h - barH)
      ctx.lineTo(x + depth, h - barH - depth)
      ctx.lineTo(x + barWidth + depth, h - barH - depth)
      ctx.lineTo(x + barWidth, h - barH)
      ctx.closePath()
      ctx.fill()

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

  const drawFns = { bar: drawBar, square: drawSquare, '3d': draw3D }

  function drawCircle(circleCanvas, analyserNode, spectrumDataArray, circleCenterImage) {
    const ctx = circleCanvas.getContext('2d')
    const cw = circleCanvas.clientWidth
    const ch = circleCanvas.clientHeight
    const dpr = window.devicePixelRatio || 1

    if (circleCanvas.width !== cw * dpr || circleCanvas.height !== ch * dpr) {
      circleCanvas.width = cw * dpr
      circleCanvas.height = ch * dpr
    }
    circleCanvas.style.width = cw + 'px'
    circleCanvas.style.height = ch + 'px'

    const centerX = circleCanvas.width / 2
    const centerY = circleCanvas.height / 2
    const radius = Math.min(circleCanvas.width, circleCanvas.height) / 2 - 12

    ctx.clearRect(0, 0, circleCanvas.width, circleCanvas.height)

    circleRotationAngle += 0.005

    if (!analyserNode) {
      const imgSize = radius * 0.4
      if (circleCenterImage.complete && circleCenterImage.naturalWidth) {
        ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(circleRotationAngle)
        ctx.beginPath(); ctx.arc(0, 0, imgSize, 0, Math.PI * 2); ctx.clip()
        ctx.drawImage(circleCenterImage, -imgSize, -imgSize, imgSize * 2, imgSize * 2)
        ctx.restore()

        ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(-circleRotationAngle * 2)
        ctx.strokeStyle = `hsla(${circleRotationAngle * 20 % 360}, 100%, 60%, 0.5)`
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(0, 0, imgSize + 5, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.arc(0, 0, imgSize + 10, 0, Math.PI * 2); ctx.stroke()
        ctx.restore()
      } else {
        ctx.beginPath(); ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill()
        ctx.beginPath(); ctx.arc(centerX, centerY, 14, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke()
      }
      return
    }

    analyserNode.getByteFrequencyData(spectrumDataArray)
    let sum = 0
    for (let i = 0; i < spectrumDataArray.length; i++) sum += spectrumDataArray[i]
    const average = sum / spectrumDataArray.length
    circleRotationAngle += 0.005 + (average / 255) * 0.01

    const imgSize = radius * 0.4
    if (circleCenterImage.complete && circleCenterImage.naturalWidth) {
      ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(circleRotationAngle)
      ctx.beginPath(); ctx.arc(0, 0, imgSize, 0, Math.PI * 2); ctx.clip()
      ctx.drawImage(circleCenterImage, -imgSize, -imgSize, imgSize * 2, imgSize * 2)
      ctx.restore()

      ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(-circleRotationAngle * 2)
      ctx.strokeStyle = `hsla(${circleRotationAngle * 20 % 360}, 100%, 60%, 0.5)`
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, imgSize + 5, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, imgSize + 10, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    } else {
      ctx.beginPath(); ctx.arc(centerX, centerY, 6, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill()
      ctx.beginPath(); ctx.arc(centerX, centerY, 14, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke()
    }

    const barCount = 48
    const innerRadius = imgSize + 15
    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2
      const dataIndex = Math.floor(i * spectrumDataArray.length / barCount)
      const val = spectrumDataArray[dataIndex]
      const barH = (val / 255) * (radius - innerRadius - 10)
      ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(angle)
      ctx.fillStyle = spectrumColor(i, barCount, val)
      ctx.fillRect(innerRadius, -1.5, barH, 3)
      ctx.restore()
    }

    const outerRadius = radius - 4
    const lineCount = 96
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2
      const dataIndex = Math.floor(i * spectrumDataArray.length / lineCount)
      const val = spectrumDataArray[dataIndex]
      const lineLen = (val / 255) * 14 + 2
      ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(angle)
      ctx.strokeStyle = spectrumColor(i, lineCount, val)
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(outerRadius, 0); ctx.lineTo(outerRadius + lineLen, 0)
      ctx.stroke(); ctx.restore()
    }
  }

  function startLoop(spectrumCanvas, circleCanvas, getAnalyser, getData, getCircleImage) {
    if (animId.value) return

    function loop() {
      if (!player.spectrumVisible) {
        animId.value = requestAnimationFrame(loop)
        return
      }

      // 每帧动态获取，避免闭包捕获 null 后永不更新
      const analyserNode = getAnalyser()
      const spectrumDataArray = getData()
      const circleCenterImage = getCircleImage()

      // Draw main spectrum
      if (analyserNode && spectrumCanvas) {
        const dpr = window.devicePixelRatio || 1
        const cw = spectrumCanvas.clientWidth
        const ch = spectrumCanvas.clientHeight
        if (spectrumCanvas.width !== cw * dpr || spectrumCanvas.height !== ch * dpr) {
          spectrumCanvas.width = cw * dpr
          spectrumCanvas.height = ch * dpr
        }
        const fn = drawFns[player.spectrumMode] || drawBar
        fn(spectrumCanvas, analyserNode, spectrumDataArray)
      }
      // Draw circle
      if (circleCanvas) {
        drawCircle(circleCanvas, analyserNode, spectrumDataArray, circleCenterImage)
      }
      animId.value = requestAnimationFrame(loop)
    }

    animId.value = requestAnimationFrame(loop)
  }

  function stopLoop() {
    if (animId.value) {
      cancelAnimationFrame(animId.value)
      animId.value = null
    }
  }

  onBeforeUnmount(() => {
    stopLoop()
  })

  return {
    startLoop, stopLoop,
  }
}
