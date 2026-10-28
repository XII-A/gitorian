import { useEffect, useRef, useState } from 'react'
import { Button } from './components/arc/button/button'
import { ConnectionSignIn, type ConnectionFeedback } from './ConnectionSignIn'
import { providerName, type Provider } from '../shared/provider-accounts'
import type { Command, Reply, State } from '../shared/model'

export function ProviderConnections({
    state,
    refresh
}: {
    state: State
    refresh: (command: Command) => Promise<Reply | undefined>
}) {
    const [attempt, setAttempt] = useState<
        NonNullable<Reply['providerAttempt']> & { provider: Provider; accountId?: string }
    >()
    const [busy, setBusy] = useState<Provider>()
    const [feedback, setFeedback] = useState<{ provider: Provider; accountId?: string; value: ConnectionFeedback }>()
    const [notice, setNotice] = useState('')
    const generation = useRef(0)
    const addButtons = useRef<Partial<Record<Provider, HTMLButtonElement>>>({})
    const current = useRef(attempt)
    current.current = attempt
    const refreshRef = useRef(refresh)
    refreshRef.current = refresh
    const cancel = (restoreFocus = true) => {
        generation.current++
        const provider = current.current?.provider
        if (restoreFocus && provider) requestAnimationFrame(() => addButtons.current[provider]?.focus())
        const id = current.current?.id
        current.current = undefined
        setAttempt(undefined)
        setFeedback(undefined)
        setNotice('')
        if (id) void window.journal.invoke({ type: 'providerCancel', attemptId: id }).catch(() => undefined)
    }
    useEffect(
        () => () => {
            generation.current++
            const id = current.current?.id
            if (id) void window.journal.invoke({ type: 'providerCancel', attemptId: id }).catch(() => undefined)
        },
        []
    )
    useEffect(() => {
        if (!attempt) return
        let cancelled = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const result = await window.journal.invoke({ type: 'providerPoll', attemptId: attempt.id })
                if (cancelled || current.current?.id !== attempt.id) return
                if (result.devicePending) timer = setTimeout(() => void poll(), result.devicePending.interval * 1000)
                else {
                    setAttempt(undefined)
                    setNotice('Account connected. Repositories with a clear match use it automatically.')
                    await refreshRef.current({ type: 'state' })
                }
            } catch (error) {
                if (cancelled || current.current?.id !== attempt.id) return
                setAttempt(undefined)
                void window.journal.invoke({ type: 'providerCancel', attemptId: attempt.id }).catch(() => undefined)
                setFeedback({
                    provider: attempt.provider,
                    accountId: attempt.accountId,
                    value: {
                        kind: /expired/i.test(error instanceof Error ? error.message : '') ? 'expired' : 'error',
                        message: /expired/i.test(error instanceof Error ? error.message : '')
                            ? 'Code expired'
                            : 'Could not connect'
                    }
                })
                setNotice(
                    error instanceof Error && /different account|expired|declined/.test(error.message)
                        ? error.message
                        : 'Check your connection and try signing in again.'
                )
            }
        }
        timer = setTimeout(() => void poll(), attempt.interval * 1000)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [attempt])
    const begin = async (provider: Provider, accountId?: string) => {
        cancel(false)
        const started = generation.current
        setBusy(provider)
        try {
            const result = await window.journal.invoke({ type: 'providerBegin', provider, accountId })
            if (started !== generation.current) {
                if (result.providerAttempt)
                    await window.journal.invoke({ type: 'providerCancel', attemptId: result.providerAttempt.id })
                return
            }
            if (!result.providerAttempt) throw new Error('The provider did not return a sign-in code.')
            setAttempt({ ...result.providerAttempt, provider, accountId })
            setNotice(result.message ?? '')
        } catch {
            setFeedback({ provider, accountId, value: { kind: 'error', message: 'Could not connect' } })
            setNotice('Check your connection and try again.')
        } finally {
            setBusy(undefined)
        }
    }
    return (
        <div className="provider-connections">
            {(['github', 'gitlab'] as const).map((provider) => (
                <section className="settings-section" aria-label={`${providerName(provider)} accounts`} key={provider}>
                    <div className="settings-section-heading">
                        <h3>{providerName(provider)}</h3>
                        <Button
                            ref={(node) => {
                                if (node) addButtons.current[provider] = node
                            }}
                            variant="ghost"
                            size="sm"
                            disabled={!!busy || !!attempt}
                            onClick={() => begin(provider)}
                        >
                            Add {providerName(provider)} account
                        </Button>
                    </div>
                    <div className="provider-account-list">
                        {state.accounts
                            .filter((a) => a.provider === provider)
                            .map((account) => (
                                <div className="provider-account-row" key={account.id}>
                                    <div className="provider-account-profile">
                                        <span className="settings-github-avatar" aria-hidden="true">
                                            {account.username.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span>
                                            <strong>@{account.username}</strong>
                                            <span className="provider-account-status">
                                                {account.status === 'connected'
                                                    ? 'Connected'
                                                    : account.status === 'session'
                                                      ? 'Connected for this session'
                                                      : 'Reconnect to refresh activity'}
                                            </span>
                                        </span>
                                    </div>
                                    <div className="provider-account-actions">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={!!busy || !!attempt}
                                            onClick={() => begin(provider, account.id)}
                                        >
                                            Reconnect<span className="sr-only"> @{account.username}</span>
                                        </Button>
                                        {['connected', 'session'].includes(account.status) && (
                                            <ConnectionSignIn
                                                provider={providerName(provider)}
                                                disconnectLabel={`Disconnect @${account.username}`}
                                                disconnectPrompt={
                                                    <span>
                                                        Disconnect @{account.username}?{' '}
                                                        <span className="settings-hint">
                                                            {state.repositories
                                                                .filter((r) => r.accountId === account.id && !r.removed)
                                                                .map((r) => r.name)
                                                                .join(', ') || 'No tracked repositories'}
                                                            . Cached activity and drafts are kept.
                                                        </span>
                                                    </span>
                                                }
                                                connected
                                                pending={false}
                                                openingBrowser={false}
                                                disabled={!!busy || !!attempt}
                                                onStart={() => begin(provider, account.id)}
                                                onCancel={() => undefined}
                                                onOpen={() => undefined}
                                                onDisconnect={async () => {
                                                    await window.journal.invoke({
                                                        type: 'providerDisconnect',
                                                        accountId: account.id
                                                    })
                                                    await refreshRef.current({ type: 'state' })
                                                }}
                                                notice={`${state.repositories.filter((r) => r.accountId === account.id && !r.removed).length} repositories use this account. Cached activity and drafts are kept.`}
                                            />
                                        )}
                                    </div>
                                </div>
                            ))}
                        {!state.accounts.some((a) => a.provider === provider) && (
                            <p className="settings-hint">
                                Connect an account to track{' '}
                                {provider === 'github'
                                    ? 'pull requests and reviews'
                                    : 'merge requests and review comments'}
                                .
                            </p>
                        )}
                    </div>
                    {(attempt?.provider === provider || feedback?.provider === provider || busy === provider) && (
                        <ConnectionSignIn
                            provider={providerName(provider)}
                            connected={false}
                            device={attempt?.provider === provider ? attempt : undefined}
                            feedback={feedback?.provider === provider ? feedback.value : undefined}
                            notice={notice}
                            pending={busy === provider}
                            openingBrowser={false}
                            disabled={!!busy}
                            onStart={() =>
                                begin(provider, feedback?.provider === provider ? feedback.accountId : undefined)
                            }
                            onCancel={() => cancel()}
                            onDisconnect={() => Promise.resolve()}
                            onOpen={async () => {
                                if (!attempt) return
                                try {
                                    await window.journal.invoke({ type: 'open', url: attempt.url })
                                    setNotice('')
                                } catch {
                                    setNotice(`Could not open your browser. Open ${attempt.url} and enter the code.`)
                                }
                            }}
                        />
                    )}
                </section>
            ))}
            {notice && !attempt && (
                <p role={feedback ? 'alert' : 'status'} className="settings-hint">
                    {notice}
                </p>
            )}
        </div>
    )
}
