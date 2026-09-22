// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { installMouseHideWhileTyping } from '../../components/terminal-pane/mouse-hide-while-typing'
import { installTerminalLinkPointerGesture } from '../../components/terminal-pane/terminal-link-pointer-gesture'
import { installTerminalLinkPtyMouseSuppression } from '../../components/terminal-pane/terminal-link-pty-mouse-suppression'
import { getTerminalBufferPositionForMouseEvent } from '../../components/terminal-pane/terminal-mouse-buffer-position'
import { shouldFollowMouseFocus } from './focus-follows-mouse'
import { beginPaneDragFromPointerDown } from './pane-drag-pointer'
import { shouldFocusTerminalFromPanePointerDown } from './pane-pointer-focus'
import {
  createTerminalTuiMouseWheelDistanceState,
  isDiscreteTerminalTuiWheelEvent,
  normalizeTerminalTuiMouseWheelMultiplier,
  resolveTerminalTuiMouseWheelReportCount,
  resolveTerminalWheelDirection
} from './pane-terminal-tui-wheel-reports'
import {
  installTerminalLinkifierHoverResetOnMouseLeave,
  installTerminalLinkifierHoverResetOnWindowBlur
} from './terminal-linkifier-hover-reset-on-mouseleave'

describe('ghostty mouse behavior', () => {
  it('maps a click inside the screen to a 1-based buffer cell', () => {
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    screen.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 480, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) })
    const element = document.createElement('div')
    element.appendChild(screen)
    const position = getTerminalBufferPositionForMouseEvent(
      {
        element,
        cols: 80,
        rows: 24,
        buffer: { active: { viewportY: 4 } }
      } as never,
      new MouseEvent('mousedown', { clientX: 15, clientY: 30 })
    )
    expect(position).toEqual({ x: 2, y: 6 })
    expect(getTerminalBufferPositionForMouseEvent(
      { element, cols: 80, rows: 24, buffer: { active: { viewportY: 0 } } } as never,
      new MouseEvent('mousedown', { clientX: 900, clientY: 10 })
    )).toBeNull()
  })

  it('follows the mouse only onto a different idle pane and skips app controls', () => {
    expect(shouldFollowMouseFocus({
      featureEnabled: true,
      activePaneId: 1,
      hoveredPaneId: 2,
      mouseButtons: 0,
      windowHasFocus: true,
      managerDestroyed: false
    })).toBe(true)
    expect(shouldFollowMouseFocus({
      featureEnabled: true,
      activePaneId: 1,
      hoveredPaneId: 2,
      mouseButtons: 1,
      windowHasFocus: true,
      managerDestroyed: false
    })).toBe(false)
    const button = document.createElement('button')
    const helper = document.createElement('textarea')
    helper.className = 'xterm-helper-textarea'
    expect(shouldFocusTerminalFromPanePointerDown(button)).toBe(false)
    expect(shouldFocusTerminalFromPanePointerDown(helper)).toBe(true)
  })

  it('counts a downward wheel as one report and clamps the multiplier', () => {
    expect(resolveTerminalWheelDirection({ deltaY: 40 })).toBe(1)
    expect(resolveTerminalWheelDirection({ deltaY: -1 })).toBe(-1)
    expect(normalizeTerminalTuiMouseWheelMultiplier(0)).toBe(1)
    expect(normalizeTerminalTuiMouseWheelMultiplier(99)).toBe(10)
    expect(isDiscreteTerminalTuiWheelEvent({ deltaY: 3, deltaMode: 1 })).toBe(true)
    const count = resolveTerminalTuiMouseWheelReportCount(
      { deltaY: 16, deltaMode: 1 },
      1,
      createTerminalTuiMouseWheelDistanceState(),
      { cellHeight: 16, rows: 24 }
    )
    expect(count).toBeGreaterThan(0)
  })

  it('hides the pointer while typing and shows it again on move', () => {
    const container = document.createElement('div')
    let onData: (() => void) | undefined
    const hide = installMouseHideWhileTyping({
      onData: (callback) => {
        onData = callback
        return { dispose: () => undefined }
      }
    }, container)
    onData?.()
    expect(container.style.cursor).toBe('none')
    container.dispatchEvent(new MouseEvent('mousemove'))
    expect(container.style.cursor).toBe('')
    hide.dispose()
  })

  it('allows a link action after a still click and clears hover on mouse leave', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const element = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    element.appendChild(screen)
    document.body.appendChild(element)
    const tooltip = document.createElement('div')
    tooltip.style.display = ''
    const linkifier = { _currentLink: { text: 'https://example.com' }, _lastBufferCell: { x: 1 }, _activeLine: 2 }
    const terminal = {
      element,
      hasSelection: () => false,
      options: { mouseEventsRequireAlt: false },
      _core: { linkifier }
    }
    const gesture = installTerminalLinkPointerGesture(terminal as never)
    element.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 4, clientY: 4 }))
    expect(gesture.canRequestAction(new MouseEvent('mouseup'))).toBe(true)
    gesture.dispose()
    const hover = installTerminalLinkifierHoverResetOnMouseLeave(terminal as never, tooltip)
    screen.dispatchEvent(new MouseEvent('mouseleave'))
    expect(tooltip.style.display).toBe('none')
    expect(linkifier._currentLink).toBeUndefined()
    hover.dispose()
    const blurTooltip = document.createElement('div')
    document.body.appendChild(blurTooltip)
    blurTooltip.style.display = ''
    linkifier._currentLink = { text: 'https://example.com' }
    const blur = installTerminalLinkifierHoverResetOnWindowBlur(terminal as never, blurTooltip)
    window.dispatchEvent(new Event('blur'))
    expect(blurTooltip.style.display).toBe('none')
    blur.dispose()
  })

  it('forces alt for a command-clicked link and still forwards ordinary pty text', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const element = document.createElement('div')
    const terminal = { element, options: { mouseEventsRequireAlt: false } }
    const suppression = installTerminalLinkPtyMouseSuppression(
      terminal as never,
      () => true
    )
    element.dispatchEvent(new MouseEvent('mousedown', { button: 0, metaKey: true, bubbles: true }))
    expect(terminal.options.mouseEventsRequireAlt).toBe(true)
    const forwarded: string[] = []
    suppression.handlePtyInput('é', (data) => {
      forwarded.push(data)
    })
    expect(forwarded).toEqual(['é'])
    expect(suppression.claimAction()).toBe(false)
    suppression.dispose()
  })

  it('does not start a pane drag from one pane or from a ctrl click', () => {
    const handle = document.createElement('div')
    handle.setPointerCapture = () => undefined
    handle.hasPointerCapture = () => false
    const state = { cleanupActiveDrag: null }
    expect(beginPaneDragFromPointerDown(
      handle,
      1,
      state as never,
      { getPanes: () => new Map([[1, {}]]) } as never,
      new PointerEvent('pointerdown', { button: 0, clientX: 1, clientY: 1 })
    )).toBeNull()
    const event = new PointerEvent('pointerdown', { button: 0, ctrlKey: true, clientX: 1, clientY: 1, cancelable: true })
    expect(beginPaneDragFromPointerDown(
      handle,
      1,
      state as never,
      { getPanes: () => new Map([[1, {}], [2, {}]]) } as never,
      event
    )).toBeNull()
    expect(event.defaultPrevented).toBe(false)
  })
})
