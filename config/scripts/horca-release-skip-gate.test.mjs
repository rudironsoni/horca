import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = join(import.meta.dirname, 'horca-release-skip-gate.sh')

function decide({ eventName, commitMessage = '', channel = 'stable' }) {
  const output = join(mkdtempSync(join(tmpdir(), 'horca-skip-gate-')), 'github-output')
  execFileSync('bash', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EVENT_NAME: eventName,
      COMMIT_MESSAGE: commitMessage,
      HORCA_CHANNEL: channel,
      GITHUB_OUTPUT: output
    }
  })
  const match = readFileSync(output, 'utf8').match(/^run=(.*)$/m)
  return match?.[1]
}

describe('horca-release-skip-gate', () => {
  it('runs on dispatch even when the subject has a skip token', () => {
    expect(
      decide({
        eventName: 'workflow_dispatch',
        commitMessage: '[skip horca-beta] manual dispatch',
        channel: 'beta'
      })
    ).toBe('true')
  })

  it('runs on workflow_call even when the subject has a skip token', () => {
    expect(
      decide({
        eventName: 'workflow_call',
        commitMessage: '[skip horca-release] called from check-source'
      })
    ).toBe('true')
  })

  it('skips a push whose subject contains the token', () => {
    expect(
      decide({
        eventName: 'push',
        commitMessage: 'fix tap style [skip horca-beta]\n\nBody without skip.',
        channel: 'beta'
      })
    ).toBe('false')
    expect(
      decide({
        eventName: 'push',
        commitMessage: 'chore: tap only [skip horca-release]\n\nStill skip beta.'
      })
    ).toBe('false')
  })

  it('runs a push whose skip token is only in the body', () => {
    expect(
      decide({
        eventName: 'push',
        commitMessage:
          'fix(horca): register the tap checkout before brew style/audit (#74)\n\n[skip horca-beta]',
        channel: 'beta'
      })
    ).toBe('true')
  })

  it('ignores [skip horca-beta] on the stable channel', () => {
    expect(
      decide({
        eventName: 'push',
        commitMessage: 'feat: ship [skip horca-beta]\n\nstable still releases'
      })
    ).toBe('true')
  })

  it('skips beta when the subject has [skip horca-release]', () => {
    expect(
      decide({
        eventName: 'push',
        commitMessage: 'docs: tap notes [skip horca-release]\n\n[skip horca-beta] in body is extra',
        channel: 'beta'
      })
    ).toBe('false')
  })
})
