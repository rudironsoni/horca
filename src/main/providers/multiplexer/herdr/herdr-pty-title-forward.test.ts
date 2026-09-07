import { Option } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HerdrEvent } from '@herdr/sdk'
import {
  emitHerdrPaneOscTitle,
  readHerdrPaneUpdatedTitle,
  scheduleHerdrPaneTitleProbe,
  stopHerdrPaneTitleProbe
} from './herdr-pty-title-forward'
import type { HerdrPtyBinding } from './herdr-pty-types'
import { testPane } from './herdr-sdk-test-snapshot'

describe('herdr pane OSC title forward', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits OSC 0 when herdr reports a new terminal title', () => {
    const pane = testPane({ id: 'w1:p1' })
    const event = {
      type: 'pane.updated',
      pane: { ...pane, terminalTitle: Option.some('Hidden model side effects') }
    } as HerdrEvent
    expect(readHerdrPaneUpdatedTitle(event)).toEqual({
      paneId: 'w1:p1',
      title: 'Hidden model side effects'
    })
    expect(
      readHerdrPaneUpdatedTitle({
        type: 'pane_updated',
        pane_id: 'w1:p1',
        terminal_title: 'Hidden model side effects'
      } as HerdrEvent)
    ).toEqual({
      paneId: 'w1:p1',
      title: 'Hidden model side effects'
    })

    const emitData = vi.fn()
    const binding = {
      id: 'herdr:pty',
      sessionName: 'orca',
      paneId: 'w1:p1',
      detached: false,
      sequenceChars: 0
    } as HerdrPtyBinding
    emitHerdrPaneOscTitle({
      bindings: new Map([[binding.id, binding]]),
      sessionName: 'orca',
      paneId: 'w1:p1',
      title: 'Hidden model side effects',
      lastTitles: new Map(),
      emitData
    })
    expect(emitData).toHaveBeenCalledWith({
      id: 'herdr:pty',
      data: '\x07\x1b]0;Hidden model side effects\x07',
      syntheticSideEffects: true
    })
  })

  it('coalesces title probes to the last quiet frame', async () => {
    vi.useFakeTimers()
    const emitData = vi.fn()
    const get = vi.fn().mockResolvedValue({ terminalTitle: 'Hidden model side effects' })
    const binding = {
      id: 'herdr:pty',
      sessionName: 'orca',
      paneId: 'w1:p1',
      detached: false,
      sequenceChars: 0,
      transport: {
        sdk: {
          run: (
            _session: string,
            operation: (herdr: {
              panes: { get: typeof get }
              ids: { pane: (id: string) => string }
            }) => unknown
          ) =>
            Promise.resolve(
              operation({
                panes: { get },
                ids: { pane: (id: string) => id }
              })
            )
        }
      }
    } as unknown as HerdrPtyBinding
    scheduleHerdrPaneTitleProbe(binding, emitData)
    scheduleHerdrPaneTitleProbe(binding, emitData)
    expect(get).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(get).toHaveBeenCalledTimes(1)
    scheduleHerdrPaneTitleProbe(binding, emitData)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(get).toHaveBeenCalledTimes(2)
    binding.detached = true
    stopHerdrPaneTitleProbe(binding)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(get).toHaveBeenCalledTimes(2)
  })
})
