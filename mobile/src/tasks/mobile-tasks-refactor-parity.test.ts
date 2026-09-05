import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readFlattenedMobileTasksHookSignatures,
  readMobileTasksSemanticSource,
  readMobileTasksStyleSource
} from './mobile-tasks-source-family.test-support'
import { readFlattenedMobileTasksRenderTokens } from './mobile-tasks-render-parity.test-support'
import {
  readFlattenedMobileTasksCoreStatements,
  readMobileTasksDeclarationSignatures
} from './mobile-tasks-execution-parity.test-support'

const hash = (parts: string[] | string): string =>
  createHash('sha256')
    .update(Array.isArray(parts) ? parts.join('\n') : parts)
    .digest('hex')

const PRE_REFACTOR_SCREEN_HOOKS = '23121cda2fe6d6fc76fce985dc12cf4743c10b93d561ec355575b75a1fa119c8'
const PRE_REFACTOR_DIFF_HOOKS = '93c7189b32bed8456cc51814fffa8ce80cf62011ef968a9d53ddec2b9686f58f'
const PRE_REFACTOR_STATEMENTS = '277edfa73889fa056aa1196dad54422083e2d93ae4a946d6e81957556fa37263'
const PRE_REFACTOR_DECLARATIONS = 'cff54172af17a877789be1479c2eb6ca97d83c3e31dd831cd59395962f2b4c4a'
const PRE_REFACTOR_SEMANTICS = '4be55238e088714f7cfd553b7191c70ac1a4353494f94bfac2d99f6c4425d826'
const PRE_REFACTOR_STYLES = '1db6af69c791d9963928541ad5310942fcbda6d984b422c90b6eb92b6816579a'
const PRE_REFACTOR_RENDER_TREE = '4314337b247e4fe86ce82636fe5d157a28013be00458b332043d31fcd26ce578'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(350)
    expect(hash(screenHooks)).toBe(PRE_REFACTOR_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(3)
    expect(hash(diffHooks)).toBe(PRE_REFACTOR_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(417)
    expect(hash(statements)).toBe(PRE_REFACTOR_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(193)
    expect(hash(declarations)).toBe(PRE_REFACTOR_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(3_499)
    expect(hash(semantics)).toBe(PRE_REFACTOR_SEMANTICS)
  })

  it('preserves render expressions and event handlers in tree order', () => {
    const tokens = readFlattenedMobileTasksRenderTokens()
    expect(tokens).toHaveLength(35_195)
    expect(hash(tokens)).toBe(PRE_REFACTOR_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(PRE_REFACTOR_STYLES)
  })
})
