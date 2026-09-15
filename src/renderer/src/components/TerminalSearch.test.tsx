/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchState } from '@/components/terminal-pane/keyboard-handlers'
import type { PaneSearchController } from '@/lib/pane-manager/pane-manager-types'
import TerminalSearch from './TerminalSearch'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

describe('TerminalSearch unmount', () => {
  it('contains GhosttyTerminal is not bound from findNext cleanup', () => {
    const findNext = vi.fn(() => {
      throw new Error('GhosttyTerminal is not bound')
    })
    const searchController: PaneSearchController = {
      findNext,
      findPrevious: vi.fn(() => false),
      clearDecorations: vi.fn(),
      dispose: vi.fn()
    }
    const searchStateRef: { current: SearchState } = {
      current: { query: '', caseSensitive: false, regex: false }
    }

    const { unmount } = render(
      <TerminalSearch
        isOpen={false}
        onClose={vi.fn()}
        searchController={searchController}
        searchStateRef={searchStateRef}
      />
    )

    expect(() => {
      act(() => {
        unmount()
      })
    }).not.toThrow()
    expect(findNext).toHaveBeenCalled()
  })
})
