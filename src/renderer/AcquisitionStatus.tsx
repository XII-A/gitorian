import { providerRemote, providerName } from '../shared/provider-accounts'
import { useEffect, useState } from 'react'
import type { Command, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'
import { Dialog, DialogContent } from './components/arc/dialog/dialog'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { sourceProblems, readableError } from './background-work'

export function AcquisitionStatus({
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
}) {
    const [, tick] = useState(0)
    const waitingForProvider =
        open && sourceProblems(state).some(([, status]) => !!status.retryAt && Date.parse(status.retryAt) > Date.now())
    useEffect(() => {
        if (!waitingForProvider) return
        const timer = setInterval(() => tick((value) => value + 1), 1000)
        return () => clearInterval(timer)
    }, [waitingForProvider])
    const sources = sourceProblems(state)
    useEffect(() => {
        if (open && !sources.length) onOpenChange(false)
    }, [open, sources.length, onOpenChange])
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
                            const waiting = !!status.retryAt && Date.parse(status.retryAt) > Date.now()
                            const reconnect =
                                /401|403|unauthorized|credentials|permission|not found|404|available/i.test(
                                    status.error ?? ''
                                )
                            return (
                                <div key={key}>
                                    <strong>
                                        {source === 'notion'
                                            ? 'Notion journal'
                                            : `${repository?.name ?? 'Repository'} / ${source === 'remote' ? (repository && providerRemote(repository.remote) ? providerName(providerRemote(repository.remote)!.provider) : 'Remote') : 'Local Git'}`}
                                    </strong>
                                    <p>
                                        {waiting
                                            ? `Provider rate limit. Retry available at ${new Date(status.retryAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                                            : readableError(status.error ?? '')}
                                    </p>
                                    <div className="source-actions">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            disabled={waiting}
                                            onClick={() =>
                                                reconnect
                                                    ? onSettings()
                                                    : run({
                                                          type: 'refresh',
                                                          source: source as 'git' | 'remote' | 'notion',
                                                          repositoryId
                                                      })
                                            }
                                        >
                                            {reconnect ? 'Open settings' : 'Retry'}
                                        </Button>
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
