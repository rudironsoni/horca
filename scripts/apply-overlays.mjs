import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..')
const MANIFEST_FILE = process.env.HORCA_OVERLAY_MANIFEST
  ? resolve(process.env.HORCA_OVERLAY_MANIFEST)
  : resolve(ROOT, 'overlay', 'manifest.json')

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function applySubstitute(worktreePath, override) {
  const { target, find, replace, precondition, postcondition } = override
  if (typeof find !== 'string' || typeof replace !== 'string') {
    throw new Error(`Substitute overlay requires string find/replace: ${target}`)
  }

  const targetPath = resolve(worktreePath, target)
  if (!existsSync(targetPath)) {
    throw new Error(`HORCA_OVERLAY_PRECONDITION_FAILED: target missing: ${target}`)
  }
  const before = readFileSync(targetPath, 'utf8')

  // Precondition: the find sentinel must occur exactly the declared number of times.
  const expected = precondition?.occursExactly ?? 1
  const found = countOccurrences(before, find)
  if (found !== expected) {
    if (found === 0 && countOccurrences(before, replace) === expected) {
      throw new Error(
        `HORCA_OVERLAY_ALREADY_APPLIED: ${target} (replace sentinel present, find sentinel absent)`
      )
    }
    throw new Error(
      `HORCA_OVERLAY_PRECONDITION_FAILED: ${target} find sentinel occurred ${found} times, expected ${expected}`
    )
  }

  const after = before.split(find).join(replace)
  writeFileSync(targetPath, after)

  // Postcondition: verify the deterministic result.
  if (postcondition?.mustOccurExactlyOnce !== undefined) {
    const n = countOccurrences(after, postcondition.mustOccurExactlyOnce)
    if (n !== 1) {
      throw new Error(
        `HORCA_OVERLAY_POSTCONDITION_FAILED: ${target} replace sentinel occurred ${n} times, expected 1`
      )
    }
  }
  if (postcondition?.mustNotOccur !== undefined) {
    const n = countOccurrences(after, postcondition.mustNotOccur)
    if (n !== 0) {
      throw new Error(
        `HORCA_OVERLAY_POSTCONDITION_FAILED: ${target} find sentinel still present ${n} times`
      )
    }
  }
  if (postcondition?.resultingBlobSha256 !== undefined) {
    const digest = sha256(after)
    if (digest !== postcondition.resultingBlobSha256) {
      throw new Error(
        `HORCA_OVERLAY_POSTCONDITION_FAILED: ${target} resulting blob sha256 ${digest} != declared ${postcondition.resultingBlobSha256}`
      )
    }
  }

  console.log(`[apply-overlays] Substituted in ${target} (sha256 ${sha256(after).slice(0, 12)})`)
}

function main(worktreePath) {
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
  const { overrides = [] } = manifest

  if (overrides.length === 0) {
    console.log('[apply-overlays] No overlays declared; skipping')
    return
  }

  for (const override of overrides) {
    const { target, mode } = override
    if (!target) throw new Error('Overlay missing target')

    const targetPath = resolve(worktreePath, target)
    const targetDir = targetPath.substring(0, targetPath.lastIndexOf('/'))
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

    switch (mode) {
      case 'substitute':
        applySubstitute(worktreePath, override)
        break
      case 'replace': {
        if (!override.source) throw new Error(`Replace overlay missing source: ${target}`)
        const sourcePath = resolve(ROOT, override.source)
        if (!existsSync(sourcePath)) throw new Error(`Overlay source not found: ${sourcePath}`)
        const expected = override.precondition?.expectedBlobSha256
        const resulting = override.postcondition?.resultingBlobSha256
        const replacementHash = sha256File(sourcePath)
        if (existsSync(targetPath)) {
          const currentHash = sha256File(targetPath)
          if (currentHash === replacementHash) {
            if (!expected || currentHash === expected) {
              console.log(`[apply-overlays] Replace skipped ${target} (already desired blob)`)
              break
            }
            throw new Error(
              `HORCA_OVERLAY_ALREADY_APPLIED: ${target} (target already equals replacement blob)`
            )
          }
          if (expected && currentHash !== expected) {
            throw new Error(
              `HORCA_OVERLAY_PRECONDITION_FAILED: ${target} current blob sha256 ${currentHash} != expected ${expected}`
            )
          }
        } else if (expected) {
          throw new Error(`HORCA_OVERLAY_PRECONDITION_FAILED: target missing: ${target}`)
        }
        cpSync(sourcePath, targetPath)
        if (resulting && replacementHash !== resulting) {
          throw new Error(
            `HORCA_OVERLAY_POSTCONDITION_FAILED: ${target} replacement blob sha256 ${replacementHash} != declared ${resulting}`
          )
        }
        console.log(`[apply-overlays] Replaced ${target} (sha256 ${replacementHash.slice(0, 12)})`)
        break
      }
      case 'add': {
        if (!override.source) throw new Error(`Add overlay missing source: ${target}`)
        if (override.precondition?.kind === 'file-absent' && existsSync(targetPath)) {
          throw new Error(
            `HORCA_OVERLAY_ALREADY_APPLIED: ${target} (add target already exists; refusing silent overwrite)`
          )
        }
        const sourcePath = resolve(ROOT, override.source)
        if (!existsSync(sourcePath)) throw new Error(`Overlay source not found: ${sourcePath}`)
        cpSync(sourcePath, targetPath)
        console.log(`[apply-overlays] Added ${target}`)
        break
      }
      default:
        throw new Error(`Unknown overlay mode: ${mode}`)
    }
  }

  console.log('[apply-overlays] All overlays applied')
}

main(process.argv[2])
