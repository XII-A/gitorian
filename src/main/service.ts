import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'

import { isCombinedDiff } from '../shared/diff-format'
import type { Activity, Command, Reply, Repository, RepositoryImportProgress, Selection, State } from '../shared/model'
import { weekOf } from '../shared/model'
import { required } from '../shared/required'
import { filesFromDiff } from './diff-files'
import { commitDetails, commits, git, githubRemote, indexCommits, inspectRepository } from './git'
import type { GitHub } from './github'
import { HttpError } from './http'
import type { Notion } from './notion'
import { discoverRepositories, repositoryPathKey } from './repository-discovery'
import type { Store } from './store'
import { forEachConcurrent } from './work-queue'

const serviceRoutes: Partial<Record<Command['type'], 'dispatch0' | 'dispatch1' | 'dispatch2' | 'dispatch3'>> = {
    backfill: 'dispatch0',
    coverage: 'dispatch3',
    details: 'dispatch1',
    disposition: 'dispatch2',
    draft: 'dispatch1',
    feature: 'dispatch2',
    history: 'dispatch0',
    newDraft: 'dispatch1',
    publish: 'dispatch3',
    reconcile: 'dispatch3',
    refresh: 'dispatch0',
    repository: 'dispatch0',
    select: 'dispatch2',
    settings: 'dispatch2',
    state: 'dispatch0',
    stopWork: 'dispatch0'
}

