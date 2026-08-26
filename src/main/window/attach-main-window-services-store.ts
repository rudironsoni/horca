import { vi } from 'vitest'
import type { Store } from '../persistence'

export function createAttachMainWindowServicesStore(): Store & {
  flushPendingAsync: ReturnType<typeof vi.fn>
} {
  return {
    getProfileStorageDirectory: vi.fn(() => '/profile-a'),
    getSettings: vi.fn(() => ({})),
    getRepos: vi.fn(() => []),
    flushPendingAsync: vi.fn(() => Promise.resolve())
  } as unknown as Store & { flushPendingAsync: ReturnType<typeof vi.fn> }
}
