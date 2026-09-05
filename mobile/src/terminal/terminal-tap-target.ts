import { resolveTerminalFileUrlTap } from './terminal-file-url-tap'
import { matchFilePathAtColumn, type TappedFilePath } from './terminal-path-tap'

const URL_PATTERN = /\b(?:https?|file):\/\/[^\s"'<>]+/gi

export type TerminalTapTarget =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: TappedFilePath }

export function resolveTerminalTapTarget(
  lineText: string,
  column: number
): TerminalTapTarget | null {
  for (const match of lineText.matchAll(URL_PATTERN)) {
    const text = trimUrlPunctuation(match[0])
    const start = match.index
    if (column < start || column >= start + text.length) {
      continue
    }
    if (text.startsWith('file://')) {
      const file = resolveTerminalFileUrlTap(text)
      return file ? { kind: 'file', file } : null
    }
    return text.length <= 2048 ? { kind: 'url', url: text } : null
  }
  const file = matchFilePathAtColumn(lineText, column)
  return file ? { kind: 'file', file } : null
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, '')
}
