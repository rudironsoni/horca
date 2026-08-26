/**
 * Horca wrap for electron-vite, same idea as electron-builder-downstream.cjs.
 *
 * electron.vite.config.ts keeps the upstream ternary
 * (`ORCA_DOWNSTREAM_BUILD === '1' ? 'horca' : 'official'`). This module
 * fills the flag when it is unset so `pnpm build` / `pnpm dev` compile
 * ~/.horca without inverting that ternary. Explicit `=0` stays official.
 */
export function applyHorcaViteDistributionEnv(env: NodeJS.ProcessEnv): void {
  if (env.ORCA_DOWNSTREAM_BUILD === undefined) {
    env.ORCA_DOWNSTREAM_BUILD = '1'
  }
}
