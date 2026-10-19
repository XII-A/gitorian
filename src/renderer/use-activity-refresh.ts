import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Reply } from '../shared/model'
import { actionableSources } from './background-work'
import { rangeActivities } from './hub-model'
import { useToastStack } from './components/arc/toast-stack/toast-stack'

/** Completion feedback belongs to this click, never to background state updates. */
export function useActivityRefresh(run: (command: Command) => Promise<Reply | undefined>, start: string, end: string) {
    const { toast } = useToastStack()
    const [refreshing, setRefreshing] = useState(false)
    const pending = useRef(false)
    const range = `${start}:${end}`
    const currentRange = useRef(range)
    currentRange.current = range
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const refresh = useCallback(async () => {
        if (pending.current) return
        pending.current = true
        setRefreshing(true)
        try {
            const reply = await run({ type: 'refresh', since: start })
            if (
                reply &&
                mounted.current &&
                currentRange.current === range &&
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
            pending.current = false
            setRefreshing(false)
        }
    }, [run, start, end, range, toast])
    return { refresh, refreshing }
}
