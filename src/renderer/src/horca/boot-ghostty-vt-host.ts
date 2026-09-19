import { primeGhosttyVtHost } from '../lib/ghostty-vt-web-host'

export async function bootGhosttyVtHostThen(render: () => void): Promise<void> {
  await primeGhosttyVtHost()
  render()
}
