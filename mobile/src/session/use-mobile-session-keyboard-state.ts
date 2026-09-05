import { useEffect, useCallback } from 'react'
import { Keyboard, Platform, type KeyboardEvent } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { saveCustomKeys, type CustomKey } from '../components/CustomKeyModal'
import { LAST_VISITED_WORKTREE_STORAGE_KEY } from '../worktree/last-visited-worktree-repo'
import { resolveTabStripScrollOffset } from './tab-strip-scroll'
import type { MobileSessionLifecycleModel } from './use-mobile-session-lifecycle'

export function useMobileSessionKeyboardState(scope: MobileSessionLifecycleModel) {
  const {
    hostId,
    worktreeId,
    router,
    activeSessionTabId,
    tabStripRef,
    tabStripOffsetRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabLayoutsRef,
    customKeys,
    setCustomKeys,
    setShowCustomKeyModal,
    setKeyboardHeight
  } = scope

  useEffect(() => {
    const onShow = (e: KeyboardEvent) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0)
    }
    const onHide = () => {
      setKeyboardHeight(0)
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, onShow)
    const hideSub = Keyboard.addListener(hideEvent, onHide)
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  const scrollActiveTabIntoView = useCallback((tabId: string | null, animated: boolean) => {
    if (!tabId) {
      return
    }
    const layout = tabLayoutsRef.current.get(tabId)
    if (!layout) {
      return
    }
    const nextOffset = resolveTabStripScrollOffset({
      tabX: layout.x,
      tabWidth: layout.width,
      viewportWidth: tabStripViewportWidthRef.current,
      contentWidth: tabStripContentWidthRef.current,
      currentOffset: tabStripOffsetRef.current
    })
    if (nextOffset !== tabStripOffsetRef.current) {
      tabStripOffsetRef.current = nextOffset
      tabStripRef.current?.scrollTo({ x: nextOffset, animated })
    }
  }, [])

  // Reveal the active tab on change; defer one frame so freshly mounted tab layouts are recorded.
  useEffect(() => {
    const id = requestAnimationFrame(() => scrollActiveTabIntoView(activeSessionTabId, true))
    return () => cancelAnimationFrame(id)
  }, [activeSessionTabId, scrollActiveTabIntoView])

  useEffect(() => {
    if (hostId && worktreeId) {
      void AsyncStorage.setItem(
        LAST_VISITED_WORKTREE_STORAGE_KEY,
        JSON.stringify({ hostId, worktreeId })
      )
    }
  }, [hostId, worktreeId])

  const handleDeleteCustomKey = useCallback(
    async (key: CustomKey) => {
      const updated = customKeys.filter((k) => k.id !== key.id)
      setCustomKeys(updated)
      await saveCustomKeys(updated)
    },
    [customKeys]
  )

  const handleManageShortcuts = useCallback(() => {
    setShowCustomKeyModal(false)
    router.push('/terminal-settings')
  }, [router])
  return {
    scrollActiveTabIntoView,
    handleDeleteCustomKey,
    handleManageShortcuts
  }
}

export type MobileSessionKeyboardStateModel = MobileSessionLifecycleModel &
  ReturnType<typeof useMobileSessionKeyboardState>
