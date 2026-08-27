type LegacyWorkerRendererRecoveryOptions = {
  firstWindowStartupServicesReady: Promise<void>
  managedWslCliStartupBarrierReady: Promise<void>
  localPtyProviderStartupReady: Promise<void>
  reconcile: () => Promise<unknown> | undefined
  onDeferredRecoveryError: (error: unknown) => void
}

export async function recoverLegacyWorkerTerminalsForRendererStartup(
  options: LegacyWorkerRendererRecoveryOptions
): Promise<void> {
  const providerStartupResult = options.localPtyProviderStartupReady.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error })
  )
  await Promise.all([
    options.firstWindowStartupServicesReady,
    options.managedWslCliStartupBarrierReady
  ])
  // Why: a ready provider schedules deferred reconcile as a microtask that
  // would overlap the initial pass.
  const initialRecovery = (async () => {
    try {
      await options.reconcile()
    } catch (error) {
      options.onDeferredRecoveryError(error)
    }
  })()
  void providerStartupResult
    .then(async (result) => {
      await initialRecovery
      if (!result.ok) {
        throw result.error
      }
      await options.reconcile()
    })
    .catch(options.onDeferredRecoveryError)
  await initialRecovery
}
