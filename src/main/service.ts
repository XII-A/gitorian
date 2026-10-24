import { randomUUID } from 'node:crypto'
import { basename, relative } from 'node:path'
import { Effect } from 'effect'
import { commits, indexCommits, commitDetails, inspectRepository, git, githubRemote } from './git'
import { HttpError } from './http'
import { discoverRepositories, repositoryPathKey } from './repository-discovery'
import { localDate, weekOf } from '../shared/model'
import type { Activity, Command, Reply, Repository, RepositoryImportProgress, Selection, State } from '../shared/model'
import type { Store } from './store'
import type { GitHub } from './github'
import type { Notion } from './notion'
import { forEachConcurrent, WorkQueue } from './work-queue'
import { filesFromDiff } from './diff-files'
import { hasFileStatistics } from '../shared/change-statistics'
import { isCombinedDiff } from '../shared/diff-format'
import { imageIds } from '../shared/images'
import { gitConfiguration, githubConfiguration } from '../shared/activity-history'

export class JournalService {
    private refreshes = new Map<string, Promise<void>>()
    private acquiring = new Map<string, Promise<void>>()
    private acquisitionLanes = { git: new WorkQueue(2), github: new WorkQueue(2) }
    private details = new Map<string, Promise<void>>()
    private importing = false
    private repositoryScan?: { id: string; paths: string[]; unreadable: string[] }
    private importStopped = false
    private closing = false

