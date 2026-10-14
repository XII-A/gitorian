import { useEffect, useState } from 'react'

import type { Command, Reply, State } from '../shared/model'
import { required } from '../shared/required'
import { actionableSources, readableError } from './background-work'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export const AcquisitionStatus = ({
    state,
    run,
    open,
    onOpenChange,
    onSettings
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettings: () => void
}) => {
    const [, tick] = useState(0)
    const waitingForProvider =
        open &&
        actionableSources(state).some(([, status]) => !!status.retryAt && Date.parse(status.retryAt) > Date.now())
    useEffect(() => {
        if (!waitingForProvider) {
            return
        }
        const timer = setInterval(() => {
            tick((value) => value + 1)
        }, 1000)
        return () => {
            clearInterval(timer)
        }
    }, [waitingForProvider])
    const sources = actionableSources(state).toSorted((a, b) => Number(!!b[1].error) - Number(!!a[1].error))
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                title="Activity sources"
                backdrop="dim"
                onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    const trigger =
                        document.querySelector<HTMLButtonElement>('[data-source-status]') ??
                        document.querySelector<HTMLButtonElement>('[aria-label="Refresh activity"]')
                    trigger?.focus()
                }}
            >
                <ScrollArea maxHeight="min(60vh, 420px)" label="Activity sources" fade={16}>
                    <div className="acquisition-sources">
                        {!sources.length && <p>No sources need attention.</p>}
                        {sources.map(([key, status]) => {
                            const [source, repositoryId] = key.split(':')
                            const repository = state.repositories.find((item) => item.id === repositoryId)
                            const paused = status.status === 'cancelled'
                            const waiting = !!status.retryAt && Date.parse(status.retryAt) > Date.now()
                            const active =
                                status.status === 'running' || (status.status === 'idle' && !!status.windowEnd)
                            const reconnect =
                                /401|403|unauthorized|credentials|permission|not found|404|available/iu.test(
                                    status.error ?? ''
                                )
                            return (
                                <div key={key}>
                                    <strong>
                                        {source === 'notion'
                                            ? 'Notion journal'
                                            : `${repository?.name ?? 'Repository'} / ${source === 'github' ? 'GitHub' : 'Local Git'}`}
                                    </strong>
                                    <p>
                                        {(() => {
                                            if (paused) {
                                                return 'Paused by you. Completed work is kept.'
                                            }
                                            if (waiting) {
                                                return `Provider rate limit. Retry available at ${new Date(required(status.retryAt)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                                            }
                                            if (active) {
                                                if (status.status === 'running') {
                                                    return 'Refreshing...'
                                                }

                                                return 'Queued'
                                            }
                                            return readableError(status.error ?? '')
                                        })()}
                                    </p>
                                    <div className="source-actions">
                                        {active && source !== 'notion' ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    Promise.resolve(
                                                        run({
                                                            repositoryId,
                                                            source: source === 'git' ? 'git' : 'github',
                                                            type: 'stopWork'
                                                        })
                                                    )
                                                }
                                            >
                                                Pause
                                            </Button>
                                        ) : (
                                            !active && (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={waiting}
                                                    onClick={() =>
                                                        reconnect && !paused
                                                            ? onSettings()
                                                            : run({
                                                                  repositoryId,
                                                                  source: source as 'git' | 'github' | 'notion',
                                                                  type: 'refresh'
                                                              })
                                                    }
                                                >
                                                    {(() => {
                                                        if (paused) {
                                                            return 'Resume'
                                                        }
                                                        if (reconnect) {
                                                            return 'Open settings'
                                                        }
                                                        return 'Retry'
                                                    })()}
                                                </Button>
                                            )
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}
