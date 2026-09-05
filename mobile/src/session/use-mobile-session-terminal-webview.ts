import { useEffect, useCallback } from 'react'
import type { TerminalViewRef } from '@orca/libghostty-terminal'
import { isUsableTerminalViewport } from '../terminal/terminal-native-viewport-update'
import type { MobileSessionTabSwitchingModel } from './use-mobile-session-tab-switching'

export function useMobileSessionTerminalWebview(scope: MobileSessionTabSwitchingModel) {
  const {
    client,
    markdownDocs,
    fileDocs,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    deviceTokenRef,
    connStateRef,
    viewportRef,
    viewportMeasuredRef,
    terminalViewportUpdateRef,
    terminalResizeSeqRef,
    terminalRefs,
    terminalUnsubsRef,
    initializedHandlesRef,
    terminalDiagnosticsRef,
    nativeReadyHandlesRef,
    activeHandleRef,
    pendingActiveTerminalHandleRef,
    activeSessionTab,
    unsubscribeTerminal,
    subscribeToTerminal,
    nativeChatStream,
    readMarkdownTab,
    readFileTab
  } = scope
  const setTerminalNativeRef = useCallback((handle: string, ref: TerminalViewRef | null) => {
    terminalDiagnosticsRef.current.webViewRef(handle, ref != null)
    if (ref) {
      terminalRefs.current.set(handle, ref)
    } else {
      terminalRefs.current.delete(handle)
      terminalGestureInputBucketsRef.current.delete(handle)
      const queued = terminalGestureInputQueuesRef.current.get(handle)
      if (queued?.timer) {
        clearTimeout(queued.timer)
      }
      terminalGestureInputQueuesRef.current.delete(handle)
      terminalGestureInputInFlightRef.current.delete(handle)
    }
  }, [])

  const handleTerminalNativeReady = useCallback(
    (handle: string, cols: number, rows: number) => {
      const wasAlreadyReady = nativeReadyHandlesRef.current.has(handle)
      nativeReadyHandlesRef.current.add(handle)
      if (isUsableTerminalViewport({ cols, rows })) {
        viewportRef.current = { cols, rows }
        viewportMeasuredRef.current = true
      }
      nativeChatStream.notifyWebReady(handle, wasAlreadyReady)
      terminalDiagnosticsRef.current.webViewReady(
        handle,
        wasAlreadyReady,
        handle === activeHandleRef.current
      )
      if (wasAlreadyReady && initializedHandlesRef.current.has(handle)) {
        unsubscribeTerminal(handle)
        initializedHandlesRef.current.delete(handle)
        if (handle === activeHandleRef.current) {
          subscribeToTerminal(handle)
        }
        return
      }
      const isIntendedActive = () =>
        handle === activeHandleRef.current || handle === pendingActiveTerminalHandleRef.current
      if (isIntendedActive() && !terminalUnsubsRef.current.has(handle)) {
        subscribeToTerminal(handle)
      }
    },
    [nativeChatStream, subscribeToTerminal, unsubscribeTerminal]
  )

  const handleTerminalNativeResize = useCallback(
    (handle: string, cols: number, rows: number) => {
      if (!isUsableTerminalViewport({ cols, rows })) {
        return
      }
      const current = viewportRef.current
      if (current?.cols === cols && current.rows === rows) {
        return
      }
      viewportRef.current = { cols, rows }
      viewportMeasuredRef.current = true
      if (
        handle !== activeHandleRef.current ||
        connStateRef.current !== 'connected' ||
        !initializedHandlesRef.current.has(handle)
      ) {
        return
      }
      const resizeSeq = (terminalResizeSeqRef.current.get(handle) ?? 0) + 1
      terminalResizeSeqRef.current.set(handle, resizeSeq)
      const deviceToken = deviceTokenRef.current
      if (!client || !deviceToken) {
        return
      }
      void terminalViewportUpdateRef.current
        .request(client, handle, deviceToken, { cols, rows })
        .then((updated) => {
          if (
            terminalResizeSeqRef.current.get(handle) !== resizeSeq ||
            handle !== activeHandleRef.current ||
            !terminalRefs.current.has(handle)
          ) {
            return
          }
          if (updated) {
            client.updateTerminalSubscriptionViewport(handle, { cols, rows })
            return
          }
          unsubscribeTerminal(handle)
          initializedHandlesRef.current.delete(handle)
          subscribeToTerminal(handle)
        })
    },
    [client, subscribeToTerminal, unsubscribeTerminal]
  )

  useEffect(() => {
    if (activeSessionTab?.type !== 'markdown') {
      return
    }
    const doc = markdownDocs.get(activeSessionTab.id)
    if (!doc) {
      void readMarkdownTab(activeSessionTab)
    }
  }, [activeSessionTab, markdownDocs, readMarkdownTab])

  useEffect(() => {
    if (activeSessionTab?.type !== 'file') {
      return
    }
    const doc = fileDocs.get(activeSessionTab.id)
    if (!doc) {
      void readFileTab(activeSessionTab)
    }
  }, [activeSessionTab, fileDocs, readFileTab])
  return {
    setTerminalNativeRef,
    handleTerminalNativeReady,
    handleTerminalNativeResize
  }
}

export type MobileSessionTerminalWebviewModel = MobileSessionTabSwitchingModel &
  ReturnType<typeof useMobileSessionTerminalWebview>
