import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '../shared/model'

/** Read only on intent, share pending reads, and retain a small visit-local cache. */
export function useHistoryEntry(
    id: string | undefined,
    reading: boolean,
    restoreId: string | undefined,
    version: number | undefined
) {
    const cache = useMemo(
        () => ({
            restoreId,
            version,
            entries: new Map<string, HistoryEntry>(),
            pending: new Map<string, Promise<HistoryEntry | undefined>>()
        }),
        [restoreId, version]
    )
    const [result, setResult] = useState<{ cache: typeof cache; id: string; entry?: HistoryEntry; error?: string }>()
    const load = useCallback(
        (entryId: string) => {
            const cached = cache.entries.get(entryId)
            if (cached) return Promise.resolve(cached)
            const pending = cache.pending.get(entryId)
            if (pending) return pending
            const request = window.journal
                .readEntry(entryId, cache.restoreId)
                .then((entry) => {
                    if (entry) {
                        cache.entries.set(entryId, entry)
                        if (cache.entries.size > 12) cache.entries.delete(cache.entries.keys().next().value!)
                    }
                    return entry
                })
                .finally(() => cache.pending.delete(entryId))
            cache.pending.set(entryId, request)
            return request
        },
        [cache]
    )
    useEffect(() => {
        if (!reading || !id) return
        let active = true
        setResult({ cache, id })
        void load(id).then(
            (entry) => {
                if (active)
                    setResult({
                        cache,
                        id,
                        entry,
                        error: entry ? undefined : 'Could not open this entry. Close and reopen it to retry.'
                    })
            },
            () => {
                if (active) setResult({ cache, id, error: 'Could not open this entry. Close and reopen it to retry.' })
            }
        )
        return () => {
            active = false
        }
    }, [cache, id, reading, load])
    const prefetch = useCallback(
        (entryId: string) => {
            if (cache.pending.size < 2)
                void load(entryId).catch(() => {
                    /* Opening owns visible failure and retry. */
                })
        },
        [cache, load]
    )
    const entry =
        (id ? cache.entries.get(id) : undefined) ??
        (result?.cache === cache && result.id === id ? result.entry : undefined)
    const error = !entry && result?.cache === cache && result.id === id ? result.error : undefined
    return { entry, error, loading: !entry && !error, prefetch }
}
