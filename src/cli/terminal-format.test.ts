import { describe, expect, it } from 'vitest'
import { formatTerminalFocus, formatTerminalShow } from './terminal-format'

describe('formatTerminalFocus', () => {
  it('distinguishes superseded navigation from a winning focus', () => {
    expect(
      formatTerminalFocus({
        focus: {
          handle: 'term_stale',
          tabId: 'tab-stale',
          worktreeId: 'worktree-1',
          navigated: false
        }
      })
    ).toBe(
      'Focus request for terminal term_stale was superseded or host navigation was skipped (tab tab-stale).'
    )
    expect(
      formatTerminalFocus({
        focus: { handle: 'term_winner', tabId: 'tab-winner', worktreeId: 'worktree-1' }
      })
    ).toBe('Focused terminal term_winner (tab tab-winner).')
  })
})

describe('formatTerminalShow', () => {
  it('prints the explicit terminal backend', () => {
    const output = formatTerminalShow({
      terminal: {
        handle: 'term_herdr',
        ptyId: 'herdr:v1:encoded',
        backend: 'herdr',
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        branch: 'main',
        tabId: 'tab-1',
        leafId: 'leaf-1',
        title: 'Herdr',
        connected: true,
        writable: true,
        lastOutputAt: null,
        preview: '',
        paneRuntimeId: 1,
        rendererGraphEpoch: 1
      }
    })

    expect(output).toContain('backend: herdr')
  })
})
