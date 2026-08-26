import { createRequire } from 'node:module'

const { applyHorcaViteDistributionEnv: apply, HORCA_DEV_USER_DATA_DIR: dir } = createRequire(
  import.meta.url
)('./horca-vite-distribution.cjs') as {
  applyHorcaViteDistributionEnv: (env: NodeJS.ProcessEnv) => void
  HORCA_DEV_USER_DATA_DIR: string
}

export const HORCA_DEV_USER_DATA_DIR = dir

/**
 * Horca wrap for electron-vite, same idea as electron-builder-downstream.cjs.
 *
 * electron.vite.config.ts keeps the upstream ternary
 * (`ORCA_DOWNSTREAM_BUILD === '1' ? 'horca' : 'official'`). This module
 * fills the flag when it is unset so `pnpm build` / `pnpm dev` compile
 * ~/.horca without inverting that ternary. Explicit `=0` stays official.
 *
 * Dev userData follows the same wrap: upstream still hardcodes `orca-dev`
 * under appData. When this fork compiles Horca, an unset
 * ORCA_DEV_USER_DATA_PATH becomes ~/.horca-dev so the Electron profile does
 * not land in Application Support/orca-dev.
 */
export function applyHorcaViteDistributionEnv(env: NodeJS.ProcessEnv): void {
  apply(env)
}
