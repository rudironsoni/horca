import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE_DIR = resolve(ROOT, '.cache', 'upstream.git')
const LOCK_FILE = resolve(ROOT, 'upstream.lock.json')

function main() {
  const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
  const { repository, commit } = lock

  if (!commit || commit.length !== 40) {
    throw new Error(`Invalid commit in upstream.lock.json: ${commit}`)
  }

  // Initialize or update the bare mirror cache
  if (!existsSync(CACHE_DIR)) {
    console.log(`[fetch-upstream] Cloning bare mirror to ${CACHE_DIR}`)
    execSync(`git clone --mirror ${repository} ${CACHE_DIR}`, { stdio: 'inherit' })
  } else {
    console.log(`[fetch-upstream] Fetching updates in ${CACHE_DIR}`)
    execSync(`git fetch --prune origin`, { cwd: CACHE_DIR, stdio: 'inherit' })
  }

  // Verify the locked commit exists
  try {
    execSync(`git cat-file -e ${commit}^{commit}`, { cwd: CACHE_DIR, stdio: 'pipe' })
  } catch {
    throw new Error(`Locked commit ${commit} not found in upstream cache`)
  }

  console.log(`[fetch-upstream] Verified commit ${commit} exists in cache`)
}

main()
