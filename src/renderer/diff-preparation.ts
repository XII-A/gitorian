import { useEffect, useRef } from 'react'
import type { Activity, Command, Reply, State } from '../shared/model'
import { codeLimits, loadCodeHighlighting } from './code-highlighting'
import { loadDiff } from './diff-loader'
import { hasCachedDetails } from './activity-cache'

export type DetailRunner = (command: Command) => Promise<Reply | undefined>
let running = false
let queued: { selected: boolean; start: () => Promise<void> } | undefined
const attempted = new Set<string>()

function preparePatch(text: string | undefined) {
    if (text?.startsWith('diff --git') && text.length <= codeLimits.patch) void loadDiff(text, 'background')
}

/** One speculative read at a time. Hover/focus may read disk, never acquire provider evidence. */
export function scheduleDiffPreparation(
    state: State,
    activity: Activity,
    run: DetailRunner,
    selected = false
): () => void {
    let cancelled = false
    const start = async () => {
        if (cancelled) return
        const key = JSON.stringify([
            state.restoreId,
            activity.id,
            activity.sourceVersion,
            activity.sha,
            activity.revision,
            activity.diffRevision,
            selected
        ])
        const patch = state.diffs[activity.id]
        void loadCodeHighlighting()
        if (hasCachedDetails(state, activity)) {
            preparePatch(patch)
            return
        }
        if (attempted.has(key)) return
        attempted.add(key)
        while (attempted.size > 64) attempted.delete(attempted.values().next().value!)
        const reply = await run({ type: 'details', activityId: activity.id, content: 'diff', cachedOnly: !selected })
        if (reply && reply.state.restoreId === state.restoreId && !reply.detailError) preparePatch(reply.diff)
        else attempted.delete(key)
    }
    const execute = async (operation: () => Promise<void>) => {
        running = true
        try {
            await operation()
        } catch {
            /* Foreground inspection owns errors and retry. */
        } finally {
            running = false
            const next = queued
            queued = undefined
            if (next) void execute(next.start)
        }
    }
    const timer = setTimeout(
        () => {
            if (running) {
                if (selected || !queued?.selected) queued = { selected, start }
            } else void execute(start)
        },
        selected ? 120 : 100
    )
    return () => {
        cancelled = true
        clearTimeout(timer)
    }
}

/** Delegation avoids per-row subscriptions and also covers virtualized and Related activity rows. */
export function useActivityDiffIntents(state: State | undefined) {
    const latest = useRef(state)
    latest.current = state
    const available = !!state?.activities.length
    useEffect(() => {
        if (!available) return
        let cancel: (() => void) | undefined
        const enter = (event: PointerEvent | FocusEvent) => {
            const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-activity-id]') : null
            if (!row || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return
            cancel?.()
            const state = latest.current
            const activity = state?.activities.find((item) => item.id === row.dataset.activityId)
            if (state && activity)
                cancel = scheduleDiffPreparation(state, activity, (command) => window.journal.invoke(command))
        }
        const leave = (event: PointerEvent | FocusEvent) => {
            const row = event.target instanceof Element ? event.target.closest('[data-activity-id]') : null
            if (row && !(event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) cancel?.()
        }
        const idle =
            typeof requestIdleCallback === 'function'
                ? requestIdleCallback(
                      () => {
                          void loadCodeHighlighting()
                      },
                      { timeout: 1500 }
                  )
                : undefined
        document.addEventListener('pointerover', enter)
        document.addEventListener('focusin', enter)
        document.addEventListener('pointerout', leave)
        document.addEventListener('focusout', leave)
        return () => {
            cancel?.()
            if (idle !== undefined) cancelIdleCallback(idle)
            document.removeEventListener('pointerover', enter)
            document.removeEventListener('focusin', enter)
            document.removeEventListener('pointerout', leave)
            document.removeEventListener('focusout', leave)
        }
    }, [available])
}