    prepareToClose(): () => void {
        this.closing = true
        this.importStopped = true
        for (const status of Object.values(this.store.state.acquisition ?? {}))
            if (status.status === 'running') status.status = 'cancelled'
        return () => {
            this.closing = false
        }
    }
    constructor(
        readonly store: Store,
        private readonly github: GitHub,
        private readonly notion: Notion,
        private readonly connections: () => Reply['connections']
    ) {}
    reply(extra: Partial<Reply> = {}, state = this.store.snapshot()): Reply {
        return { state, connections: this.connections(), ...extra }
    }
    execute(command: Command): Effect.Effect<Reply, Error> {
        return Effect.tryPromise({
            try: () => this.handle(command),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
    }
    async addRepository(path: string, persist = true): Promise<void> {
        const inspected = await inspectRepository(path)
        if (
            this.store.state.repositories.some(
                (repository) => repositoryPathKey(repository.path) === repositoryPathKey(inspected.path)
            )
        )
            throw new Error('This repository is already tracked')
        this.store.state.repositories.push({
            id: randomUUID(),
            name: inspected.name,
            path: inspected.path,
            remote: '',
            base: inspected.base,
            emails: inspected.email ? [inspected.email] : [],
            trackingStart: weekOf(new Date(), this.store.state.settings),
            available: true,
            removed: false,
            branchBases: {},
            branches: inspected.branches,
            remotes: inspected.remotes
        })
        if (persist) this.store.persist()
    }
    async scanRepositories(folder: string, onProgress?: (progress: RepositoryImportProgress) => void): Promise<Reply> {
        onProgress?.({ stage: 'discovering', scanned: 0, found: 0 })
        const discovered = await discoverRepositories(folder, (counts) =>
            onProgress?.({ stage: 'discovering', ...counts })
        )
        const id = randomUUID()
        this.repositoryScan = { id, ...discovered }
        return this.reply({
            repositoryScan: {
                id,
                folder,
                unreadable: discovered.unreadable,
                repositories: discovered.paths.map((path) => {
                    const tracked = this.store.state.repositories.find(
                        (item) => repositoryPathKey(item.path) === repositoryPathKey(path)
                    )
                    return {
                        path,
                        name: basename(path),
                        relativePath: relative(folder, path) || '.',
                        status: tracked ? (tracked.removed || !tracked.available ? 'stopped' : 'tracked') : 'new'
                    }
                })
            }
        })
    }
    async importRepositories(
        scanId: string,
        paths: string[],
        onProgress?: (progress: RepositoryImportProgress) => void
    ): Promise<Reply> {
        if (this.importing) return this.reply({ message: 'A repository import is already running.' })
        const scan = this.repositoryScan
        if (!scan || scan.id !== scanId) throw new Error('This folder scan has expired. Choose the folder again.')
        const requested = new Set(paths.map(repositoryPathKey))
        if (
            !requested.size ||
            [...requested].some((path) => !scan.paths.some((item) => repositoryPathKey(item) === path))
        )
            throw new Error('Select repositories from the scanned folder.')
        const discovered = {
            paths: scan.paths.filter((path) => requested.has(repositoryPathKey(path))),
            unreadable: scan.unreadable
        }
        this.repositoryScan = undefined
        this.importing = true
        this.importStopped = false
        const importId = randomUUID()
        this.store.state.repositoryImport = { id: importId, status: 'running', completed: 0, total: 0 }
        this.store.persist()
        try {
            let added = 0
            let existing = 0
            let restored = 0
            const skippedItems = discovered.unreadable.map((path) => ({
                path,
                reason: 'Folder could not be read. Check its permissions.'
            }))
            let skipped = discovered.unreadable.length
            let completed = 0
            onProgress?.({ stage: 'processing', completed, total: discovered.paths.length })
            this.store.state.repositoryImport = {
                id: importId,
                status: 'running',
                completed,
                total: discovered.paths.length
            }
            this.store.persist()
            await forEachConcurrent(discovered.paths, 2, async (path) => {
                if (this.importStopped) return
                const tracked = this.store.state.repositories.find(
                    (item) => repositoryPathKey(item.path) === repositoryPathKey(path)
                )
                try {
                    if (tracked) {
                        if (tracked.removed || !tracked.available) {
                            const inspected = await inspectRepository(path)
                            Object.assign(tracked, {
                                path: inspected.path,
                                available: true,
                                removed: false,
                                branches: inspected.branches,
                                remotes: inspected.remotes
                            })
                            restored++
                        } else existing++
                    } else {
                        await this.addRepository(path, false)
                        added++
                    }
                } catch (error) {
                    skippedItems.push({ path, reason: error instanceof Error ? error.message : String(error) })
                    skipped++
                }
                completed++
                this.store.state.repositoryImport = {
                    id: importId,
                    status: 'running',
                    completed,
                    total: discovered.paths.length
                }
                if (completed % 4 === 0) this.store.persist()
                onProgress?.({ stage: 'processing', completed, total: discovered.paths.length })
            })
            const messages = [`Added ${added} ${added === 1 ? 'repository' : 'repositories'}.`]
            if (!discovered.paths.length) messages[0] = 'No Git repositories found in this folder.'
            if (restored) messages.push(`Resumed tracking ${restored}.`)
            if (existing) messages.push(`${existing} already tracked.`)
            if (skipped) messages.push(`${skipped} unreadable or invalid folders skipped.`)
            if (this.importStopped) messages.push('Import stopped. Add the folder again to continue.')
            this.store.state.repositoryImport = {
                id: importId,
                skipped,
                skippedItems,
                status: this.importStopped ? 'cancelled' : 'done',
                completed,
                total: discovered.paths.length,
                message: messages.join(' ')
            }
            this.store.persist()
            return this.reply({ message: messages.join(' ') })
        } finally {
            this.importing = false
        }
    }
    stopWork(source: 'git' | 'github' | 'repositories', repositoryId?: string): void {
        if (source === 'repositories') this.importStopped = true
        else
            for (const [key, status] of Object.entries(this.store.state.acquisition ?? {})) {
                if (key.startsWith(`${source}:`) && (!repositoryId || key === `${source}:${repositoryId}`)) {
                    status.status = 'cancelled'
                    status.error = undefined
                }
            }
        this.store.persist()
    }
    private checkStopped(status: NonNullable<State['acquisition']>[string]): void {
        if (this.isStopped(status)) throw new Error('Paused by you. Completed work is kept.')
    }
    private isStopped(status: NonNullable<State['acquisition']>[string]): boolean {
        return status.status === 'cancelled'
    }
    private repository(id: string): Repository {
        const repository = this.store.state.repositories.find((item) => item.id === id)
        if (!repository) throw new Error('Repository is no longer available')
        return repository
    }
    private activity(id: string): Activity {
        const activity = this.store.state.activities.find((item) => item.id === id)
        if (!activity) throw new Error('Work is no longer available')
        return activity
    }
    private mergeActivity(incoming: Activity): void {
        this.mergeActivities([incoming])
    }
    private mergeActivities(items: Activity[]): void {
        const state = this.store.state
        const activities = new Map(state.activities.map((item) => [item.id, item]))
        for (const incoming of items) {
            const current = activities.get(incoming.id)
            if (!current) {
                state.activities.push(incoming)
                activities.set(incoming.id, incoming)
            } else
                Object.assign(current, incoming, {
                    disposition: current.disposition,
                    deferUntil: current.deferUntil,
                    reason: current.reason,
                    explicit: current.explicit,
                    revision: incoming.revision ?? current.revision,
                    fingerprint: incoming.fingerprint ?? current.fingerprint,
                    deletedBranches: current.deletedBranches,
                    branches: [...new Set([...current.branches, ...incoming.branches])],
                    files: incoming.filesLoaded ? incoming.files : current.files,
                    filesLoaded:
                        current.filesLoaded &&
                        (!incoming.sourceVersion || incoming.sourceVersion === current.sourceVersion)
                })
        }
    }
    private async capture(activity: Activity, retainDiff = true, persist = true): Promise<string> {
        const state = this.store.state
        const version = activity.sourceVersion
        const snapshot = await this.github.snapshot(this.repository(activity.repositoryId), activity, !persist)
        if (state !== this.store.state)
            throw new Error('Local data was restored while loading. Open the activity again.')
        if (version !== activity.sourceVersion)
            throw new Error('Activity changed while loading. Select it again to load the current revision.')
        const prior = snapshot.fingerprint
            ? state.revisions.find(
                  (revision) => revision.prId === activity.id && revision.fingerprint === snapshot.fingerprint
              )
            : state.revisions.find(
                  (revision) =>
                      revision.prId === activity.id &&
                      revision.base === snapshot.base &&
                      revision.head === snapshot.head
              )
        const id = prior?.id ?? randomUUID()
        if (!prior) state.revisions.push({ id, prId: activity.id, ...snapshot, diff: retainDiff ? snapshot.diff : '' })
        else if (retainDiff) prior.diff = snapshot.diff
        Object.assign(activity, { revision: id, fingerprint: snapshot.fingerprint, head: snapshot.head })
        if (retainDiff) {
            state.diffs[activity.id] = snapshot.diff
            activity.diffRevision = id
            if (!hasFileStatistics(activity)) {
                const files = filesFromDiff(snapshot.diff)
                if (files !== undefined) {
                    activity.files = files
                    activity.filesLoaded = true
                }
            }
        }
        if (persist) this.store.persist()
        return id
    }
    private status(key: string): NonNullable<State['acquisition']>[string] {
        const state = this.store.state
        state.acquisition ??= {}
        return (state.acquisition[key] ??= { status: 'idle' })
    }
    private async serializeSource(key: string, work: () => Promise<void>): Promise<void> {
        const previous = this.acquiring.get(key)
        const pending = previous ? previous.then(work, work) : work()
        this.acquiring.set(key, pending)
        try {
            await pending
        } finally {
            if (this.acquiring.get(key) === pending) this.acquiring.delete(key)
        }
    }
    async refresh(
        options: {
            repositoryId?: string
            source?: 'git' | 'github' | 'notion'
            resume?: boolean
            since?: string
            missingOnly?: boolean
        } = {}
    ): Promise<void> {
        if (this.closing) return
        const state = this.store.state
        // Import and settings changes can arrive while an earlier scan is running.
        // Only coalesce callers whose requested source set and configuration match.
        const sources = state.repositories
            .filter(
                (repository) => !repository.removed && (!options.repositoryId || repository.id === options.repositoryId)
            )
            .map((repository) => [
                repository.id,
                gitConfiguration(repository, state),
                githubConfiguration(repository, state)
            ])
        const key = JSON.stringify([
            options.repositoryId,
            options.source,
            !!options.resume,
            options.since,
            !!options.missingOnly,
            state.settings.timezone,
            state.restoreId,
            sources
        ])
        const existing = this.refreshes.get(key)
        if (existing) return existing
        const refresh = this.refreshSources(options).finally(() => {
            this.refreshes.delete(key)
        })
        this.refreshes.set(key, refresh)
        return refresh
    }
    async backfill(repositoryId: string, since: string): Promise<void> {
        const repository = this.repository(repositoryId)
        if (since > repository.trackingStart) throw new Error('Choose a date before the current history start.')
        await this.refresh({ repositoryId, since, resume: true })
    }
    private async source(key: string, work: () => Promise<void>, resume = false): Promise<void> {
        const status = this.status(key)
        if (this.isStopped(status) && !resume) return
        if (status.retryAt && Date.parse(status.retryAt) > Date.now()) return
        status.status = 'running'
        status.error = undefined
        status.retryAt = undefined
        this.store.persist()
        try {
            await work()
            this.checkStopped(status)
            status.status = 'idle'
            if (!status.windowEnd) status.lastSuccess = new Date().toISOString()
        } catch (error) {
            if (!this.isStopped(status))
                status.status = error instanceof HttpError && error.retryAt ? 'paused' : 'error'
            status.error = this.isStopped(status) ? undefined : error instanceof Error ? error.message : String(error)
            status.retryAt =
                error instanceof HttpError && error.retryAt ? new Date(error.retryAt).toISOString() : undefined
        }
        this.store.persist()
    }
    private async refreshSources(options: {
        repositoryId?: string
        source?: 'git' | 'github' | 'notion'
        resume?: boolean
        since?: string
        missingOnly?: boolean
    }): Promise<void> {
        const state = this.store.state
        const repositories = state.repositories.filter(
            (item) => !item.removed && (!options.repositoryId || item.id === options.repositoryId)
        )
        if (options.since && options.source !== 'notion') {
            for (const repository of repositories) {
                if (options.since >= repository.trackingStart) continue
                repository.trackingStart = options.since
            }
            this.store.persist()
        }
        if (options.missingOnly && options.since) {
            for (const repository of repositories) {
                const history = this.store.gitHistory(repository.id)
                if (!history || history.configuration !== gitConfiguration(repository, state)) continue
                this.mergeActivities(
                    history.items.filter(
                        (activity) => localDate(new Date(activity.date), state.settings.timezone) >= options.since!
                    )
                )
                if (!history.nextOffset) {
                    const status = this.status(`git:${repository.id}`)
                    status.historySince = repository.trackingStart
                    status.historyTimezone = state.settings.timezone
                    status.configuration = history.configuration
                }
            }
            this.store.persist()
        }
        if (!options.missingOnly && !options.repositoryId && !options.source) {
            state.lastRefreshAttempt = new Date().toISOString()
            this.store.persist()
        }
        let acquired = false
        const acquire = async (key: string, work: () => Promise<void>) => {
            const perform = async () => {
                if (this.closing || state !== this.store.state) return
                const status = this.status(key)
                const [source, id] = key.split(':')
                const repository = this.repository(id)
                if (repository.removed) return
                const configuration =
                    source === 'git' ? gitConfiguration(repository, state) : githubConfiguration(repository, state)
                if (
                    options.missingOnly &&
                    options.since &&
                    status.historySince &&
                    status.historySince <= options.since &&
                    status.historyTimezone === state.settings.timezone &&
                    status.configuration === configuration
                )
                    return
                do {
                    acquired = true
                    // Admit one batch at a time so large histories rejoin the queue
                    // behind repositories that have not received their first batch.
                    const lane = key.startsWith('git:') ? this.acquisitionLanes.git : this.acquisitionLanes.github
                    await lane.run(async () => {
                        if (this.closing || repository.removed || state !== this.store.state) return
                        await this.source(key, work, options.resume)
                    })
                } while (
                    options.since &&
                    status.windowEnd &&
                    status.status === 'idle' &&
                    !this.closing &&
                    !repository.removed &&
                    state === this.store.state
                )
            }
            // Serialize only the same repository/provider. A slow remote source must
            // never hold local history or another provider behind a global refresh.
            await this.serializeSource(key, perform)
        }
        // Local Git, GitHub and Notion have independent worker admission.
        const notion =
            !options.missingOnly &&
            !options.repositoryId &&
            (!options.source || options.source === 'notion') &&
            this.connections().notion
                ? this.serializeSource('notion', () =>
                      this.source('notion', async () => {
                          if (this.closing || state !== this.store.state) return
                          const ids = new Set([
                              ...state.saves.filter((save) => save.status === 'confirmed').map((save) => save.entryId),
                              ...state.drafts.map((draft) => draft.publishedEntryId)
                          ])
                          for (const id of ids) {
                              if (!id) continue
                              const entry = await this.notion.refreshEntry(id)
                              const index = state.entries.findIndex((item) => item.id === entry.id)
                              if (index < 0) state.entries.push(entry)
                              else state.entries[index] = entry
                          }
                          for (const save of state.saves.filter((item) => item.status === 'unknown'))
                              await this.reconcile(save.id)
                      })
                  )
                : Promise.resolve()
        await Promise.all([
            notion,
            Promise.all(
                repositories.map(async (repository) => {
                    if (state !== this.store.state) return
                    if (!options.source || options.source === 'git')
                        await acquire(`git:${repository.id}`, async () => {
                            const status = this.status(`git:${repository.id}`)
                            const trackingStart = repository.trackingStart
                            const timezone = state.settings.timezone
                            const configuration = gitConfiguration(repository, state)
                            const stored = this.store.gitHistory(repository.id)
                            const history = stored?.configuration === configuration ? stored : undefined
                            if (!history || status.historyTimezone !== timezone) status.historySince = undefined
                            status.historyTimezone = timezone
                            try {
                                if (!repository.remotes)
                                    repository.remotes = (await inspectRepository(repository.path)).remotes
                                const indexed = await indexCommits(
                                    repository,
                                    history?.refs ?? {},
                                    trackingStart,
                                    history?.nextOffset,
                                    history?.excludedTips,
                                    history?.items ?? [],
                                    timezone
                                )
                                this.checkStopped(status)
                                if (state !== this.store.state)
                                    throw new Error('Local data was restored while refreshing.')
                                const names = Object.keys(indexed.refs)
                                this.store.cacheGitHistory(repository.id, {
                                    configuration,
                                    refs: indexed.refs,
                                    nextOffset: indexed.nextOffset,
                                    excludedTips: indexed.excludedTips,
                                    items: (indexed.history ?? indexed.items).filter((activity) =>
                                        repository.emails.some(
                                            (email) => email.toLowerCase() === activity.author.toLowerCase()
                                        )
                                    )
                                })
                                repository.branches = names
                                repository.available = true
                                for (const activity of state.activities.filter(
                                    (item) => item.repositoryId === repository.id
                                ))
                                    activity.deletedBranches = activity.branches.filter(
                                        (branch) => !names.includes(branch)
                                    )
                                this.mergeActivities(
                                    indexed.items.filter((activity) =>
                                        repository.emails.some(
                                            (email) => email.toLowerCase() === activity.author.toLowerCase()
                                        )
                                    )
                                )
                                status.refs = indexed.refs
                                status.offset = indexed.nextOffset
                                status.excludedTips = indexed.excludedTips
                                status.windowEnd = indexed.nextOffset
                                    ? (status.windowEnd ?? new Date().toISOString())
                                    : undefined
                                status.configuration = configuration
                                status.since = trackingStart
                                if (!indexed.nextOffset) status.historySince = trackingStart
                            } catch (error) {
                                if (!this.isStopped(status)) repository.available = false
                                throw error
                            }
                        })
                })
            ),
            Promise.all(
                repositories.map(async (repository) => {
                    if (state !== this.store.state) return
                    if (
                        (!options.source || options.source === 'github') &&
                        this.connections().github &&
                        githubRemote(repository.remote)
                    )
                        await acquire(`github:${repository.id}`, async () => {
                            const status = this.status(`github:${repository.id}`)
                            const trackingStart = repository.trackingStart
                            const timezone = state.settings.timezone
                            const configuration = githubConfiguration(repository, state)
                            if (status.configuration !== configuration || status.historyTimezone !== timezone) {
                                status.since = trackingStart
                                status.page = 1
                                if (status.configuration !== configuration) status.versions = {}
                                status.windowEnd = undefined
                                status.lastSuccess = undefined
                                status.historySince = undefined
                            }
                            if (
                                (!status.historySince || trackingStart < status.historySince) &&
                                status.since &&
                                status.since > trackingStart
                            ) {
                                status.since = trackingStart
                                status.page = 1
                                status.windowEnd = undefined
                            }
                            status.configuration = configuration
                            status.historyTimezone = timezone
                            status.versions ??= {}
                            if (!status.windowEnd) status.page = 1
                            status.windowEnd ??= new Date().toISOString()
                            if (!status.since)
                                status.since = status.lastSuccess
                                    ? new Date(
                                          Math.max(
                                              Date.parse(trackingStart),
                                              Date.parse(status.lastSuccess) - 2 * 86400000
                                          )
                                      )
                                          .toISOString()
                                          .slice(0, 10)
                                    : trackingStart
                            const tracked = state.activities
                                .filter((item) => item.repositoryId === repository.id && item.kind === 'pr')
                                .map((item) => item.id)
                            await this.github.activities(repository, state.settings.githubLogin, tracked, {
                                timezone,
                                since: status.since,
                                page: status.page,
                                versions: status.versions,
                                background: true,
                                checkpoint: (page, complete) => {
                                    this.checkStopped(status)
                                    status.page = page
                                    if (complete) {
                                        status.historySince = trackingStart
                                        status.since = new Date(
                                            Math.max(
                                                Date.parse(trackingStart),
                                                Date.parse(status.windowEnd!) - 2 * 86400000
                                            )
                                        )
                                            .toISOString()
                                            .slice(0, 10)
                                        status.windowEnd = undefined
                                    }
                                    this.store.persist()
                                },
                                batch: async (activities) => {
                                    if (state !== this.store.state)
                                        throw new Error('Local data was restored while refreshing.')
                                    this.checkStopped(status)
                                    for (const incoming of activities) {
                                        const previous = state.activities.find((item) => item.id === incoming.id)
                                        const previousDate = previous?.date
                                        const previousFingerprint = previous?.fingerprint
                                        const previousRevision = state.revisions.find(
                                            (item) => item.id === previous?.revision
                                        )
                                        this.mergeActivity(incoming)
                                        if (incoming.kind !== 'pr') continue
                                        const current = this.activity(incoming.id)
                                        const needsComparison =
                                            !!previousRevision || current.date.slice(0, 10) < repository.trackingStart
                                        current.fingerprint = undefined
                                        current.revision = undefined
                                        if (needsComparison) {
                                            try {
                                                await this.capture(
                                                    current,
                                                    state.diffs[current.id] !== undefined,
                                                    false
                                                )
                                                const revision = state.revisions.find(
                                                    (item) => item.id === current.revision
                                                )
                                                const changed = previousFingerprint
                                                    ? previousFingerprint !== current.fingerprint
                                                    : previousRevision &&
                                                      revision &&
                                                      (previousRevision.head !== revision.head ||
                                                          previousRevision.base !== revision.base)
                                                if (changed) current.date = new Date().toISOString()
                                                else if (previousDate && previousDate > current.date)
                                                    current.date = previousDate
                                            } catch (error) {
                                                if (previousRevision && previousRevision.head !== current.head)
                                                    current.date = new Date().toISOString()
                                                this.store.persist()
                                                throw error
                                            }
                                        } else if (previousDate && previousDate > current.date)
                                            current.date = previousDate
                                    }
                                }
                            })
                        })
                })
            )
        ])
        const errors = Object.entries(state.acquisition ?? {})
            .filter(([, status]) => status.status !== 'cancelled' && status.error)
            .map(([key, status]) => `${key}: ${status.error}`)
        state.refreshError = errors.length ? errors.join('\n') : undefined
        if (acquired && !errors.length && !Object.values(state.acquisition ?? {}).some((status) => status.windowEnd))
            state.lastRefreshed = new Date().toISOString()
        this.store.persist()
    }
    private async loadDetails(activity: Activity, includeDiff: boolean): Promise<void> {
        const state = this.store.state
        const repository = this.repository(activity.repositoryId)
        const version = activity.sourceVersion
        if (activity.kind === 'pr') {
            if (includeDiff) await this.capture(activity)
            if (!hasFileStatistics(activity)) activity.files = await this.github.files(repository, activity)
        } else if (activity.sha) {
            let details: Awaited<ReturnType<typeof commitDetails>>
            try {
                if (!repository.available) throw new Error('Local checkout unavailable')
                details = await commitDetails(repository, activity.sha, includeDiff)
            } catch (localError) {
                if (!githubRemote(repository.remote) || !this.connections().github)
                    throw new Error(
                        `Local changes are unavailable (${localError instanceof Error ? localError.message : String(localError)}). Locate the repository, or connect GitHub and select its remote in Settings.`
                    )
                details = await this.github.commitDetails(repository, activity.sha, includeDiff)
            }
            if (state !== this.store.state)
                throw new Error('Local data was restored while loading. Open the activity again.')
            if (includeDiff) state.diffs[activity.id] = details.diff
            activity.files = details.files
        } else if (activity.prId) activity.files = await this.github.files(repository, activity)
        if (version !== activity.sourceVersion)
            throw new Error('Activity changed while loading. Select it again to load the current revision.')
        activity.filesLoaded = true
        this.store.persist()
    }
    private confirm(save: State['saves'][number], entry: State['entries'][number]): void {
        const state = this.store.state
        const index = state.entries.findIndex((item) => item.id === entry.id)
        if (index < 0) state.entries.push(entry)
        else state.entries[index] = entry
        for (const selected of save.selections)
            if (
                !state.coverage.some(
                    (link) =>
                        link.activityId === selected.activityId &&
                        link.revision === selected.revision &&
                        link.entryId === entry.id
                )
            )
                state.coverage.push({ ...selected, entryId: entry.id })
        save.status = 'confirmed'
        save.entryId = entry.id
        save.error = undefined
        const draft = state.drafts.find((item) => item.id === save.draftId)
        // The page belongs to this weekly draft even if newer local edits arrived
        // while publishing. The next publish must update that page.
        if (draft) draft.publishedEntryId = entry.id
        this.store.persist()
    }
    private async publish(draftId: string): Promise<void> {
        const state = this.store.state
        const draft = state.drafts.find((item) => item.id === draftId)
        if (!draft) throw new Error('Draft does not exist')
        if (state.saves.some((save) => save.draftId === draftId && ['pending', 'unknown'].includes(save.status)))
            throw new Error('This draft has an uncertain save. Verify it before publishing again.')
        const previous = state.saves
            .filter((save) => save.entryId === draft.publishedEntryId && save.status === 'confirmed')
            .at(-1)
        const destination = previous?.destination ?? state.settings.destination
        if (!destination || !this.connections().notion) throw new Error('Connect Notion and choose a destination first')
        const save: State['saves'][number] = {
            id: randomUUID(),
            draftId,
            status: 'pending',
            marker: `gitorian-operation:${randomUUID()}`,
            title: draft.title,
            body: structuredClone(draft.body),
            selections: structuredClone(draft.selections),
            destination: structuredClone(destination),
            createdAt: new Date().toISOString(),
            week: draft.week
        }
        save.entryId = draft.publishedEntryId
        save.updateExisting = !!draft.publishedEntryId
        state.saves.push(save)
        this.store.persist()
        await this.store.flush()
        try {
            this.confirm(
                save,
                await this.notion.publish(save, async () => {
                    this.store.persist()
                    await this.store.flush()
                })
            )
        } catch (error) {
            // Server-side errors and network failures may occur after a committed write.
            save.status =
                (!save.entryId || (save.updateExisting && !save.replacedBlockIds)) &&
                error instanceof HttpError &&
                error.status >= 400 &&
                error.status < 500 &&
                error.status !== 408
                    ? 'failed'
                    : 'unknown'
            save.error = String(error)
            this.store.persist()
            throw error
        }
    }
    private async reconcile(saveId: string): Promise<void> {
        const save = this.store.state.saves.find((item) => item.id === saveId)
        if (!save || save.status !== 'unknown') throw new Error('No uncertain save to verify')
        const entry = await this.notion.reconcile(save, async () => {
            this.store.persist()
            await this.store.flush()
        })
        if (entry) this.confirm(save, entry)
        else {
            save.error =
                'The saved page has not been found yet. Retry verification after Notion is reachable; creation remains blocked.'
            this.store.persist()
        }
    }
    async handle(command: Command): Promise<Reply> {
        const state = this.store.state
        switch (command.type) {
            case 'state':
                return this.reply()
            case 'repository': {
                const repository = this.repository(command.repository.id)
                const incoming = command.repository
                // Renderer configuration cannot assign arbitrary filesystem paths.
                Object.assign(repository, incoming, { path: repository.path, available: repository.available })
                break
            }
            case 'loadWeek':
                await this.refresh({ since: command.since, missingOnly: true })
                return this.reply()
            case 'refresh':
                await this.refresh({ ...command, resume: true })
                return this.reply()
            case 'backfill':
                await this.backfill(command.repositoryId, command.since)
                return this.reply()
            case 'stopWork':
                this.stopWork(command.source, command.repositoryId)
                return this.reply()
            case 'history': {
                const repository = this.repository(command.repositoryId)
                const remoteNames = (await git(repository.path, ['remote'])).trim().split('\n').filter(Boolean)
                const remotePrefix = remoteNames.find((name) => command.branch.startsWith(`${name}/`))
                const branchName = remotePrefix ? command.branch.slice(remotePrefix.length + 1) : command.branch
                const linked = state.activities.find(
                    (activity) =>
                        activity.kind === 'pr' &&
                        activity.repositoryId === repository.id &&
                        activity.branches.includes(branchName)
                )
                const target = linked?.base
                const remoteTarget = target
                    ? repository.branches.find((name) => remoteNames.some((remote) => name === `${remote}/${target}`))
                    : undefined
                const base = target
                    ? repository.branches.includes(target)
                        ? target
                        : (remoteTarget ?? target)
                    : (repository.branchBases[command.branch] ?? repository.branchBases[branchName] ?? repository.base)
                const items = await commits(repository, command.branch, command.view, base, command.since)
                for (const item of items) this.mergeActivity(item)
                this.store.persist()
                const authors = (Array.isArray(command.author) ? command.author : [command.author])
                    .map((author) => author.trim().toLowerCase())
                    .filter(Boolean)
                return this.reply({
                    activityIds: items
                        .filter(
                            (item) =>
                                (!authors.length ||
                                    authors.some((author) => item.author.toLowerCase().includes(author))) &&
                                (!command.since || item.date.slice(0, 10) >= command.since)
                        )
                        .map((item) => item.id),
                    message: `Comparison: ${base}`
                })
            }
            case 'details': {
                const activity = this.activity(command.activityId)
                const includeDiff = command.content !== 'files'
                const cached = includeDiff
                    ? state.diffs[activity.id] !== undefined &&
                      !isCombinedDiff(state.diffs[activity.id]) &&
                      (activity.kind !== 'pr' || activity.diffRevision === activity.revision)
                    : hasFileStatistics(activity)
                if (!cached) {
                    const key = `${activity.id}:${activity.sourceVersion ?? activity.sha ?? ''}:${includeDiff}`
                    let request = this.details.get(key)
                    if (!request) {
                        request = this.loadDetails(activity, includeDiff).finally(() => {
                            this.details.delete(key)
                        })
                        this.details.set(key, request)
                    }
                    await request
                }
                return this.reply(includeDiff ? { diff: state.diffs[activity.id] ?? '' } : {})
            }
            case 'newDraft':
                if (state.drafts.some((draft) => draft.week === command.week)) break
                state.drafts.push({
                    id: randomUUID(),
                    week: command.week,
                    title: `${command.week} – ${new Date(new Date(`${command.week}T12:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10)}`,
                    body: structuredClone(state.settings.template),
                    selections: [],
                    updatedAt: new Date().toISOString()
                })
                break
            case 'draft': {
                for (const id of imageIds(command.draft.body))
                    if (!this.store.hasImage(id)) throw new Error('A draft image is missing. Restore it from a backup.')
                const draft = state.drafts.find((item) => item.id === command.draft.id)
                if (!draft) throw new Error('Draft is unavailable')
                draft.body = command.draft.body
                draft.title = command.draft.title
                draft.updatedAt = new Date().toISOString()
                break
            }
            case 'select': {
                const draft = state.drafts.find((item) => item.id === command.draftId)
                if (!draft) throw new Error('Choose an editable draft')
                const activity = this.activity(command.activityId)
                if (command.included) {
                    if (draft.selections.some((item) => item.activityId === activity.id)) break
                    const selected: Selection = { activityId: activity.id }
                    if (activity.kind === 'pr') {
                        selected.revision =
                            activity.revision && state.diffs[activity.id] !== undefined
                                ? activity.revision
                                : await this.capture(activity)
                    }
                    draft.selections.push(selected)
                    activity.explicit = true
                } else draft.selections = draft.selections.filter((item) => item.activityId !== activity.id)
                break
            }
            case 'disposition':
                Object.assign(this.activity(command.activityId), {
                    disposition: command.disposition,
                    deferUntil: command.until,
                    reason: command.reason
                })
                if (command.disposition === 'inbox') this.activity(command.activityId).explicit = true
                break
            case 'settings': {
                for (const id of imageIds(command.settings.template))
                    if (!this.store.hasImage(id))
                        throw new Error('A template image is missing. Restore it from a backup.')
                new Intl.DateTimeFormat('en-US', { timeZone: command.settings.timezone })
                const order = command.settings.layout.order
                if (order.length !== 3 || new Set(order).size !== 3)
                    throw new Error('Layout must contain each pane once')
                state.settings = { ...command.settings, destination: state.settings.destination }
                break
            }
            case 'publish':
                await this.publish(command.draftId)
                return this.reply()
            case 'reconcile':
                await this.reconcile(command.saveId)
                return this.reply()
            case 'coverage': {
                const activity = this.activity(command.activityId)
                if (!state.entries.some((entry) => entry.id === command.entryId))
                    throw new Error('Choose a cached saved entry')
                if (command.linked) {
                    const revision =
                        activity.kind === 'pr'
                            ? activity.revision && state.diffs[activity.id] !== undefined
                                ? activity.revision
                                : await this.capture(activity)
                            : undefined
                    state.coverage.push({ activityId: activity.id, revision, entryId: command.entryId })
                } else
                    state.coverage = state.coverage.filter(
                        (link) => !(link.activityId === activity.id && link.entryId === command.entryId)
                    )
                break
            }
            default:
                throw new Error('This command requires the desktop host')
        }
        return this.reply({}, this.store.persist())
    }
}
