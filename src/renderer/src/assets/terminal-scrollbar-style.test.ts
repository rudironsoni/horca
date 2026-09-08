import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')
const mainCss = fs.readFileSync(new URL('./main.css', import.meta.url), 'utf8')

describe('terminal scrollbar styling', () => {
  it('reuses the canonical editor scrollbar with a transparent gutter', () => {
    expect(mainCss).toMatch(
      /\.scrollbar-editor,\s*\.orca-terminal-canvas \.orca-terminal-viewport,\s*\.orca-terminal-canvas\s*{[^}]*scrollbar-color:\s*rgba\(121, 121, 121, 0\.4\) transparent/s
    )
    expect(mainCss).toMatch(
      /\.scrollbar-editor::-webkit-scrollbar-track,\s*\.orca-terminal-canvas \.orca-terminal-viewport::-webkit-scrollbar-track\s*{[^}]*background:\s*transparent/s
    )
    expect(terminalCss).not.toContain('--orca-terminal-scrollbar-thumb')
  })
})
