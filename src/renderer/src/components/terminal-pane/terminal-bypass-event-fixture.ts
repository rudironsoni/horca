import type { TerminalBypassEvent } from './terminal-bypass-policy'

// Shared test fixture: builds a fully-defaulted TerminalBypassEvent so the bypass
// and IME candidate-guard suites all stay in sync when the event shape changes.
export function event(overrides: Partial<TerminalBypassEvent>): TerminalBypassEvent {
  return {
    type: 'keydown',
    key: '',
    code: '',
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }
}
