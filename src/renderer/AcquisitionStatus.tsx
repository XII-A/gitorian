import type { Command, Reply, State } from '../shared/model'
import { Button } from './components/arc/button/button'

export function AcquisitionStatus({
    state,
    run
}: {
    state: State
    run: (command: Command) => Promise<Reply | undefined>
}) {
    const sources = Object.entries(state.acquisition ?? {}).filter(
        ([key]) => key === 'notion' || state.repositories.some((repo) => !repo.removed && key.endsWith(`:${repo.id}`))
    )
    if (!sources.length) return null
    const problems = sources.filter(([, status]) => status.error)
    const running = sources.some(([, status]) => status.status === 'running')
    const pending = sources.some(([, status]) => status.windowEnd)
    return (
        <details className="acquisition-status">
            <summary aria-live="polite">
                {problems.length
                    ? `${problems.length} activity sources need attention`
                    : running || pending
                      ? 'Updating activity in the background. You can keep writing.'
                      : 'Activity is up to date'}{' '}
            </summary>
            <div className="acquisition-sources">
                {sources.map(([key, status]) => {
                    const [source, repositoryId] = key.split(':')
                    const repository = state.repositories.find((item) => item.id === repositoryId)
                    return (
                        <div key={key}>
                            <strong>
                                {source === 'notion'
                                    ? 'Notion journal'
                                    : `${repository?.name ?? 'Repository'} · ${source === 'github' ? 'GitHub' : 'Local Git'}`}
                            </strong>
                            <p>
                                {status.error ??
                                    (status.status === 'running'
                                        ? 'Refreshing…'
                                        : status.windowEnd
                                          ? 'More activity is queued.'
                                          : 'Refresh complete.')}
                            </p>
                            <small>
                                {status.lastSuccess
                                    ? `Last success: ${new Date(status.lastSuccess).toLocaleString()}`
                                    : 'First refresh has not finished.'}
                                {status.since ? ` · Acquiring updates since ${status.since}` : ''}
                            </small>
                            {status.error && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={
                                        status.status === 'running' ||
                                        (!!status.retryAt && Date.parse(status.retryAt) > Date.now())
                                    }
                                    onClick={() =>
                                        run({
                                            type: 'refresh',
                                            source: source as 'git' | 'github' | 'notion',
                                            repositoryId
                                        })
                                    }
                                >
                                    {status.retryAt && Date.parse(status.retryAt) > Date.now()
                                        ? `Paused until ${new Date(status.retryAt).toLocaleTimeString()}`
                                        : 'Retry this source'}
                                </Button>
                            )}
                            {(status.status === 'running' || (status.windowEnd && status.status === 'idle')) &&
                                source !== 'notion' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            run({
                                                type: 'stopWork',
                                                source: source === 'git' ? 'git' : 'github',
                                                repositoryId
                                            })
                                        }
                                    >
                                        Pause this source
                                    </Button>
                                )}
                        </div>
                    )
                })}
            </div>
        </details>
    )
}
