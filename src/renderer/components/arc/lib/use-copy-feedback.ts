'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyFeedbackState = 'idle' | 'copied' | 'error'

/** Shared clipboard state for actions that render their own button or menu. */
export const useCopyFeedback = (duration = 1900) => {
    const [state, setState] = useState<CopyFeedbackState>('idle')
    const [activeKey, setActiveKey] = useState<string | null>(null)
    const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

    const reset = useCallback(() => {
        if (timeout.current) {
            clearTimeout(timeout.current ?? undefined)
        }
        timeout.current = null
        setState('idle')
        setActiveKey(null)
    }, [])

    useEffect(
        () => () => {
            if (timeout.current) {
                clearTimeout(timeout.current ?? undefined)
            }
        },
        []
    )

    const copy = useCallback(
        async (value: string, key = 'default') => {
            if (timeout.current) {
                clearTimeout(timeout.current ?? undefined)
            }
            setActiveKey(key)
            try {
                await navigator.clipboard.writeText(value)
                setState('copied')
                timeout.current = setTimeout(reset, duration)
                return true
            } catch {
                setState('error')
                timeout.current = setTimeout(reset, duration)
                return false
            }
        },
        [duration, reset]
    )

    return { activeKey, copy, reset, state }
}
