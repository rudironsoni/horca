import type { ILink, ILinkProvider, OrcaDisposable } from '../../../../shared/orca-terminal-surface'

export function registerOrcaPaneLinkProvider(
  providers: Set<ILinkProvider>,
  provider: ILinkProvider
): OrcaDisposable {
  providers.add(provider)
  return {
    dispose: () => {
      providers.delete(provider)
    }
  }
}

export function bindOrcaPaneLinkProviders(pane: {
  element: HTMLCanvasElement
  cellWidth: number
  cellHeight: number
  cols: number
  rows: number
  baseY: number
  linkProviders: Set<ILinkProvider>
}): () => void {
  let hovered: ILink | null = null
  let request = 0
  const onMove = (event: MouseEvent): void => {
    queryProviders(pane, event, ++request, (hit, id) => {
      if (id !== request) {
        return
      }
      if (hovered && hovered !== hit) {
        hovered.leave?.(event, hovered.text ?? '')
        hovered = null
      }
      if (hit && hit !== hovered) {
        hit.hover?.(event, hit.text ?? '')
        hovered = hit
      }
    })
  }
  const onLeave = (event: MouseEvent): void => {
    request += 1
    if (hovered) {
      hovered.leave?.(event, hovered.text ?? '')
      hovered = null
    }
  }
  const onClick = (event: MouseEvent): void => {
    queryProviders(pane, event, ++request, (hit, id) => {
      if (id !== request || !hit?.activate) {
        return
      }
      hit.activate(event, hit.text ?? '')
    })
  }
  pane.element.addEventListener('pointermove', onMove)
  pane.element.addEventListener('pointerleave', onLeave)
  pane.element.addEventListener('click', onClick)
  return () => {
    request += 1
    pane.element.removeEventListener('pointermove', onMove)
    pane.element.removeEventListener('pointerleave', onLeave)
    pane.element.removeEventListener('click', onClick)
    hovered = null
  }
}

function queryProviders(
  pane: {
    element: HTMLCanvasElement
    cellWidth: number
    cellHeight: number
    cols: number
    rows: number
    baseY: number
    linkProviders: Set<ILinkProvider>
  },
  event: MouseEvent,
  id: number,
  onHit: (link: ILink | null, id: number) => void
): void {
  const rect = pane.element.getBoundingClientRect()
  const col = Math.floor((event.clientX - rect.left) / pane.cellWidth)
  const row = Math.floor((event.clientY - rect.top) / pane.cellHeight)
  if (col < 0 || row < 0 || col >= pane.cols || row >= pane.rows) {
    onHit(null, id)
    return
  }
  const bufferLineNumber = pane.baseY + row + 1
  const x = col + 1
  const y = bufferLineNumber
  let remaining = pane.linkProviders.size
  if (remaining === 0) {
    onHit(null, id)
    return
  }
  let delivered = false
  for (const provider of pane.linkProviders) {
    provider.provideLinks(bufferLineNumber, (links) => {
      if (delivered) {
        return
      }
      const hit =
        links?.find((link) => {
          const afterStart =
            y > link.range.start.y || (y === link.range.start.y && x >= link.range.start.x)
          const beforeEnd =
            y < link.range.end.y || (y === link.range.end.y && x <= link.range.end.x)
          return afterStart && beforeEnd
        }) ?? null
      if (hit) {
        delivered = true
        onHit(hit, id)
        return
      }
      remaining -= 1
      if (remaining === 0) {
        onHit(null, id)
      }
    })
  }
}
