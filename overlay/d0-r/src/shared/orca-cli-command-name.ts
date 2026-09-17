import { HORCA_CLI_COMMAND_NAME } from './horca/horca-product-copy'

export function getOrcaCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `${HORCA_CLI_COMMAND_NAME}.cmd`
  }
  return HORCA_CLI_COMMAND_NAME
}