export class JournalService {
    private refreshing?: Promise<void>
    private readonly queuedRefreshes = new Map<string, Promise<void>>()
    private readonly details = new Map<string, Promise<void>>()
    private importing = false
    private importStopped = false
    readonly store: Store
    private readonly github: GitHub
    private readonly notion: Notion
    private readonly connections: () => Reply['connections']
    constructor(store: Store, github: GitHub, notion: Notion, connections: () => Reply['connections']) {
        this.store = store
        this.github = github
        this.notion = notion
        this.connections = connections
    }
    reply(extra: Partial<Reply> = {}): Reply {
        return { connections: this.connections(), state: this.store.snapshot(), ...extra }
    }
    execute(command: Command): Effect.Effect<Reply, Error> {
        return Effect.tryPromise({
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            try: () => Promise.resolve(this.handle(command))
        })
    }
    async addRepository(path: string, persist = true): Promise<void> {
        const inspected = await inspectRepository(path)
        if (
            this.store.state.repositories.some(
                (repository) => repositoryPathKey(repository.path) === repositoryPathKey(inspected.path)
            )
        ) {
            throw new Error('This repository is already tracked')
        }
        this.store.state.repositories.push({
            available: true,
            base: inspected.base,
            branchBases: {},
            branches: inspected.branches,
            emails: inspected.email ? [inspected.email] : [],
            id: randomUUID(),
            name: inspected.name,
            path: inspected.path,
            remote: '',
            remotes: inspected.remotes,
            removed: false,
            trackingStart: weekOf(new Date(), this.store.state.settings)
        })
        if (persist) {
            this.store.persist()
        }
    }
    async addRepositories(folder: string, onProgress?: (progress: RepositoryImportProgress) => void): Promise<Reply> {
        if (this.importing) {
            return this.reply({ message: 'A repository import is already running.' })
        }
        this.importing = true
        this.importStopped = false
        const importId = randomUUID()
        this.store.state.repositoryImport = { completed: 0, id: importId, status: 'running', total: 0 }
        this.store.persist()
        try {
            onProgress?.({ found: 0, scanned: 0, stage: 'discovering' })
            const discovered = await discoverRepositories(folder, (counts) =>
                onProgress?.({ stage: 'discovering', ...counts })
            )
            let added = 0
            let existing = 0
            let restored = 0
            const skippedItems = discovered.unreadable.map((path) => ({
                path,
                reason: 'Folder could not be read. Check its permissions.'
            }))
            let skipped = discovered.unreadable.length
            let completed = 0
            onProgress?.({ completed, stage: 'processing', total: discovered.paths.length })
            this.store.state.repositoryImport = {
                completed,
                id: importId,
                status: 'running',
                total: discovered.paths.length
            }
            this.store.persist()
            await forEachConcurrent(discovered.paths, 2, async (path) => {
                if (this.importStopped) {
                    return
                }
                const tracked = this.store.state.repositories.find(
                    (item) => repositoryPathKey(item.path) === repositoryPathKey(path)
                )
                try {
                    if (tracked) {
                        if (tracked.removed || !tracked.available) {
                            const inspected = await inspectRepository(path)
                            Object.assign(tracked, {
                                available: true,
                                branches: inspected.branches,
                                path: inspected.path,
                                remotes: inspected.remotes,
                                removed: false
                            })
                            restored += 1
                        } else {
                            existing += 1
                        }
                    } else {
                        await this.addRepository(path, false)
                        added += 1
                    }
                } catch (error) {
                    skippedItems.push({ path, reason: error instanceof Error ? error.message : String(error) })
                    skipped += 1
                }
                completed += 1
                this.store.state.repositoryImport = {
                    completed,
                    id: importId,
                    status: 'running',
                    total: discovered.paths.length
                }
                if (completed % 4 === 0) {
                    this.store.persist()
                }
                onProgress?.({ completed, stage: 'processing', total: discovered.paths.length })
            })
            const messages = [`Added ${added} ${added === 1 ? 'repository' : 'repositories'}.`]
            if (!discovered.paths.length) {
                messages[0] = 'No Git repositories found in this folder.'
            }
            if (restored) {
                messages.push(`Resumed tracking ${restored}.`)
            }
            if (existing) {
                messages.push(`${existing} already tracked.`)
            }
            if (skipped) {
                messages.push(`${skipped} unreadable or invalid folders skipped.`)
            }
            if (this.importStopped) {
                messages.push('Import stopped. Add the folder again to continue.')
            }
            this.store.state.repositoryImport = {
                completed,
                id: importId,
                message: messages.join(' '),
                skipped,
                skippedItems,
                status: this.importStopped ? 'cancelled' : 'done',
                total: discovered.paths.length
            }
            this.store.persist()
            return this.reply({ message: messages.join(' ') })
        } finally {
            this.importing = false
        }
    }
    stopWork(source: 'git' | 'github' | 'repositories', repositoryId?: string): void {
        if (source === 'repositories') {
            this.importStopped = true
        } else {
            for (const [key, status] of Object.entries(this.store.state.acquisition ?? {})) {
                if (key.startsWith(`${source}:`) && (!repositoryId || key === `${source}:${repositoryId}`)) {
                    status.status = 'cancelled'
                    status.error = undefined
                }
            }
        }
        this.store.persist()
    }
    private static checkStopped(status: NonNullable<State['acquisition']>[string]): void {
        if (JournalService.isStopped(status)) {
            throw new Error('Paused by you. Completed work is kept.')
        }
    }
    private static isStopped(status: NonNullable<State['acquisition']>[string]): boolean {
        return status.status === 'cancelled'
    }
    private repository(id: string): Repository {
        const repository = this.store.state.repositories.find((item) => item.id === id)
        if (!repository) {
            throw new Error('Repository is no longer available')
        }
        return repository
    }
    private activity(id: string): Activity {
        const activity = this.store.state.activities.find((item) => item.id === id)
        if (!activity) {
            throw new Error('Work is no longer available')
        }
        return activity
    }
    private mergeActivity(incoming: Activity): void {
        const { state } = this.store
        const current = state.activities.find((item) => item.id === incoming.id)
        if (current) {
            Object.assign(current, incoming, {
                branches: [...new Set([...current.branches, ...incoming.branches])],
                deferUntil: current.deferUntil,
                deletedBranches: current.deletedBranches,
                disposition: current.disposition,
                explicit: current.explicit,
                files: incoming.filesLoaded ? incoming.files : current.files,
                filesLoaded:
                    current.filesLoaded &&
                    (!incoming.sourceVersion || incoming.sourceVersion === current.sourceVersion),
                fingerprint: incoming.fingerprint ?? current.fingerprint,
                reason: current.reason,
                revision: incoming.revision ?? current.revision
            })
        } else {
            state.activities.push(incoming)
        }
    }
    private async capture(activity: Activity, retainDiff = true, persist = true): Promise<string> {
        const { state } = this.store
        const version = activity.sourceVersion
        const snapshot = await this.github.snapshot(this.repository(activity.repositoryId), activity, !persist)
        if (state !== this.store.state) {
            throw new Error('Local data was restored while loading. Open the activity again.')
        }
        if (version !== activity.sourceVersion) {
            throw new Error('Activity changed while loading. Select it again to load the current revision.')
        }
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
        if (!prior) {
            state.revisions.push({ id, prId: activity.id, ...snapshot, diff: retainDiff ? snapshot.diff : '' })
        } else if (retainDiff) {
            prior.diff = snapshot.diff
        }
        Object.assign(activity, { fingerprint: snapshot.fingerprint, head: snapshot.head, revision: id })
        if (retainDiff) {
            state.diffs[activity.id] = snapshot.diff
            activity.diffRevision = id
            if (!activity.filesLoaded) {
                const files = filesFromDiff(snapshot.diff)
                if (files !== undefined) {
                    activity.files = files
                    activity.filesLoaded = true
                }
            }
        }
        if (persist) {
            this.store.persist()
        }
        return id
    }
    private status(key: string): NonNullable<State['acquisition']>[string] {
        const { state } = this.store
        state.acquisition ??= {}
        return (state.acquisition[key] ??= { status: 'idle' })
    }
    async refresh(
        options: {
            repositoryId?: string
            source?: 'git' | 'github' | 'notion'
            resume?: boolean
            afterCurrent?: boolean
        } = {}
    ): Promise<void> {
        if (this.refreshing) {
            if (!options.resume && !options.afterCurrent) {
                return await this.refreshing
            }
            const key = `${options.repositoryId ?? '*'}:${options.source ?? '*'}:${!!options.resume}`
            const queued = this.queuedRefreshes.get(key)
            if (queued) {
                return await queued
            }
            const next = this.queueRefresh(this.refreshing, key, options)
            this.queuedRefreshes.set(key, next)
            return await next
        }
        this.refreshing = this.finishRefresh(options)
        return await this.refreshing
    }
    private async queueRefresh(
        current: Promise<void>,
        key: string,
        options: NonNullable<Parameters<JournalService['refresh']>[0]>
    ): Promise<void> {
        try {
            await current
        } finally {
            this.queuedRefreshes.delete(key)
        }
        await this.refresh(options)
    }
    private async finishRefresh(options: NonNullable<Parameters<JournalService['refresh']>[0]>): Promise<void> {
        try {
            await this.refreshSources(options)
        } finally {
            this.refreshing = undefined
        }
    }
    private async finishDetails(key: string, activity: Activity, includeDiff: boolean): Promise<void> {
        try {
            await this.loadDetails(activity, includeDiff)
        } finally {
            this.details.delete(key)
        }
    }

