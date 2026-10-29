import { useEffect, useRef, useState } from 'react'
import { ConnectionSignIn, type ConnectionFeedback } from './ConnectionSignIn'
import { AccountAvatar, ProviderLogo } from './ProviderIdentity'
import './provider-panels.css'
import { providerName, type Provider } from '../shared/provider-accounts'
import type { Command, Reply, State } from '../shared/model'

export function ProviderConnections({
    state,
    refresh
}: {
    state: State
    refresh: (command: Command) => Promise<Reply | undefined>
}) {
    const [busyAccountId, setBusyAccountId] = useState<string>()
    const [keyboard, setKeyboard] = useState(false)
    const [handoff, setHandoff] = useState<string>()
    const [attempt, setAttempt] = useState<
        NonNullable<Reply['providerAttempt']> & { provider: Provider; accountId?: string }
    >()
    const [busy, setBusy] = useState<Provider>()
    const [feedback, setFeedback] = useState<{ provider: Provider; accountId?: string; value: ConnectionFeedback }>()
    const [notice, setNotice] = useState('')
    const attemptAccounts = useRef(state.accounts)
    const generation = useRef(0)
    const addButtons = useRef<Partial<Record<Provider, HTMLDivElement>>>({})
    const current = useRef(attempt)
    current.current = attempt
    const refreshRef = useRef(refresh)
    refreshRef.current = refresh
    const cancel = (restoreFocus = true) => {
        generation.current++
        const provider = current.current?.provider
        if (restoreFocus && provider)
            requestAnimationFrame(() =>
                addButtons.current[provider]?.querySelector<HTMLButtonElement>('[data-face="idle"] button')?.focus()
            )
        const id = current.current?.id
        current.current = undefined
        setAttempt(undefined)
        setBusy(undefined)
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
                    const reply = await refreshRef.current({ type: 'state' })
                    if (cancelled || current.current?.id !== attempt.id) return
                    const added = reply?.state?.accounts.find(
                        (a) =>
                            a.provider === attempt.provider &&
                            (a.id === attempt.accountId || !attemptAccounts.current.some((old) => old.id === a.id))
                    )
                    setHandoff(added?.id ?? attempt.accountId)
                    setFeedback({
                        provider: attempt.provider,
                        accountId: attempt.accountId,
                        value: { kind: 'success', login: added?.username ?? '' }
                    })
                    setAttempt(undefined)
                    setNotice('')
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
    useEffect(() => {
        if (feedback?.value.kind !== 'success') return
        const timer = setTimeout(() => setFeedback(undefined), 900)
        return () => clearTimeout(timer)
    }, [feedback])
    const begin = async (provider: Provider, accountId?: string) => {
        attemptAccounts.current = state.accounts.filter((account) => account.status !== 'disconnected')
        setHandoff(undefined)
        cancel(false)
        const started = generation.current
        setBusy(provider)
        setBusyAccountId(accountId)
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
            if (started !== generation.current) return
            setFeedback({ provider, accountId, value: { kind: 'error', message: 'Could not connect' } })
            setNotice('Check your connection and try again.')
        } finally {
            if (started === generation.current) setBusy(undefined)
        }
    }
    const signIn = (provider: Provider, account?: State['accounts'][number]) => {
        const connected = !!account && ['connected', 'session'].includes(account.status)
        const matches = (target?: { provider: Provider; accountId?: string }) =>
            target?.provider === provider && target.accountId === account?.id
        return (
            <ConnectionSignIn
                provider={providerName(provider)}
                connected={connected}
                idleLabel={account ? 'Reconnect' : '+ Add account'}
                idleActionLabel={account ? `Reconnect @${account.username}` : `Add ${providerName(provider)} account`}
                device={matches(attempt) ? attempt : undefined}
                feedback={matches(feedback) ? feedback?.value : undefined}
                notice={matches(attempt) || matches(feedback) ? notice : undefined}
                pending={busy === provider && busyAccountId === account?.id}
                openingBrowser={false}
                disabled={
                    (!!busy || !!attempt) && !matches(attempt) && !(busy === provider && busyAccountId === account?.id)
                }
                disconnectLabel={account ? `Disconnect @${account.username}` : undefined}
                disconnectPrompt={
                    account ? (
                        <span className="settings-disconnect-question">Disconnect @{account.username}?</span>
                    ) : undefined
                }
                onStart={() => begin(provider, account?.id)}
                onCancel={() => cancel()}
                onOpen={async () => {
                    if (!attempt) return
                    try {
                        await window.journal.invoke({ type: 'open', url: attempt.url })
                        setNotice('')
                    } catch {
                        setNotice(`Could not open your browser. Open ${attempt.url} and enter the code.`)
                    }
                }}
                onDisconnect={async () => {
                    if (!account) return
                    await window.journal.invoke({ type: 'providerDisconnect', accountId: account.id })
                    await refreshRef.current({ type: 'state' })
                }}
            />
        )
    }
    const accountRows = (provider: Provider) => {
        const visibleAccounts = state.accounts.filter(
            (account) =>
                account.provider === provider &&
                account.status !== 'disconnected' &&
                !(account.id === handoff && feedback?.value.kind === 'success' && !feedback.accountId)
        )
        if (!visibleAccounts.length) return null
        return (
            <div className="provider-account-list">
                {visibleAccounts.map((account) => {
                    const detail = account.status === 'session' ? 'This session only' : account.emails[0]
                    return (
                        <div className="provider-account-row" key={account.id}>
                            <div className="provider-account-profile">
                                <AccountAvatar account={account} />
                                <span>
                                    <strong title={`@${account.username}`}>@{account.username}</strong>
                                    <span className="provider-account-status" title={detail}>
                                        {detail}
                                    </span>
                                </span>
                            </div>
                            <div className="provider-account-actions">{signIn(provider, account)}</div>
                        </div>
                    )
                })}
            </div>
        )
    }
    const addControl = (provider: Provider) => (
        <div
            className="account-add-control"
            ref={(node) => {
                if (node) addButtons.current[provider] = node
            }}
        >
            {signIn(provider)}
        </div>
    )
    return (
        <div
            className="provider-connections provider-panels"
            data-keyboard={keyboard}
            onPointerDownCapture={() => setKeyboard(false)}
            onKeyDownCapture={() => setKeyboard(true)}
        >
            <header className="provider-connections-heading">
                <h2>Accounts</h2>
            </header>
            {(['github', 'gitlab'] as const).map((provider) => (
                <section
                    className="settings-section account-provider"
                    aria-label={`${providerName(provider)} accounts`}
                    key={provider}
                >
                    <div className="settings-section-heading account-provider-heading">
                        <h3>
                            <ProviderLogo provider={provider} />
                            <span>{providerName(provider)}</span>
                        </h3>
                        {addControl(provider)}
                    </div>
                    {accountRows(provider)}
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
