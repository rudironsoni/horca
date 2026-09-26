import { tailLines } from './helpers.mjs'

// Chord start is classified from the chord terminal's own read.
// A visible chordprobe command without CHORD_READY is not "did not start".
// Paste markers are not consulted.

export function chordLaunchState(text) {
  const rows = tailLines(text)
  const blob = rows.join('\n')
  if (blob.includes('CHORD_READY')) {
    return 'ready'
  }
  if (/can't open|No such file|command not found|Permission denied|\bpython3:/i.test(blob)) {
    return 'python3-open-failed'
  }
  const last = [...rows].reverse().find((line) => line.trim()) || ''
  if (last.includes('chordprobe')) {
    return 'unsubmitted'
  }
  return 'absent'
}

export function classifyChordStart(text) {
  const body = String(text ?? '')
  const commandObserved = body.includes('chordprobe')
  const chordReady = body.includes('CHORD_READY')
  if (chordReady) {
    return { commandObserved, chordReady: true, marker: 'CHORD_READY' }
  }
  if (commandObserved) {
    return {
      commandObserved: true,
      chordReady: false,
      marker: 'chord command observed, CHORD_READY absent'
    }
  }
  return {
    commandObserved: false,
    chordReady: false,
    marker: 'chord command not observed, CHORD_READY absent'
  }
}
