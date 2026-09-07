#!/usr/bin/env node
/**
 * Decomposes cross-terminal pipeline results: feeds the same fixtures from
 * terminal-pipeline-bench through HeadlessEmulator (libghostty-vt) — no IPC,
 * no rendering — to locate where throughput is lost.
 *
 * Usage:
 *   node tests/tools/benchmarks/terminal-headless-parse-bench.mjs
 *     [--size-mb 10] [--cols 114] [--rows 85] [--scrollback 5000]
 */
import { performance } from 'node:perf_hooks'
import { HeadlessEmulator } from '../../../src/main/daemon/headless-emulator.ts'
import { buildFixture } from './terminal-pipeline-bench.mjs'
const CHUNK = 64 * 1024

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

const sizeMb = arg('--size-mb', 10)
const cols = arg('--cols', 114)
const rows = arg('--rows', 85)
const scrollback = arg('--scrollback', 5000)
const targetBytes = Math.floor(sizeMb * 1024 * 1024)

async function writeAll(term, data) {
  let offset = 0
  while (offset < data.length) {
    const chunk = data.slice(offset, offset + CHUNK)
    offset += CHUNK
    await term.write(chunk)
  }
}

const FIXTURES = ['ascii-log', 'cjk-emoji', 'agent-tui', 'styles-stress']

console.log(
  `headless ghostty-vt ${cols}x${rows} scrollback=${scrollback}, ${sizeMb}MB per fixture (parse-only, no render)`
)
for (const name of FIXTURES) {
  const fixture = buildFixture(name, targetBytes, cols, rows)
  const bytes = Buffer.byteLength(fixture, 'utf8')
  const term = new HeadlessEmulator({ cols, rows, scrollback })
  await writeAll(term, fixture.slice(0, 256 * 1024))
  const start = performance.now()
  await writeAll(term, fixture)
  const ms = performance.now() - start
  console.log(
    `${name.padEnd(15)} ${(bytes / 1024 / 1024 / (ms / 1000)).toFixed(1).padStart(7)} MB/s  (${ms.toFixed(0)}ms)`
  )
  term.dispose()
}
