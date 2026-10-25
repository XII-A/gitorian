import { useEffect, useState } from 'react'
import type { ConfirmMorphState } from './components/arc/confirm-morph/confirm-morph'

/** Persisted connection truth may change before the action's pending/result feedback finishes. */
export function useDisconnectTransition(connected: boolean) {
    const [state, setState] = useState<ConfirmMorphState>('idle')
    useEffect(() => {
        if (state !== 'done') return
        // Match connection success feedback. This lifecycle must complete even while the pointer rests on the pill.
        const timer = setTimeout(() => setState('idle'), 900)
        return () => clearTimeout(timer)
    }, [state])
    return { state, setState, showDisconnect: connected || state !== 'idle' }
}
