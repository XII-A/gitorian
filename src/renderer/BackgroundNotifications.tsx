import { ImportResults } from './ImportResults'
import { useEffect, useRef, useState } from 'react'
import type { Command, Reply, State } from '../shared/model'
import { sourceProblems } from './background-work'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export function BackgroundNotifications({
    state,
    run,
    settingsOpen,
    onSources
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    settingsOpen: boolean
    onSources: () => void
}) {
    const { toast, update, dismiss } = useToastStack()
    const callbacks = useRef({ run, onSources })
    callbacks.current = { run, onSources }
    const problemKey = useRef('')
    const importToast = useRef('')
    const lastImport = useRef('')
    const importInSettings = useRef('')
    const [resultsOpen, setResultsOpen] = useState(false)
    const problems = sourceProblems(state)
    const signature = problems
        .map(([key, status]) => `${key}:${status.error}`)
        .sort()
        .join('|')
    const count = problems.length
    useEffect(() => {
        if (signature === problemKey.current) return
        problemKey.current = signature
        if (!count) {
            dismiss('activity-problems')
            return
        }
        toast({
            id: 'activity-problems',
            type: 'warning',
            title: `${count} ${count === 1 ? 'source' : 'sources'} failed to refresh`,
            action: { label: 'Review', onClick: () => callbacks.current.onSources() }
        })
    }, [signature, count, toast, dismiss])
    const job = state.repositoryImport
    useEffect(() => {
        if (!job) return
        const key = job.id ?? `legacy:${job.total}:${job.message ?? ''}`
        if (settingsOpen) {
            if (job.status === 'running') importInSettings.current = key
            if (importToast.current) {
                dismiss(importToast.current)
                importToast.current = ''
            }
            if (job.status !== 'running') {
                lastImport.current = key
                try {
                    localStorage.setItem('journal:last-import-notification', key)
                } catch {
                    /* Results remain in Settings. */
                }
            }
            return
        }
        if (job.status === 'running') {
            if (importInSettings.current !== key) return
            const options = {
                type: 'loading' as const,
                title: `Importing repositories: ${job.completed} of ${job.total}`,
                action: {
                    label: 'Stop import',
                    onClick: (id: string) => {
                        update(id, { title: 'Stopping repository import...', action: undefined })
                        void callbacks.current.run({ type: 'stopWork', source: 'repositories' })
                    }
                }
            }
            if (importToast.current) update(importToast.current, options)
            else importToast.current = toast({ id: `import:${key}`, ...options })
            return
        }
        if (lastImport.current === key) return
        let seen = false
        try {
            seen = localStorage.getItem('journal:last-import-notification') === key
        } catch {
            /* Notifications still work without browser storage. */
        }
        if (seen) return
        lastImport.current = key
        const warning = job.status !== 'done' || !!job.skipped || /skipped/i.test(job.message ?? '')
        const options = {
            type: job.status === 'error' ? ('error' as const) : warning ? ('warning' as const) : ('success' as const),
            title:
                job.status === 'error'
                    ? 'Repository import failed'
                    : job.status === 'cancelled'
                      ? 'Repository import stopped'
                      : warning
                        ? 'Repositories imported with skipped items'
                        : job.message?.split('.')[0] || 'Repository import complete',
            action: warning ? { label: 'View results', onClick: () => setResultsOpen(true) } : undefined
        }
        if (importToast.current) {
            update(importToast.current, options)
            importToast.current = ''
        } else toast({ id: `import:${key}`, ...options })
        try {
            localStorage.setItem('journal:last-import-notification', key)
        } catch {
            /* Keep the result available in Settings. */
        }
    }, [job, settingsOpen, toast, update, dismiss])
    return (
        <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
            <DialogContent title="Repository import results" backdrop="dim">
                <ScrollArea maxHeight="min(60vh, 420px)" label="Import results">
                    <ImportResults job={job} />
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
