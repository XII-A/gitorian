import { providerRemote } from './provider-accounts'
import type { State } from './model'

export function nextAcquisition(state: Pick<State, 'repositories' | 'acquisition' | 'accounts'>, now: number) {
    return (
        Object.entries(state.acquisition ?? {})
            .filter(
                ([key, status]) =>
                    /^(git|remote):/.test(key) &&
                    state.repositories.some(
                        (r) =>
                            key.endsWith(`:${r.id}`) &&
                            !r.removed &&
                            (key.startsWith('git:') ||
                                state.accounts.some(
                                    (account) =>
                                        ['connected', 'session'].includes(account.status) &&
                                        account.provider === providerRemote(r.remote)?.provider &&
                                        (!r.accountId || r.accountId === account.id)
                                ))
                    ) &&
                    ((status.status === 'idle' && !!status.windowEnd) ||
                        (status.status === 'paused' && !!status.retryAt && Date.parse(status.retryAt) <= now))
            )
            // Complete staged pages before offering their account slots to queued sources.
            .sort(
                (a, b) =>
                    Number(!!b[1].pending) - Number(!!a[1].pending) ||
                    (a[1].lastProgressAt ?? 0) - (b[1].lastProgressAt ?? 0)
            )[0]
    )
}
