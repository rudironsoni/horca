export type OverlayScrollbarSource = {
  total: number
  offset: number
  len: number
}

export type OrcaPaneOverlayScrollbar = {
  sync(): void
  dispose(): void
}

export function mountOrcaPaneOverlayScrollbar(
  host: HTMLElement,
  read: () => OverlayScrollbarSource,
  onDelta: (delta: number) => void
): OrcaPaneOverlayScrollbar {
  const track = document.createElement('div')
  track.className = 'orca-terminal-scrollbar orca-terminal-vertical'
  const slider = document.createElement('div')
  slider.className = 'orca-terminal-slider'
  track.appendChild(slider)
  host.appendChild(track)
  let dragging = false
  let dragStartY = 0
  let dragStartOffset = 0

  const sync = (): void => {
    const bar = read()
    if (bar.total <= bar.len) {
      track.style.display = 'none'
      return
    }
    track.style.display = ''
    const trackHeight = track.clientHeight || host.clientHeight
    const thumbHeight = Math.max(16, (bar.len / bar.total) * trackHeight)
    const maxOffset = Math.max(1, bar.total - bar.len)
    const top = (bar.offset / maxOffset) * (trackHeight - thumbHeight)
    slider.style.height = `${thumbHeight}px`
    slider.style.top = `${Math.max(0, top)}px`
  }

  const onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    const bar = read()
    const trackHeight = track.clientHeight || 1
    const maxOffset = Math.max(1, bar.total - bar.len)
    if (event.target === slider) {
      dragging = true
      dragStartY = event.clientY
      dragStartOffset = bar.offset
      slider.setPointerCapture(event.pointerId)
      return
    }
    const ratio = event.offsetY / trackHeight
    const next = Math.round(ratio * maxOffset)
    onDelta(next - bar.offset)
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) {
      return
    }
    const bar = read()
    const trackHeight = track.clientHeight || 1
    const thumbHeight = slider.clientHeight || 16
    const maxOffset = Math.max(1, bar.total - bar.len)
    const travel = Math.max(1, trackHeight - thumbHeight)
    const next = dragStartOffset + ((event.clientY - dragStartY) / travel) * maxOffset
    onDelta(Math.round(next - bar.offset))
  }
  const onPointerUp = (): void => {
    dragging = false
  }
  track.addEventListener('pointerdown', onPointerDown)
  slider.addEventListener('pointermove', onPointerMove)
  slider.addEventListener('pointerup', onPointerUp)
  return {
    sync,
    dispose() {
      track.removeEventListener('pointerdown', onPointerDown)
      slider.removeEventListener('pointermove', onPointerMove)
      slider.removeEventListener('pointerup', onPointerUp)
      track.remove()
    }
  }
}
