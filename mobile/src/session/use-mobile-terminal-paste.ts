import { useCallback, type RefObject } from 'react'
import * as Clipboard from 'expo-clipboard'
import { File as FsFile, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  prepareMobileClipboardImageBase64,
  saveMobileClipboardImageAsTempFile,
  type MobileClipboardImageResizer
} from './mobile-clipboard-image'

const CLIPBOARD_IMAGE_DATA_URL_PREFIX_RE = /^data:image\/[a-z0-9.+-]+;base64,/i

// Why: clipboard images are re-encoded as lossless PNG, so high-res screenshots and
// photos can exceed the upload byte budget; resize the raster down to fit before upload.
// The iOS ImageManipulator loader cannot decode large base64 data URIs, so use a file.
const resizeMobileClipboardImage: MobileClipboardImageResizer = async (source, target) => {
  const base64 = source.replace(CLIPBOARD_IMAGE_DATA_URL_PREFIX_RE, '')
  const file = new FsFile(Paths.cache, `orca-clip-resize-${Date.now()}.png`)
  let context: ReturnType<typeof ImageManipulator.manipulate> | null = null
  let rendered: Awaited<
    ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>
  > | null = null
  let resultUri: string | null = null
  try {
    file.create({ overwrite: true })
    file.write(base64, { encoding: 'base64' })
    context = ImageManipulator.manipulate(file.uri)
    context.resize({ width: target.width, height: target.height })
    rendered = await context.renderAsync()
    const result = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true })
    resultUri = result.uri
    // Why: empty base64 would pass the downstream base64 check and upload a corrupt
    // image, so fail loudly here instead of silently sending an invalid payload.
    if (!result.base64) {
      throw new Error('Failed to encode resized clipboard image')
    }
    return { data: result.base64, width: result.width, height: result.height }
  } finally {
    rendered?.release()
    context?.release()
    if (resultUri) {
      try {
        new FsFile(resultUri).delete()
      } catch {
        // Best-effort cleanup; ImageManipulator saves into cache for every retry.
      }
    }
    try {
      file.delete()
    } catch {
      // Best-effort cleanup; the OS reclaims the cache directory regardless.
    }
  }
}

type UseMobileTerminalPasteOptions = {
  readonly activeHandle: string | null
  readonly activeHandleRef: RefObject<string | null>
  readonly activeSessionTabTypeRef: RefObject<string | null>
  readonly canSend: boolean
  readonly client: RpcClient | null
  readonly clientRef: RefObject<RpcClient | null>
  readonly connState: ConnectionState
  readonly connStateRef: RefObject<ConnectionState>
  readonly flushPendingLiveInputBeforeExternalSend: (handle: string) => Promise<boolean>
  readonly getActiveWorktreeConnectionId: () => Promise<string | null>
  readonly onError: () => void
  readonly onSuccess: () => void
  readonly pasteTerminalText: (handle: string, text: string) => Promise<boolean>
  readonly refreshCanPaste: () => void
  readonly showToast: (message: string, durationMs?: number) => void
}

export function useMobileTerminalPaste({
  activeHandle,
  activeHandleRef,
  activeSessionTabTypeRef,
  canSend,
  client,
  clientRef,
  connState,
  connStateRef,
  flushPendingLiveInputBeforeExternalSend,
  getActiveWorktreeConnectionId,
  onError,
  onSuccess,
  pasteTerminalText,
  refreshCanPaste,
  showToast
}: UseMobileTerminalPasteOptions): () => Promise<void> {
  return useCallback(async () => {
    if (!client || !activeHandle || !canSend) {
      return
    }
    const targetHandle = activeHandle
    try {
      const text = await Clipboard.getStringAsync()
      let payload: string | null = null
      if (text.length > 0) {
        payload = text
      } else {
        const image = await Clipboard.getImageAsync({ format: 'png' })
        if (!image) {
          refreshCanPaste()
          return
        }
        const connectionId = await getActiveWorktreeConnectionId()
        const base64 = await prepareMobileClipboardImageBase64(image, resizeMobileClipboardImage)
        const imagePath = await saveMobileClipboardImageAsTempFile(client, base64, {
          connectionId
        })
        payload = imagePath.split('\u001b').join('\u241b')
      }

      const wrappedBytes = new TextEncoder().encode(payload).byteLength
      if (wrappedBytes > 256 * 1024) {
        onError()
        // eslint-disable-next-line no-console
        console.warn('[mobile-clip] paste oversized', { wrappedBytes })
        showToast('Paste too large (max 256 KiB)', 1500)
        return
      }
      // Why: paste lives in the accessory row and must not overtake pending IME text.
      const flushedPendingInput = await flushPendingLiveInputBeforeExternalSend(targetHandle)
      if (!flushedPendingInput) {
        return
      }
      const currentClient = clientRef.current
      if (
        !currentClient ||
        connStateRef.current !== 'connected' ||
        targetHandle !== activeHandleRef.current ||
        activeSessionTabTypeRef.current !== 'terminal'
      ) {
        return
      }
      if (!(await pasteTerminalText(targetHandle, payload))) {
        return
      }
      onSuccess()
      refreshCanPaste()
    } catch (e) {
      onError()
      const err = e as { name?: string; message?: string }
      const isDisconnected = connState !== 'connected'
      // eslint-disable-next-line no-console
      console.warn('[mobile-clip] paste failed', { name: err.name, message: err.message })
      if (isDisconnected) {
        showToast('Paste failed (disconnected)', 1500)
      } else if (err.message === 'Clipboard image is too large') {
        showToast('Image too large to paste', 1500)
      } else {
        showToast('Paste failed', 1500)
      }
    }
  }, [
    activeHandle,
    activeHandleRef,
    activeSessionTabTypeRef,
    canSend,
    client,
    clientRef,
    connState,
    connStateRef,
    flushPendingLiveInputBeforeExternalSend,
    getActiveWorktreeConnectionId,
    onError,
    onSuccess,
    pasteTerminalText,
    refreshCanPaste,
    showToast
  ])
}
