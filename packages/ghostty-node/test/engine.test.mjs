import test from 'node:test'
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const addon = require('../build/Release/ghostty_node.node')

test('createTerminal, feed, resize, snapshot, replies', () => {
  const replies = []
  const t = addon.createTerminal({
    cols: 80,
    rows: 24,
    onReply: (d) => replies.push(d.toString())
  })

  t.feed(Buffer.from('hello\n\u001b[31mred\u001b[0m world'))
  t.feed(Buffer.from('\u001b[6n'))

  const s = t.snapshot()
  assert.strictEqual(s.cols, 80)
  assert.strictEqual(s.rows, 24)
  assert.deepStrictEqual(s.cursor, { x: 14, y: 1 })
  assert.strictEqual(s.alternateScreen, false)
  assert.ok(s.vt.includes('red'))

  assert.strictEqual(replies.length, 1)
  const d = replies[0]
  assert.ok(d.startsWith('\u001b[') && d.endsWith('R'))

  t.resize(100, 30)
  const s2 = t.snapshot()
  assert.strictEqual(s2.cols, 100)
  assert.strictEqual(s2.rows, 30)

  t.dispose()
})

test('dispose is idempotent and frees the terminal', () => {
  const t = addon.createTerminal({ cols: 10, rows: 4 })
  t.dispose()
  t.dispose()
})
