import { useEffect, useState } from 'react'
import type { Reply } from '../shared/model'

type Visibility = 'active' | 'dismissed' | 'complete' | 'existing'
const storageKey = 'gitorian:onboarding:v1'

/** A profile-local UI preference. Integration credentials and journal content stay in their own stores. */
export function useOnboarding(reply: Reply | undefined) {
    const [preference, setPreference] = useState<{ key: string; visibility: Visibility }>()
    const key = `${storageKey}:${reply?.state.restoreId ?? 'local'}`
    useEffect(() => {
        if (!reply || preference?.key === key) return
        let saved: string | null = null
        try {
            saved = window.localStorage.getItem(key)
        } catch {
            // Storage can be unavailable. Setup and writing remain usable in this session.
        }
        const state = reply.state
        const existing =
            state.repositories.length || state.activities.length || state.entries.length || state.drafts.length
        const visibility = ['active', 'dismissed', 'complete', 'existing'].includes(saved ?? '')
            ? (saved as Visibility)
            : existing
              ? 'existing'
              : 'active'
        setPreference({ key, visibility })
    }, [key, preference?.key, reply])

    const accountsDone = !!reply?.connections.github && !!reply?.connections.notion
    const repositoriesDone = !!reply?.state.repositories.some((repository) => !repository.removed)
    const complete = accountsDone && repositoriesDone
    useEffect(() => {
        if (!preference || preference.key !== key) return
        if (complete && (preference.visibility === 'active' || preference.visibility === 'dismissed')) {
            setPreference({ key, visibility: 'complete' })
            return
        }
        try {
            window.localStorage.setItem(key, preference.visibility)
        } catch {
            // Keep the current session working if persistence is unavailable.
        }
    }, [complete, key, preference])

    return {
        visibility: preference?.key === key ? preference.visibility : undefined,
        completed: [accountsDone ? 'accounts' : '', repositoriesDone ? 'repositories' : ''].filter(Boolean),
        dismiss: () => setPreference({ key, visibility: complete ? 'complete' : 'dismissed' })
    }
}
