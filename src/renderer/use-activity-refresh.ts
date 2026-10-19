import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Command, Reply } from '../shared/model'
import { actionableSources } from './background-work'
import { rangeActivities } from './hub-model'
import { useToastStack } from './components/arc/toast-stack/toast-stack'

interface RefreshRequest {
    selection: { start: string; end: string }
}

/** Completion feedback belongs to this click, never to background state updates. */
export function useActivityRefresh(run: (command: Command) => Promise<Reply | undefined>, start: string, end: string) {
    const { toast } = useToastStack()
    const selection = useMemo(() => ({ start, end }), [start, end])
    const [request, setRequest] = useState<RefreshRequest>()
    const pending = useRef<RefreshRequest | undefined>(undefined)
    const currentSelection = useRef(selection)
    currentSelection.current = selection
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const refresh = useCallback(async () => {
        if (pending.current?.selection === selection) return
        const next = { selection }
        pending.current = next
        setRequest(next)
        try {
            const reply = await run({ type: 'refresh', since: start })
            if (
                reply &&
                mounted.current &&
                currentSelection.current === selection &&
                !actionableSources(reply.state).some(([key]) => key !== 'notion') &&
                !rangeActivities(reply.state, start, end).length
            )
                toast({
                    id: `activity-empty:${start}`,
                    type: 'info',
                    title: 'No activity found',
                    description: `No activity was found for ${start} to ${end}. Try another week.`
                })
        } finally {
            if (pending.current === next) pending.current = undefined
            if (mounted.current) setRequest((current) => (current === next ? undefined : current))
        }
    }, [run, start, end, selection, toast])
    return { refresh, refreshing: request?.selection === selection }
}
