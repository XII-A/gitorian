import { useEffect, useState } from 'react'
import type { ConnectionProfile, ConnectionService } from '../shared/model'

export function useConnectionProfile(service: ConnectionService, enabled: boolean) {
    const [profile, setProfile] = useState<ConnectionProfile>()
    const [ready, setReady] = useState(false)
    useEffect(() => {
        let cancelled = false
        if (!enabled) {
            setProfile(undefined)
            setReady(false)
            return
        }
        void (async () => {
            try {
                const cached = (await window.journal.invoke({ type: 'connectionProfiles' })).connectionProfiles?.[
                    service
                ]
                if (cancelled) return
                setProfile(cached)
                if (cached) setReady(true)
                const refreshed = (await window.journal.invoke({ type: 'refreshConnectionProfile', service }))
                    .connectionProfiles?.[service]
                if (!cancelled && refreshed) setProfile(refreshed)
            } catch {
                /* Keep a warm profile while offline; a cold load uses its initial fallback. */
            } finally {
                if (!cancelled) setReady(true)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [service, enabled])
    return { profile, ready }
}
