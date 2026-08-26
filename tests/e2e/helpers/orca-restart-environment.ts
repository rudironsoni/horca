export function restartSafeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[0].toUpperCase() !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined
    )
  )
}
