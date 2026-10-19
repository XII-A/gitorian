import { useEffect, useRef } from 'react'
import type { Command, Reply, State } from '../shared/model'
import { gitConfiguration, githubConfiguration } from '../shared/activity-history'

function missingSources(state: State, since: string) {
    return state.repositories.flatMap((repository) => {
        if (repository.removed) return []
        const sources = ['git']
        if (state.settings.githubLogin && /github\.com[:/]/.test(repository.remote)) sources.push('github')
        return sources.flatMap((source) => {
            const status = state.acquisition?.[`${source}:${repository.id}`]
            const configuration =
                source === 'git' ? gitConfiguration(repository, state) : githubConfiguration(repository, state)
            const missing =
                !status?.historySince || status.historySince > since || status.configuration !== configuration
            return missing ? [status] : []
        })
    })
}

/** Navigation reads the cache immediately and acquires missing coverage silently. */
export function useWeekHistory(
    state: State,
    run: (command: Command) => Promise<Reply | undefined>,
    since: string,
    disabled = false
) {
    const latest = useRef(state)
    latest.current = state
    const repositories = JSON.stringify(
        state.repositories
            .filter((repository) => !repository.removed)
            .map((repository) => [repository.id, repository.path, repository.remote, repository.emails])
    )
    const login = state.settings.githubLogin
    useEffect(() => {
        if (!disabled && missingSources(latest.current, since).length) void run({ type: 'loadWeek', since })
    }, [run, since, repositories, login, disabled])
    return (
        !disabled &&
        missingSources(state, since).some(
            (status) => status?.status === 'running' || (status?.status === 'idle' && !!status.windowEnd)
        )
    )
}
