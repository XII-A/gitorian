import { useMemo } from 'react'
import type { State } from '../shared/model'
import { projectActivityRange } from './activity-projection'

export function useActivityProjection(state: State, start: string, end: string) {
    const {
        activities,
        repositories,
        settings: { timezone }
    } = state
    return useMemo(
        () => projectActivityRange({ activities, repositories, settings: { timezone } }, start, end),
        [activities, repositories, timezone, start, end]
    )
}
