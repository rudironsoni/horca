import { useEffect, useCallback } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { loadHosts } from '../transport/host-store'
import { loadTerminalAccessoryLayout } from '../terminal/terminal-accessory-layout'
import { loadCustomKeys } from '../components/CustomKeyModal'
import type { MobileSessionTabReconciliationModel } from './use-mobile-session-tab-reconciliation'

export function useMobileSessionLifecycle(scope: MobileSessionTabReconciliationModel) {
  const { hostId, setCustomKeys, setVisibleBuiltInIds, setHostEndpoint } = scope
  // Why: the shared client owns authenticated identity; this host read only supplies connection-hint metadata.
  useEffect(() => {
    if (!hostId) {
      return
    }
    let stale = false
    void loadHosts().then((hosts) => {
      if (stale) {
        return
      }
      const host = hosts.find((h) => h.id === hostId)
      if (host) {
        setHostEndpoint(host.endpoint)
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  useEffect(() => {
    void loadCustomKeys().then(setCustomKeys)
  }, [])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void loadTerminalAccessoryLayout().then((layout) => {
        if (!stale) {
          setVisibleBuiltInIds(layout.visibleBuiltInIds)
        }
      })
      return () => {
        stale = true
      }
    }, [])
  )

  useEffect(() => {
    let mounted = true
    const refresh = () => {
      void loadTerminalAccessoryLayout().then((layout) => {
        if (mounted) {
          setVisibleBuiltInIds(layout.visibleBuiltInIds)
        }
      })
    }
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        refresh()
      }
    })
    return () => {
      mounted = false
      sub.remove()
    }
  }, [])

  return {}
}

export type MobileSessionLifecycleModel = MobileSessionTabReconciliationModel &
  ReturnType<typeof useMobileSessionLifecycle>
