import { camelCase } from 'change-case'

/** Gate B2 probe only. Disposable. Not a production module. */
export const GATE_B2_PROBE_ID = 'gate-b2-probe'
export const GATE_B2_PROBE_DEPENDENCY = 'change-case@5.4.4'

// Computed at module evaluation, so the dependency must actually execute.
export const GATE_B2_PROBE_TITLE = `Horca Gate B2 ${camelCase('probe title')}`

export function gateB2ProbeTitle(): string {
  return GATE_B2_PROBE_TITLE
}
