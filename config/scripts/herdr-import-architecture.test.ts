import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '../..')
const srcRoot = join(repoRoot, 'src')

const ALLOWED_PREFIXES = [
  `src${sep}main${sep}providers${sep}multiplexer${sep}herdr${sep}`,
  `src${sep}main${sep}providers${sep}terminal-backend-composition.ts`
]

const HERDR_FACTORY_IMPORT = /providers\/multiplexer\/herdr/

function isAllowed(relativePath: string): boolean {
  if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx')) {
    return true
  }
  if (relativePath.endsWith(`${sep}ssh-ipc-module-mocks.ts`)) {
    return true
  }
  return ALLOWED_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(prefix)
  )
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      walk(absolute, files)
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(absolute)
    }
  }
}

describe('Herdr import architecture', () => {
  it('keeps production Herdr factory imports in the composition root', () => {
    const files: string[] = []
    walk(srcRoot, files)
    const violations: string[] = []
    for (const absolute of files) {
      const relativePath = relative(repoRoot, absolute)
      if (isAllowed(relativePath)) {
        continue
      }
      const source = readFileSync(absolute, 'utf8')
      if (HERDR_FACTORY_IMPORT.test(source)) {
        violations.push(relativePath)
      }
    }
    expect(violations).toEqual([])
  })
})
