import { Context } from 'effect'
import { nextAcquisition } from '../shared/acquisition'
import type { State } from '../shared/model'

/** One session's admission policy. It never changes the user's refresh preferences. */
export class RecoveryAdmission {
    private paused: boolean
    private readonly resumed = new Set<string>()
    constructor(paused = false) {
        this.paused = paused
    }
    get normal() {
        return !this.paused
    }
    permits(source: 'git' | 'remote', repositoryId: string) {
        return !this.paused || this.resumed.has(`${source}:${repositoryId}`)
    }
    private admitted(key: string) {
        const separator = key.indexOf(':')
        const source = key.slice(0, separator)
        return source === 'git' || source === 'remote' ? this.permits(source, key.slice(separator + 1)) : this.normal
    }
    next(state: Parameters<typeof nextAcquisition>[0], now: number) {
        return nextAcquisition(
            this.normal
                ? state
                : {
                      ...state,
                      acquisition: Object.fromEntries(
                          Object.entries(state.acquisition ?? {}).filter(([key]) => this.admitted(key))
                      )
                  },
            now
        )
    }
    project(acquisition: State['acquisition']): NonNullable<State['acquisition']> {
        if (this.normal) return acquisition ?? {}
        const projected: NonNullable<State['acquisition']> = {}
        for (const [key, status] of Object.entries(acquisition ?? {}))
            projected[key] =
                /^(git|remote):/.test(key) && !this.admitted(key)
                    ? { ...status, status: 'cancelled', error: undefined, retryAt: undefined, pauseReason: undefined }
                    : status
        return projected
    }
    resume(source: 'git' | 'remote', repositoryId: string) {
        this.resumed.add(`${source}:${repositoryId}`)
    }
    continueNormally() {
        this.paused = false
    }
    pause() {
        this.paused = true
        this.resumed.clear()
    }
}
export class RecoveryPolicy extends Context.Reference<RecoveryPolicy>()('gitorian/RecoveryPolicy', {
    defaultValue: () => new RecoveryAdmission()
}) {}
