import { describe, expect, it, vi } from 'vitest'
import { bindGhosttyKeyboardInput } from './orca-pane-terminal-io'

function fakeElement(): {
  element: HTMLElement
  dispatch: (type: string, event: KeyboardEvent) => void
} {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>()
  const element = {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      listeners.get(type)?.delete(listener)
    }
  } as unknown as HTMLElement
  return {
    element,
    dispatch: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    }
  }
}

describe('bindGhosttyKeyboardInput', () => {
  it('encodes and sends a key when the Orca policy handler returns true', () => {
    const { element, dispatch } = fakeElement()
    const input = vi.fn()
    const encodeKey = vi.fn(() => 'a')
    const unbind = bindGhosttyKeyboardInput({
      element,
      encodeKey,
      input,
      customKeyHandler: () => () => true
    })
    dispatch('keydown', { key: 'a', preventDefault: () => undefined } as KeyboardEvent)
    expect(encodeKey).toHaveBeenCalled()
    expect(input).toHaveBeenCalledWith('a')
    unbind()
  })

  it('does not encode when the Orca policy handler returns false', () => {
    const { element, dispatch } = fakeElement()
    const input = vi.fn()
    const encodeKey = vi.fn(() => 'a')
    bindGhosttyKeyboardInput({
      element,
      encodeKey,
      input,
      customKeyHandler: () => () => false
    })
    dispatch('keydown', { key: 'a', preventDefault: () => undefined } as KeyboardEvent)
    expect(encodeKey).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
  })
})
