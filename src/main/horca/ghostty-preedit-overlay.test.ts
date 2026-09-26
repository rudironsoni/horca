import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { syncGhosttyPreedit, PREEDIT_ATTR } = require(
  '../../../native/horca-ghostty/adopted/electron-ghostty/preedit-overlay.js'
) as {
  PREEDIT_ATTR: string
  syncGhosttyPreedit: (
    document: {
      body: { appendChild: (node: PreeditNode) => void }
      createElement: (tag: string) => PreeditNode
      querySelector: (sel: string) => PreeditNode | null
    },
    canvas: { getBoundingClientRect: () => { left: number; top: number } } | null,
    text: string
  ) => PreeditNode | null
}

type PreeditNode = {
  attrs: Record<string, string>
  textContent: string
  style: Record<string, string>
  parentNode: { removeChild: (node: PreeditNode) => void } | null
  setAttribute: (name: string, value: string) => void
}

function fakeDom() {
  const nodes: PreeditNode[] = []
  const body = {
    appendChild(node: PreeditNode) {
      node.parentNode = body
      nodes.push(node)
    },
    removeChild(node: PreeditNode) {
      const index = nodes.indexOf(node)
      if (index >= 0) nodes.splice(index, 1)
      node.parentNode = null
    }
  }
  const document = {
    body,
    createElement(): PreeditNode {
      return {
        attrs: {},
        textContent: '',
        style: {},
        parentNode: null,
        setAttribute(name: string, value: string) {
          this.attrs[name] = value
        }
      }
    },
    querySelector(sel: string) {
      if (sel !== `[${PREEDIT_ATTR}]`) return null
      return nodes.find((node) => Object.prototype.hasOwnProperty.call(node.attrs, PREEDIT_ATTR)) ?? null
    }
  }
  const canvas = {
    getBoundingClientRect() {
      return { left: 12, top: 20, width: 80, height: 40 }
    }
  }
  return { document, canvas, nodes }
}

describe('syncGhosttyPreedit', () => {
  it('draws Hangul preedit over the canvas and removes it when the text is cleared', () => {
    const { document, canvas, nodes } = fakeDom()
    const drawn = syncGhosttyPreedit(document, canvas, '한')
    expect(drawn?.textContent).toBe('한')
    expect(drawn?.attrs[PREEDIT_ATTR]).toBe('')
    expect(drawn?.style.position).toBe('fixed')
    expect(drawn?.style.left).toBe('12px')
    expect(drawn?.style.top).toBe('20px')
    expect(nodes).toHaveLength(1)
    syncGhosttyPreedit(document, canvas, '하')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe('하')
    expect(syncGhosttyPreedit(document, canvas, '')).toBeNull()
    expect(nodes).toHaveLength(0)
  })
})
