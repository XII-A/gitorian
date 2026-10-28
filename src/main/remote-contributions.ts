import { Context, Effect, Layer } from 'effect'
import { ProviderAccounts, ProviderAccountError } from './provider-accounts'
import { JournalStore } from './journal-context'
import { makeGitHub } from './github'
import type { ActivityScan, ContributionReader } from './contribution-reader'
import { makeGitLab } from './gitlab'
import { remoteConfiguration } from '../shared/provider-accounts'
import type { Activity, Repository } from '../shared/model'

export type RemoteContributions = ContributionReader
export const RemoteContributions = Context.GenericTag<RemoteContributions>('gitorian/RemoteContributions')
export const RemoteContributionsLive = Layer.effect(
    RemoteContributions,
    Effect.gen(function* () {
        const accounts = yield* ProviderAccounts
        const store = yield* JournalStore
        const use = <A>(
            repository: Repository,
            operation: (client: RemoteContributions) => Effect.Effect<A, Error>
        ): Effect.Effect<A, Error> =>
            Effect.scoped(
                Effect.gen(function* () {
                    const context = accounts.context(repository)
                    if (!context)
                        return yield* Effect.fail(
                            new ProviderAccountError('Choose or reconnect an account for this repository in Settings.')
                        )
                    let resolvedRepository = repository
                    if (repository.providerProjectId) {
                        const project = yield* accounts.request<{ full_name?: string; path_with_namespace?: string }>(
                            context.account.id,
                            context.account.provider === 'github'
                                ? `https://api.github.com/repositories/${repository.providerProjectId}`
                                : `https://gitlab.com/api/v4/projects/${repository.providerProjectId}`
                        )
                        const path = project.full_name ?? project.path_with_namespace
                        if (path)
                            resolvedRepository = { ...repository, remote: `https://${context.remote.host}/${path}` }
                    }
                    const client =
                        context.account.provider === 'github'
                            ? makeGitHub(
                                  <T>(
                                      url: string,
                                      init?: RequestInit,
                                      format?: 'json' | 'text',
                                      background?: boolean
                                  ) => accounts.request<T>(context.account.id, url, background, init, format)
                              )
                            : makeGitLab(
                                  <T>(path: string, background?: boolean) =>
                                      accounts.request<T>(
                                          context.account.id,
                                          `https://gitlab.com/api/v4/${path}`,
                                          background
                                      ),
                                  context.account.userId
                              )
                    const resolved: RemoteContributions = {
                        activities: (_repository, login, tracked, scan) =>
                            client.activities(resolvedRepository, login, tracked, scan),
                        files: (_repository, activity) => client.files(resolvedRepository, activity),
                        snapshot: (_repository, activity, background) =>
                            client.snapshot(resolvedRepository, activity, background),
                        commitDetails: (_repository, sha, includeDiff) =>
                            client.commitDetails(resolvedRepository, sha, includeDiff)
                    }
                    return yield* operation(resolved)
                })
            )
        const sameCurrentProject = (a: Activity, repository: Repository) =>
            !!a.remoteSource &&
            (a.remoteSource.projectId && repository.providerProjectId
                ? a.remoteSource.projectId === repository.providerProjectId
                : a.remoteSource.path === accounts.context(repository)?.remote.path)
        const activities: RemoteContributions['activities'] = (repository, _login, tracked, scan: ActivityScan = {}) =>
            Effect.gen(function* () {
                if (repository.accountId && !repository.providerProjectId) {
                    yield* accounts.resolve(repository.id)
                    repository = store.config.repositories.find((r) => r.id === repository.id) ?? repository
                }
                const context = accounts.context(repository)
                if (!context)
                    return yield* Effect.fail(
                        new ProviderAccountError('Choose or reconnect an account for this repository in Settings.')
                    )
                const existing = yield* Effect.tryPromise({
                    try: () => store.activities(repository.id),
                    catch: (e) => (e instanceof Error ? e : new Error(String(e)))
                })
                const normalize = (events: Activity[]) =>
                    events.map((event) => {
                        const number =
                            event.remoteSource?.number ??
                            (context.account.provider === 'github'
                                ? Number(/\/pull\/(\d+)/.exec(event.url ?? '')?.[1])
                                : Number(/\/merge_requests\/(\d+)/.exec(event.url ?? '')?.[1]))
                        const eventId =
                            event.kind === 'commit'
                                ? event.sha!
                                : event.kind === 'review'
                                  ? (/#(?:pullrequestreview-|review-|note_)(\d+)/.exec(event.url ?? '')?.[1] ??
                                    event.id.split(':').at(-1)!)
                                  : `${number}:${event.kind}`
                        const sameProject = (a: Activity) =>
                            a.remoteSource?.provider === context.remote.provider &&
                            (a.remoteSource.projectId && repository.providerProjectId
                                ? a.remoteSource.projectId === repository.providerProjectId
                                : a.remoteSource.path === context.remote.path)
                        const prior = existing.find(
                            (a) =>
                                a.kind === event.kind &&
                                ((a.remoteSource?.eventId === eventId && sameProject(a)) ||
                                    (!a.remoteSource?.projectId &&
                                        a.url === event.url &&
                                        (event.kind !== 'commit' || a.sha === event.sha)))
                        )
                        const parent = existing.find(
                            (a) =>
                                a.kind === 'change-request' &&
                                ((sameProject(a) && a.remoteSource?.number === number) ||
                                    (!a.remoteSource?.projectId && a.url === event.url?.split('#')[0]))
                        )
                        const parentId =
                            parent?.id ??
                            `${repository.id}:${context.remote.provider}:${repository.providerProjectId ?? context.remote.path}:${number}:change-request`
                        return {
                            ...event,
                            changeRequestId: parentId,
                            id:
                                prior?.id ??
                                (event.kind === 'commit'
                                    ? event.id
                                    : event.kind === 'change-request'
                                      ? parentId
                                      : `${parentId}:${event.kind}:${eventId}`),
                            remoteSource: {
                                ...context.remote,
                                projectId: repository.providerProjectId,
                                number: number || undefined,
                                eventId,
                                configuration: remoteConfiguration(repository),
                                accountId: context.account.id,
                                sessionGeneration: context.account.generation
                            }
                        }
                    })
                const trackedIds = existing
                    .filter(
                        (a) =>
                            a.kind === 'change-request' &&
                            !!a.remoteSource &&
                            sameCurrentProject(a, repository) &&
                            a.remoteSource.configuration === remoteConfiguration(repository)
                    )
                    .map((a) => (a.remoteSource?.number ? `${repository.id}:pr:${a.remoteSource.number}` : a.id))
                const result = yield* use(repository, (client) =>
                    client.activities(repository, context.account.username, trackedIds, {
                        ...scan,
                        batch: scan.batch ? (batch) => scan.batch!(normalize(batch)) : undefined
                    })
                )
                return normalize(result)
            })
        const original = (repository: Repository, activity: Activity) =>
            activity.remoteSource
                ? {
                      ...repository,
                      providerProjectId: activity.remoteSource.projectId,
                      remote: `https://${activity.remoteSource.host}/${activity.remoteSource.path}`
                  }
                : repository
        return {
            activities,
            files: (repository, activity) =>
                use(original(repository, activity), (client) => client.files(original(repository, activity), activity)),
            snapshot: (repository, activity, background) =>
                use(original(repository, activity), (client) =>
                    client.snapshot(original(repository, activity), activity, background)
                ),
            commitDetails: (repository, sha, includeDiff) =>
                use(repository, (client) => client.commitDetails(repository, sha, includeDiff))
        }
    })
)
