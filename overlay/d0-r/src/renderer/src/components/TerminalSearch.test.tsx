// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalSearch from './TerminalSearch'
import { createFakePaneTerminal } from '@/lib/pane-manager/fake-pane-terminal'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

afterEach(cleanup)

function createTerminal() {
  return createFakePaneTerminal({
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearSearch: vi.fn()
  })
}

function renderSearch(terminal: ReturnType<typeof createTerminal>): ReturnType<typeof render> {
  return render(
    <TerminalSearch
      isOpen
      onClose={vi.fn()}
      terminal={terminal}
      searchStateRef={{ current: { query: '', caseSensitive: false, regex: false } }}
    />
  )
}

describe('TerminalSearch cleanup', () => {
  it('clears the current terminal when the query is erased', async () => {
    const terminal = createTerminal()
    const view = renderSearch(terminal)

    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    await waitFor(() => expect(terminal.findNext).toHaveBeenCalled())
    vi.mocked(terminal.clearSearch).mockClear()
    vi.mocked(terminal.findNext).mockClear()

    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: '' } })

    await waitFor(() => expect(terminal.clearSearch).toHaveBeenCalledTimes(1))
    expect(terminal.findNext).not.toHaveBeenCalled()
  })

  it('clears the previous terminal when the search moves to another pane', async () => {
    const previous = createTerminal()
    const next = createTerminal()
    const view = renderSearch(previous)

    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    await waitFor(() => expect(previous.findNext).toHaveBeenCalled())
    vi.mocked(previous.clearSearch).mockClear()
    vi.mocked(previous.findNext).mockClear()

    view.rerender(
      <TerminalSearch
        isOpen
        onClose={vi.fn()}
        terminal={next}
        searchStateRef={{ current: { query: '', caseSensitive: false, regex: false } }}
      />
    )

    expect(previous.clearSearch).toHaveBeenCalledTimes(1)
    expect(previous.findNext).not.toHaveBeenCalled()
  })

  it('clears the terminal when the search portal unmounts', async () => {
    const terminal = createTerminal()
    const view = renderSearch(terminal)

    fireEvent.change(view.getByPlaceholderText('Search...'), { target: { value: 'needle' } })
    await waitFor(() => expect(terminal.findNext).toHaveBeenCalled())
    vi.mocked(terminal.clearSearch).mockClear()
    vi.mocked(terminal.findNext).mockClear()

    view.unmount()

    expect(terminal.clearSearch).toHaveBeenCalledTimes(1)
    expect(terminal.findNext).not.toHaveBeenCalled()
  })
})
