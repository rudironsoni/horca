#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const HORCA_COMMIT_AUTHOR_NAME = 'Rudimar Ronsoni'
export const HORCA_COMMIT_AUTHOR_EMAIL = 'rudimar@outlook.com'
export const HORCA_COAUTHOR_TRAILER =
  'Co-authored-by: Horca Maintenance <horca-maintenance@users.noreply.github.com>'

function git(args, { cwd, input, extraEnv } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout
}

export function hasHorcaCoauthorTrailer(message, trailer = HORCA_COAUTHOR_TRAILER) {
  return message.replace(/\r\n/g, '\n').split('\n').includes(trailer)
}

export function ensureHorcaCoauthorTrailer(message, trailer = HORCA_COAUTHOR_TRAILER) {
  const unix = message.replace(/\r\n/g, '\n')
  if (hasHorcaCoauthorTrailer(unix, trailer)) {
    return unix.endsWith('\n') ? unix : `${unix}\n`
  }
  return git(['interpret-trailers', '--if-exists', 'addIfDifferent', '--trailer', trailer], {
    input: unix.endsWith('\n') ? unix : `${unix}\n`
  })
}

function commitIdentity(cwd) {
  const [authorName, authorEmail, committerName, committerEmail, message] = git(
    ['log', '-1', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B'],
    { cwd }
  ).split('\0')
  return { authorName, authorEmail, committerName, committerEmail, message }
}

export function horcaCommitNeedsRewrite(identity) {
  return (
    identity.authorName !== HORCA_COMMIT_AUTHOR_NAME ||
    identity.authorEmail !== HORCA_COMMIT_AUTHOR_EMAIL ||
    identity.committerName !== HORCA_COMMIT_AUTHOR_NAME ||
    identity.committerEmail !== HORCA_COMMIT_AUTHOR_EMAIL ||
    !hasHorcaCoauthorTrailer(identity.message)
  )
}

export function rewriteHeadHorcaCommitIdentity(cwd = process.cwd()) {
  const identity = commitIdentity(cwd)
  if (!horcaCommitNeedsRewrite(identity)) {
    return false
  }
  const authorDate = git(['log', '-1', '--format=%aD'], { cwd }).trim()
  const message = ensureHorcaCoauthorTrailer(identity.message)
  const directory = mkdtempSync(join(tmpdir(), 'horca-commit-identity-'))
  const messageFile = join(directory, 'COMMIT_EDITMSG')
  writeFileSync(messageFile, message)
  try {
    git(
      [
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--amend',
        '--no-verify',
        `--author=${HORCA_COMMIT_AUTHOR_NAME} <${HORCA_COMMIT_AUTHOR_EMAIL}>`,
        '-F',
        messageFile
      ],
      {
        cwd,
        extraEnv: {
          GIT_AUTHOR_DATE: authorDate,
          GIT_COMMITTER_NAME: HORCA_COMMIT_AUTHOR_NAME,
          GIT_COMMITTER_EMAIL: HORCA_COMMIT_AUTHOR_EMAIL,
          GIT_EDITOR: 'true'
        }
      }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  return true
}

const invokedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  rewriteHeadHorcaCommitIdentity()
}
