import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export function deletedPathsFromPatch(text) {
  const paths = []
  for (const block of text.split(/(?=^diff --git )/m)) {
    const match = block.match(/^diff --git a\/(.+) b\/.+$/m)
    if (!match) {
      continue
    }
    const hunk = block.indexOf('\n@@')
    const header = hunk === -1 ? block : block.slice(0, hunk)
    if (!/^deleted file mode /m.test(header)) {
      continue
    }
    paths.push(match[1])
  }
  return paths
}

export function removeLegacyWebviewTerminalFiles(terminalRoot) {
  if (!existsSync(terminalRoot)) {
    return []
  }
  const removed = []
  for (const entry of readdirSync(terminalRoot, { withFileTypes: true })) {
    const path = join(terminalRoot, entry.name)
    if (/webview/i.test(entry.name)) {
      rmSync(path, { recursive: true, force: true })
      removed.push(path)
      continue
    }
    if (entry.isDirectory()) {
      removed.push(...removeLegacyWebviewTerminalFiles(path))
    }
  }
  return removed
}
