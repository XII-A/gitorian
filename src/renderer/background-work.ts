import type { State } from '../shared/model'

export const activitySources = (state: State) => {
    const repositories = new Set(state.repositories.filter((repo) => !repo.removed).map((repo) => repo.id))
    return Object.entries(state.acquisition ?? {}).filter(
        ([key]) => key === 'notion' || repositories.has(key.slice(key.indexOf(':') + 1))
    )
}

export const activityUpdating = (state: State) =>
    activitySources(state).some(
        ([, status]) => status.status === 'running' || (status.status === 'idle' && !!status.windowEnd)
    )

export const actionableSources = (state: State) =>
    activitySources(state).filter(([, status]) => status.status !== 'idle' || !!status.error || !!status.windowEnd)

export const sourceProblems = (state: State) =>
    activitySources(state).filter(([, status]) => status.status !== 'cancelled' && !!status.error)

export const readableError = (error: string) => {
    if (/401|unauthorized|bad credentials|authentication/iu.test(error)) {
        return 'Your connection needs to be renewed. Reconnect in Settings.'
    }
    if (/rate.limit|429|throttl/iu.test(error)) {
        return 'The provider has limited requests. Try again when the limit resets.'
    }
    if (/403|forbidden|permission|access denied/iu.test(error)) {
        return 'Access was denied. Check your account permissions.'
    }
    if (/404|not found|no longer available|does not exist/iu.test(error)) {
        return 'The source could not be found. Check its location and access in Settings.'
    }
    if (/network|fetch failed|timeout|timed out|ENOTFOUND|ECONN/iu.test(error)) {
        return 'The source could not be reached. Check your connection and retry.'
    }
    if (/406|too large|size limit|unavailable.*diff|diff.*unavailable/iu.test(error)) {
        return 'These changes cannot be displayed here. Open the source to view them.'
    }
    return 'The request could not be completed. Retry or check the source in Settings.'
}
