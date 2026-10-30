import { providerRemote, remoteConfiguration } from './provider-accounts'

const record = (input: unknown): Record<string, unknown> | undefined =>
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined

/** Historical names are accepted only at the backup import seam. */
export function upgradeJournalBackup(input: unknown): unknown {
    const state = record(input)
    if (!state) return input
    const repositories = Array.isArray(state.repositories) ? state.repositories : []
    const activities = Array.isArray(state.activities)
        ? state.activities.map((input) => {
              const activity = record(input)
              if (!activity) return input
              const { prId, pullRequest, ...current } = activity
              const kind = activity.kind === 'pr' ? 'change-request' : activity.kind
              const repository = repositories.map(record).find((r) => r?.id === activity.repositoryId)
              const url =
                  typeof activity.url === 'string'
                      ? /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/(\d+)/.exec(activity.url)
                      : null
              const remote = url && providerRemote(url[1])
              const remoteSource =
                  activity.remoteSource ??
                  (remote && repository
                      ? {
                            ...remote,
                            number: Number(url[2]),
                            eventId:
                                kind === 'review'
                                    ? activity.url
                                    : kind === 'commit'
                                      ? activity.sha
                                      : `${url[2]}:${kind}`,
                            configuration: remoteConfiguration({
                                remote:
                                    typeof repository.remote === 'string' &&
                                    providerRemote(repository.remote)?.path === remote.path &&
                                    providerRemote(repository.remote)?.host === remote.host
                                        ? repository.remote
                                        : url[1],
                                emails: Array.isArray(repository.emails) ? (repository.emails as string[]) : []
                            })
                        }
                      : undefined)
              let revisionSource = activity.revisionSource
              if (!revisionSource && typeof activity.sourceVersion === 'string') {
                  try {
                      const value: unknown = JSON.parse(activity.sourceVersion)
                      if (Array.isArray(value) && typeof value[1] === 'string' && typeof value[2] === 'string')
                          revisionSource = {
                              base: value[1],
                              head: value[2],
                              mergedAt: typeof value[3] === 'string' ? value[3] : null,
                              integrationSha: typeof value[4] === 'string' ? value[4] : null
                          }
                  } catch {
                      /* Malformed historical cache data is not revision proof. */
                  }
              }
              return {
                  ...current,
                  kind,
                  changeRequestId: activity.changeRequestId ?? prId,
                  changeRequest: activity.changeRequest ?? pullRequest,
                  remoteSource,
                  revisionSource
              }
          })
        : state.activities
    if (Array.isArray(activities))
        for (const value of activities) {
            const activity = record(value)
            if (!activity || activity.kind !== 'commit' || activity.remoteSource) continue
            const parent = activities.map(record).find((a) => a?.id === activity.changeRequestId)
            const source = record(parent?.remoteSource)
            if (source) activity.remoteSource = { ...source, eventId: activity.sha }
        }
    const revisions = Array.isArray(state.revisions)
        ? state.revisions.map((input) => {
              const revision = record(input)
              if (!revision) return input
              const { prId, ...current } = revision
              return { ...current, activityId: revision.activityId ?? prId }
          })
        : state.revisions
    const acquisition = record(state.acquisition)
    return {
        ...state,
        activities,
        revisions,
        acquisition:
            acquisition &&
            Object.fromEntries(
                Object.entries(acquisition).map(([key, value]) => [key.replace(/^github:/, 'remote:'), value])
            )
    }
}
