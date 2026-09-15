function coreStoreIsDisposed(terminal: object): boolean {
  if (!('_core' in terminal)) {
    return false
  }
  const core = terminal._core
  if (typeof core !== 'object' || core === null || !('_store' in core)) {
    return false
  }
  const store = core._store
  if (typeof store !== 'object' || store === null || !('_isDisposed' in store)) {
    return false
  }
  return store._isDisposed === true
}

export function isTerminalInstanceDisposed(terminal: unknown): boolean {
  if (typeof terminal !== 'object' || terminal === null) {
    return false
  }
  if ('isDisposed' in terminal) {
    return terminal.isDisposed === true
  }
  return coreStoreIsDisposed(terminal)
}
