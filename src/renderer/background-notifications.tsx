import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Command, Reply, State } from '../shared/model'
import { sourceProblems } from './background-work'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { useToastStack } from './components/arc/toast-stack/toast-stack'
import { ImportResults } from './import-results'

export const BackgroundNotifications = ({
    state,
    run,
    settingsOpen,
    onSources
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    settingsOpen: boolean
    onSources: () => void
}) => {
    const { toast, update, dismiss } = useToastStack()
    const callbacks = useRef({ onSources, run })
    useLayoutEffect(() => {
        callbacks.current = { onSources, run }
    }, [onSources, run])
    const problemKey = useRef('')
    const importToast = useRef('')
    const lastImport = useRef('')
    const importInSettings = useRef('')
    const [resultsOpen, setResultsOpen] = useState(false)
    const problems = sourceProblems(state)
    const signature = problems
        .map(([key, status]) => `${key}:${status.error}`)
        .toSorted()
        .join('|')
    const count = problems.length
    useEffect(() => {
        if (signature === problemKey.current) {
            return
        }
        problemKey.current = signature
        if (!count) {
            dismiss('activity-problems')
            return
        }
        toast({
            action: {
                label: 'Review',
                onClick: () => {
                    callbacks.current.onSources()
                }
            },
            id: 'activity-problems',
            title: `${count} ${count === 1 ? 'source' : 'sources'} failed to refresh`,
            type: 'warning'
        })
    }, [signature, count, toast, dismiss])
    const job = state.repositoryImport
    useEffect(() => {
        if (!job) {
            return
        }
        const key = job.id ?? `legacy:${job.total}:${job.message ?? ''}`
        if (settingsOpen) {
            if (job.status === 'running') {
                importInSettings.current = key
            }
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
            if (importInSettings.current !== key) {
                return
            }
            const options = {
                action: {
                    label: 'Stop import',
                    onClick: (id: string) => {
                        update(id, { action: undefined, title: 'Stopping repository import...' })
                        void callbacks.current.run({ source: 'repositories', type: 'stopWork' })
                    }
                },
                title: `Importing repositories: ${job.completed} of ${job.total}`,
                type: 'loading' as const
            }
            if (importToast.current) {
                update(importToast.current, options)
            } else {
                importToast.current = toast({ id: `import:${key}`, ...options })
            }
            return
        }
        if (lastImport.current === key) {
            return
        }
        let seen = false
        try {
            seen = localStorage.getItem('journal:last-import-notification') === key
        } catch {
            /* Notifications still work without browser storage. */
        }
        if (seen) {
            return
        }
        lastImport.current = key
        const warning = job.status !== 'done' || !!job.skipped || /skipped/iu.test(job.message ?? '')
        const options = {
            action: warning
                ? {
                      label: 'View results',
                      onClick: () => {
                          setResultsOpen(true)
                      }
                  }
                : undefined,
            title: (() => {
                if (job.status === 'error') {
                    return 'Repository import failed'
                }
                if (job.status === 'cancelled') {
                    return 'Repository import stopped'
                }
                if (warning) {
                    return 'Repositories imported with skipped items'
                }

                return job.message?.split('.')[0] || 'Repository import complete'
            })(),
            type: (() => {
                if (job.status === 'error') {
                    return 'error' as const
                }
                if (warning) {
                    return 'warning' as const
                }
                return 'success' as const
            })()
        }
        if (importToast.current) {
            update(importToast.current, options)
            importToast.current = ''
        } else {
            toast({ id: `import:${key}`, ...options })
        }
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
