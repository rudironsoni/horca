import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  dispatchInput,
  dispatchKey,
  nextEventLoop,
  type IosHangulRig
} from './terminal-ios-hangul-preedit-fixture'

export type IosDeviceTraceEvent = {
  type: 'keydown' | 'input'
  key: string
  keyCode: number | null
  inputType: string | null
  data: string
  value: string
}

export type IosDeviceTrace = {
  source: string
  userAgent: string
  maxTouchPoints: number
  typed: string
  expected: string
  observedSent: string[]
  events: IosDeviceTraceEvent[]
}

export function loadIosDeviceTrace(fileName: string): IosDeviceTrace {
  const path = resolve(
    process.cwd(),
    'src/renderer/src/components/terminal-pane/__fixtures__',
    fileName
  )
  return JSON.parse(readFileSync(path, 'utf8')) as IosDeviceTrace
}

export type FieldDrift = { index: number; recorded: string; actual: string }

export async function replayIosDeviceTrace(
  rig: IosHangulRig,
  trace: IosDeviceTrace
): Promise<FieldDrift[]> {
  const drift: FieldDrift[] = []
  for (const [index, event] of trace.events.entries()) {
    if (event.type === 'keydown') {
      if (rig.textarea.value !== event.value) {
        drift.push({ index, recorded: event.value, actual: rig.textarea.value })
      }
      dispatchKey(rig, 'keydown', { key: event.key, keyCode: event.keyCode ?? 0 })
    } else {
      rig.textarea.value = event.value
      dispatchInput(rig, event.inputType ?? 'insertText', event.data || null)
    }
    await nextEventLoop()
  }
  return drift
}

export type DeviceTraceKeystroke = {
  key: string
  keyCode: number
  written: string
  replaces: boolean
  shiftKey: boolean
}

export function deviceTraceKeystrokes(trace: IosDeviceTrace): DeviceTraceKeystroke[] {
  const steps: DeviceTraceKeystroke[] = []
  let shiftKey = false
  for (const event of trace.events) {
    if (event.type === 'keydown') {
      if (event.key === 'Shift') {
        shiftKey = true
        continue
      }
      steps.push({
        key: event.key,
        keyCode: event.keyCode ?? 0,
        written: '',
        replaces: false,
        shiftKey
      })
      shiftKey = false
      continue
    }
    const step = steps.at(-1)
    if (!step) {
      throw new Error('trace opens with an input event, which no keystroke owns')
    }
    if (event.inputType?.startsWith('delete')) {
      step.replaces = true
    } else {
      step.written = event.data
    }
  }
  return steps
}
