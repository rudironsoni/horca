#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function runnerHref() {
  const beside = fileURLToPath(new URL('./packaged-smoke/runner.mjs', import.meta.url))
  if (existsSync(beside)) {
    return pathToFileURL(beside).href
  }
  const fromCwd = join(process.cwd(), 'config/horca/packaged-smoke/runner.mjs')
  if (existsSync(fromCwd)) {
    return pathToFileURL(fromCwd).href
  }
  throw new Error(`Packaged smoke runner is not next to the script or in ${fromCwd}`)
}

const { runPackagedSmoke } = await import(runnerHref())
await runPackagedSmoke({
  executablePath: process.argv[2],
  only: process.env.HORCA_SMOKE_PROBE || ''
})