    async backfill(repositoryId: string, since: string): Promise<void> {
        if (this.refreshing) {
            await this.refreshing
        }
        const repository = this.repository(repositoryId)
        if (since > repository.trackingStart) {
            throw new Error('Choose a date before the current history start.')
        }
        repository.trackingStart = since
        for (const source of ['git', 'github']) {
            const status = this.status(`${source}:${repositoryId}`)
            status.since = since
            status.page = 1
            status.refs = undefined
            status.offset = undefined
            status.excludedTips = undefined
            status.windowEnd = undefined
            status.lastSuccess = undefined
        }
        this.store.persist()
        await this.refresh({ repositoryId, resume: true })
    }
    private async source(key: string, work: () => Promise<void>, resume = false): Promise<void> {
        const status = this.status(key)
        if (JournalService.isStopped(status) && !resume) {
            return
        }
        if (status.retryAt && Date.parse(status.retryAt) > Date.now()) {
            return
        }
        status.status = 'running'
        status.error = undefined
        status.retryAt = undefined
        this.store.persist()
        try {
            await work()
            JournalService.checkStopped(status)
            status.status = 'idle'
            if (!status.windowEnd) {
                status.lastSuccess = new Date().toISOString()
            }
        } catch (error) {
            if (!JournalService.isStopped(status)) {
                status.status = error instanceof HttpError && error.retryAt ? 'paused' : 'error'
            }
            status.error = (() => {
                if (JournalService.isStopped(status)) {
                    return
                }
                if (error instanceof Error) {
                    return error.message
                }
                return String(error)
            })()
            status.retryAt =
                error instanceof HttpError && error.retryAt ? new Date(error.retryAt).toISOString() : undefined
        }
        this.store.persist()
    }
    private async refreshSources(options: {
        repositoryId?: string
        source?: 'git' | 'github' | 'notion'
        resume?: boolean
    }): Promise<void> {
        const { state } = this.store
        const repositories = state.repositories.filter(
            (item) => !item.removed && (!options.repositoryId || item.id === options.repositoryId)
        )
        if (!options.repositoryId && !options.source) {
            state.lastRefreshAttempt = new Date().toISOString()
            this.store.persist()
        }
        // Notion refresh proceeds independently of a potentially long GitHub backlog.
        const notion =
            !options.repositoryId &&
            (!options.source || options.source === 'notion') &&
            this.connections().notion &&
            state.settings.destination
                ? this.source('notion', async () => {
                      for await (const page of await this.notion.pages(required(state.settings.destination))) {
                          const entry = await this.notion.entry(page)
                          const index = state.entries.findIndex((item) => item.id === entry.id)
                          if (index === -1) {
                              state.entries.push(entry)
                          } else {
                              state.entries[index] = entry
                          }
                      }
                      for await (const save of state.saves.filter((item) => item.status === 'unknown')) {
                          await this.reconcile(save.id)
                      }
                  })
                : Promise.resolve()
        await Promise.all([
            notion,
            forEachConcurrent(repositories, 2, async (repository) => {
                if (state !== this.store.state) {
                    return
                }
                if (!options.source || options.source === 'git') {
                    await this.source(
                        `git:${repository.id}`,
                        async () => {
                            const status = this.status(`git:${repository.id}`)
                            const configuration = JSON.stringify([
                                repository.path,
                                repository.remote,
                                repository.emails,
                                repository.trackingStart
                            ])
                            if (status.configuration !== configuration) {
                                status.refs = undefined
                                status.offset = undefined
                                status.excludedTips = undefined
                            }
                            try {
                                if (!repository.remotes) {
                                    const awaited1 = await inspectRepository(repository.path)
                                    repository.remotes = awaited1.remotes
                                }
                                const indexed = await indexCommits(
                                    repository,
                                    status.refs ?? {},
                                    repository.trackingStart,
                                    status.offset,
                                    status.excludedTips,
                                    state.activities.filter(
                                        (activity) =>
                                            activity.repositoryId === repository.id && activity.kind === 'commit'
                                    )
                                )
                                JournalService.checkStopped(status)
                                if (state !== this.store.state) {
                                    throw new Error('Local data was restored while refreshing.')
                                }
                                const names = Object.keys(indexed.refs)
                                repository.branches = names
                                repository.available = true
                                for (const activity of state.activities.filter(
                                    (item) => item.repositoryId === repository.id
                                )) {
                                    activity.deletedBranches = activity.branches.filter(
                                        (branch) => !names.includes(branch)
                                    )
                                }
                                for (const activity of indexed.items) {
                                    if (
                                        repository.emails.some(
                                            (email) => email.toLowerCase() === activity.author.toLowerCase()
                                        )
                                    ) {
                                        this.mergeActivity(activity)
                                    }
                                }
                                status.refs = indexed.refs
                                status.offset = indexed.nextOffset
                                status.excludedTips = indexed.excludedTips
                                status.windowEnd = indexed.nextOffset
                                    ? (status.windowEnd ?? new Date().toISOString())
                                    : undefined
                                status.configuration = configuration
                                status.since = repository.trackingStart
                            } catch (error) {
                                if (!JournalService.isStopped(status)) {
                                    repository.available = false
                                }
                                throw error
                            }
                        },
                        options.resume
                    )
                }
                if (
                    (!options.source || options.source === 'github') &&
                    this.connections().github &&
                    githubRemote(repository.remote)
                ) {
                    await this.source(
                        `github:${repository.id}`,
                        async () => {
                            const status = this.status(`github:${repository.id}`)
                            const configuration = JSON.stringify([
                                repository.remote,
                                repository.emails,
                                repository.trackingStart,
                                state.settings.githubLogin
                            ])
                            if (status.configuration !== configuration) {
                                status.since = repository.trackingStart
                                status.page = 1
                                status.versions = {}
                                status.windowEnd = undefined
                                status.lastSuccess = undefined
                            }
                            status.configuration = configuration
                            status.versions ??= {}
                            if (!status.windowEnd) {
                                status.page = 1
                            }
                            status.windowEnd ??= new Date().toISOString()
                            if (!status.since) {
                                status.since = status.lastSuccess
                                    ? new Date(
                                          Math.max(
                                              Date.parse(repository.trackingStart),
                                              Date.parse(status.lastSuccess) - 2 * 86_400_000
                                          )
                                      )
                                          .toISOString()
                                          .slice(0, 10)
                                    : repository.trackingStart
                            }
                            const tracked = state.activities
                                .filter((item) => item.repositoryId === repository.id && item.kind === 'pr')
                                .map((item) => item.id)
                            await this.github.activities(repository, state.settings.githubLogin, tracked, {
                                background: true,
                                batch: async (activities) => {
                                    if (state !== this.store.state) {
                                        throw new Error('Local data was restored while refreshing.')
                                    }
                                    JournalService.checkStopped(status)
                                    for await (const incoming of activities) {
                                        const previous = state.activities.find((item) => item.id === incoming.id)
                                        const previousDate = previous?.date
                                        const previousFingerprint = previous?.fingerprint
                                        const previousRevision = state.revisions.find(
                                            (item) => item.id === previous?.revision
                                        )
                                        this.mergeActivity(incoming)
                                        if (incoming.kind !== 'pr') {
                                            continue
                                        }
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
                                                if (changed) {
                                                    current.date = new Date().toISOString()
                                                } else if (previousDate && previousDate > current.date) {
                                                    current.date = previousDate
                                                }
                                            } catch (error) {
                                                if (previousRevision && previousRevision.head !== current.head) {
                                                    current.date = new Date().toISOString()
                                                }
                                                this.store.persist()
                                                throw error
                                            }
                                        } else if (previousDate && previousDate > current.date) {
                                            current.date = previousDate
                                        }
                                    }
                                },
                                checkpoint: (page, complete) => {
                                    JournalService.checkStopped(status)
                                    status.page = page
                                    if (complete) {
                                        status.since = new Date(
                                            Math.max(
                                                Date.parse(repository.trackingStart),
                                                Date.parse(required(status.windowEnd)) - 2 * 86_400_000
                                            )
                                        )
                                            .toISOString()
                                            .slice(0, 10)
                                        status.windowEnd = undefined
                                    }
                                    this.store.persist()
                                },
                                page: status.page,
                                since: status.since,
                                versions: status.versions
                            })
                        },
                        options.resume
                    )
                }
            })
        ])
        const errors = Object.entries(state.acquisition ?? {})
            .filter(([, status]) => status.status !== 'cancelled' && status.error)
            .map(([key, status]) => `${key}: ${status.error}`)
        state.refreshError = errors.length ? errors.join('\n') : undefined
        if (!errors.length && !Object.values(state.acquisition ?? {}).some((status) => status.windowEnd)) {
            state.lastRefreshed = new Date().toISOString()
        }
        this.store.persist()
    }
    private async loadDetails(activity: Activity, includeDiff: boolean): Promise<void> {
        const { state } = this.store
        const repository = this.repository(activity.repositoryId)
        const version = activity.sourceVersion
        if (activity.kind === 'pr') {
            if (includeDiff) {
                await this.capture(activity)
            }
            if (!activity.filesLoaded) {
                activity.files = await this.github.files(repository, activity)
            }
        } else if (activity.sha) {
            let details: Awaited<ReturnType<typeof commitDetails>>
            try {
                if (!repository.available) {
                    throw new Error('Local checkout unavailable')
                }
                details = await commitDetails(repository, activity.sha, includeDiff)
            } catch (localError) {
                if (!githubRemote(repository.remote) || !this.connections().github) {
                    throw new Error(
                        `Local changes are unavailable (${localError instanceof Error ? localError.message : String(localError)}). Locate the repository, or connect GitHub and select its remote in Settings.`,
                        { cause: localError }
                    )
                }
                details = await this.github.commitDetails(repository, activity.sha, includeDiff)
            }
            if (state !== this.store.state) {
                throw new Error('Local data was restored while loading. Open the activity again.')
            }
            if (includeDiff) {
                state.diffs[activity.id] = details.diff
            }
            activity.files = details.files
        } else if (activity.prId) {
            activity.files = await this.github.files(repository, activity)
        }
        if (version !== activity.sourceVersion) {
            throw new Error('Activity changed while loading. Select it again to load the current revision.')
        }
        activity.filesLoaded = true
        this.store.persist()
    }
    private confirm(save: State['saves'][number], entry: State['entries'][number]): void {
        const { state } = this.store
        if (!state.entries.some((item) => item.id === entry.id)) {
            state.entries.push(entry)
        }
        for (const selected of save.selections) {
            if (
                !state.coverage.some(
                    (link) =>
                        link.activityId === selected.activityId &&
                        link.revision === selected.revision &&
                        link.entryId === entry.id
                )
            ) {
                state.coverage.push({ ...selected, entryId: entry.id })
            }
        }
        save.status = 'confirmed'
        save.entryId = entry.id
        save.error = undefined
        const draft = state.drafts.find((item) => item.id === save.draftId)
        if (
            draft &&
            draft.title === save.title &&
            JSON.stringify(draft.body) === JSON.stringify(save.body) &&
            JSON.stringify(draft.selections) === JSON.stringify(save.selections)
        ) {
            draft.publishedEntryId = entry.id
        }
        this.store.persist()
    }
    private async publish(draftId: string): Promise<void> {
        const { state } = this.store
        const draft = state.drafts.find((item) => item.id === draftId)
        if (!draft) {
            throw new Error('Draft does not exist')
        }
        if (draft.publishedEntryId) {
            throw new Error('This draft has already been published; create another entry')
        }
        if (state.saves.some((save) => save.draftId === draftId && ['pending', 'unknown'].includes(save.status))) {
            throw new Error('This draft has an uncertain save. Verify it before publishing again.')
        }
        const { destination } = state.settings
        if (!destination || !this.connections().notion) {
            throw new Error('Connect Notion and choose a destination first')
        }
        const save: State['saves'][number] = {
            body: structuredClone(draft.body),
            createdAt: new Date().toISOString(),
            destination: structuredClone(destination),
            draftId,
            id: randomUUID(),
            marker: `weekly-j-operation:${randomUUID()}`,
            selections: structuredClone(draft.selections),
            status: 'pending',
            title: draft.title,
            week: draft.week
        }
        state.saves.push(save)
        this.store.persist()
        try {
            this.confirm(
                save,
                await this.notion.publish(save, () => {
                    this.store.persist()
                })
            )
        } catch (error) {
            // Server-side errors and network failures may occur after a committed write.
            save.status =
                !save.entryId &&
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
        if (!save || save.status !== 'unknown') {
            throw new Error('No uncertain save to verify')
        }
        const entry = await this.notion.reconcile(save)
        if (entry) {
            this.confirm(save, entry)
        } else {
            save.error =
                'The saved page has not been found yet. Retry verification after Notion is reachable; creation remains blocked.'
            this.store.persist()
        }
    }
    async handle(command: Command): Promise<Reply> {
        const route = serviceRoutes[command.type]
        if (!route) {
            throw new Error('This command requires the desktop host')
        }
        const reply = await this[route](command)
        if (reply) {
            return reply
        }
        this.store.persist()
        return this.reply()
    }

    private async dispatch0(command: Command): Promise<Reply | undefined> {
        const { state } = this.store
        switch (command.type) {
            case 'state': {
                return this.reply()
            }
            case 'repository': {
                const repository = this.repository(command.repository.id)
                const incoming = command.repository
                // Renderer configuration cannot assign arbitrary filesystem paths.
                Object.assign(repository, incoming, { available: repository.available, path: repository.path })
                return undefined
            }
            case 'refresh': {
                await this.refresh({ ...command, resume: true })
                return this.reply()
            }
            case 'backfill': {
                await this.backfill(command.repositoryId, command.since)
                return this.reply()
            }
            case 'stopWork': {
                this.stopWork(command.source, command.repositoryId)
                return this.reply()
            }
            case 'history': {
                const repository = this.repository(command.repositoryId)
                const awaited2 = await git(repository.path, ['remote'])
                const remoteNames = awaited2.trim().split('\n').filter(Boolean)
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
                const base = (() => {
                    if (target) {
                        if (repository.branches.includes(target)) {
                            return target
                        }
                        return remoteTarget ?? target
                    }
                    return (
                        repository.branchBases[command.branch] ?? repository.branchBases[branchName] ?? repository.base
                    )
                })()
                const items = await commits(repository, command.branch, command.view, base, command.since)
                for (const item of items) {
                    this.mergeActivity(item)
                }
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
            default: {
                throw new Error('Command routed to the wrong service handler')
            }
        }
    }

    private async dispatch1(command: Command): Promise<Reply | undefined> {
        const { state } = this.store
        switch (command.type) {
            case 'details': {
                const activity = this.activity(command.activityId)
                const includeDiff = command.content !== 'files'
                const cached = includeDiff
                    ? state.diffs[activity.id] !== undefined &&
                      !isCombinedDiff(state.diffs[activity.id]) &&
                      (activity.kind !== 'pr' || activity.diffRevision === activity.revision)
                    : activity.filesLoaded
                if (!cached) {
                    const key = `${activity.id}:${activity.sourceVersion ?? activity.sha ?? ''}:${includeDiff}`
                    let request = this.details.get(key)
                    if (!request) {
                        request = this.finishDetails(key, activity, includeDiff)
                        this.details.set(key, request)
                    }
                    await request
                }
                return this.reply(includeDiff ? { diff: state.diffs[activity.id] ?? '' } : {})
            }
            case 'newDraft': {
                state.drafts.push({
                    body: structuredClone(state.settings.template),
                    id: randomUUID(),
                    selections: [],
                    title: `${command.week} – ${new Date(new Date(`${command.week}T12:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10)}`,
                    updatedAt: new Date().toISOString(),
                    week: command.week
                })
                return undefined
            }
            case 'draft': {
                const draft = state.drafts.find((item) => item.id === command.draft.id)
                if (!draft || draft.publishedEntryId) {
                    throw new Error('Draft is read-only or unavailable')
                }
                draft.body = command.draft.body
                draft.title = command.draft.title
                draft.updatedAt = new Date().toISOString()
                return undefined
            }
            default: {
                throw new Error('Command routed to the wrong service handler')
            }
        }
    }

    private async dispatch2(command: Command): Promise<Reply | undefined> {
        const { state } = this.store
        switch (command.type) {
            case 'select': {
                const draft = state.drafts.find((item) => item.id === command.draftId)
                if (!draft || draft.publishedEntryId) {
                    throw new Error('Choose an editable draft')
                }
                const activity = this.activity(command.activityId)
                if (command.included) {
                    if (draft.selections.some((item) => item.activityId === activity.id)) {
                        break
                    }
                    const selected: Selection = { activityId: activity.id }
                    if (activity.kind === 'pr') {
                        selected.revision =
                            activity.revision && state.diffs[activity.id] !== undefined
                                ? activity.revision
                                : await this.capture(activity)
                    }
                    draft.selections.push(selected)
                    activity.explicit = true
                } else {
                    draft.selections = draft.selections.filter((item) => item.activityId !== activity.id)
                }
                return undefined
            }
            case 'disposition': {
                Object.assign(this.activity(command.activityId), {
                    deferUntil: command.until,
                    disposition: command.disposition,
                    reason: command.reason
                })
                if (command.disposition === 'inbox') {
                    this.activity(command.activityId).explicit = true
                }
                return undefined
            }
            case 'feature': {
                const current = state.features.find((item) => item.id === command.id)
                const feature = {
                    archived: command.archived,
                    id: command.id || randomUUID(),
                    members: command.members,
                    name: command.name
                }
                if (current) {
                    Object.assign(current, feature)
                } else {
                    state.features.push(feature)
                }
                return undefined
            }
            case 'settings': {
                Intl.DateTimeFormat('en-US', { timeZone: command.settings.timezone })
                const { order } = command.settings.layout
                if (order.length !== 3 || new Set(order).size !== 3) {
                    throw new Error('Layout must contain each pane once')
                }
                state.settings = command.settings
                return undefined
            }
            default: {
                throw new Error('Command routed to the wrong service handler')
            }
        }
    }

    private async dispatch3(command: Command): Promise<Reply | undefined> {
        const { state } = this.store
        switch (command.type) {
            case 'publish': {
                await this.publish(command.draftId)
                return this.reply()
            }
            case 'reconcile': {
                await this.reconcile(command.saveId)
                return this.reply()
            }
            case 'coverage': {
                const activity = this.activity(command.activityId)
                if (!state.entries.some((entry) => entry.id === command.entryId)) {
                    throw new Error('Choose a cached saved entry')
                }
                if (command.linked) {
                    let revision: string | undefined
                    if (activity.kind === 'pr') {
                        revision =
                            activity.revision && state.diffs[activity.id] !== undefined
                                ? activity.revision
                                : await this.capture(activity)
                    }
                    state.coverage.push({ activityId: activity.id, entryId: command.entryId, revision })
                } else {
                    state.coverage = state.coverage.filter(
                        (link) => !(link.activityId === activity.id && link.entryId === command.entryId)
                    )
                }
                return undefined
            }
            default: {
                throw new Error('Command routed to the wrong service handler')
            }
        }
    }
}
