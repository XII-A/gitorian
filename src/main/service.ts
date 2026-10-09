import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { commits, branches, commitDetails, inspectRepository, git } from './git'
import { HttpError } from './http'
import { discoverRepositories, repositoryPathKey } from './repository-discovery'
import { weekOf } from '../shared/model'
import type { Activity, Command, Reply, Repository, Selection, State } from '../shared/model'
import type { Store } from './store'
import type { GitHub } from './github'
import type { Notion } from './notion'

export class JournalService {
    private refreshing?: Promise<void>
    constructor(
        readonly store: Store,
        private readonly github: GitHub,
        private readonly notion: Notion,
        private readonly connections: () => Reply['connections']
    ) {}
    reply(extra: Partial<Reply> = {}): Reply {
        return { state: structuredClone(this.store.state), connections: this.connections(), ...extra }
    }
    execute(command: Command): Effect.Effect<Reply, Error> {
        return Effect.tryPromise({
            try: () => this.handle(command),
            catch: (error) => (error instanceof Error ? error : new Error(String(error)))
        })
    }
    async addRepository(path: string): Promise<void> {
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
            branches: inspected.branches
        })
        this.store.persist()
    }
    async addRepositories(folder: string): Promise<Reply> {
        const discovered = await discoverRepositories(folder)
        let added = 0
        let existing = 0
        let restored = 0
        let skipped = discovered.unreadable.length
        for (const path of discovered.paths) {
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
                            branches: inspected.branches
                        })
                        restored++
                    } else existing++
                } else {
                    await this.addRepository(path)
                    added++
                }
            } catch {
                skipped++
            }
        }
        this.store.persist()
        const messages = [`Added ${added} ${added === 1 ? 'repository' : 'repositories'}.`]
        if (!discovered.paths.length) messages[0] = 'No Git repositories found in this folder.'
        if (restored) messages.push(`Resumed tracking ${restored}.`)
        if (existing) messages.push(`${existing} already tracked.`)
        if (skipped) messages.push(`${skipped} unreadable or invalid folders skipped.`)
        return this.reply({ message: messages.join(' ') })
    }
    async remoteCandidates(id: string): Promise<string[]> {
        return (await inspectRepository(this.repository(id).path)).remotes
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
        const state = this.store.state
        const current = state.activities.find((item) => item.id === incoming.id)
        if (!current) state.activities.push(incoming)
        else
            Object.assign(current, incoming, {
                disposition: current.disposition,
                deferUntil: current.deferUntil,
                reason: current.reason,
                explicit: current.explicit,
                revision: incoming.revision ?? current.revision,
                fingerprint: incoming.fingerprint ?? current.fingerprint,
                deletedBranches: current.deletedBranches,
                branches: [...new Set([...current.branches, ...incoming.branches])]
            })
    }
    private async capture(activity: Activity, retainDiff = true): Promise<string> {
        const state = this.store.state
        const snapshot = await this.github.snapshot(this.repository(activity.repositoryId), activity)
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
        }
        this.store.persist()
        return id
    }
    async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing
        this.refreshing = this.refreshSources().finally(() => {
            this.refreshing = undefined
        })
        return this.refreshing
    }
    private async refreshSources(): Promise<void> {
        const state = this.store.state
        const errors: string[] = []
        for (const repository of state.repositories.filter((item) => !item.removed)) {
            try {
                const names = await branches(repository)
                repository.branches = names
                repository.available = true
                for (const activity of state.activities.filter((item) => item.repositoryId === repository.id))
                    activity.deletedBranches = activity.branches.filter((branch) => !names.includes(branch))
                const indexed = new Map<string, Activity>()
                for (const branch of names) {
                    for (const activity of await commits(repository, branch)) {
                        const existing = indexed.get(activity.id)
                        if (existing) existing.branches.push(branch)
                        else indexed.set(activity.id, activity)
                    }
                }
                for (const activity of indexed.values())
                    if (repository.emails.some((email) => email.toLowerCase() === activity.author.toLowerCase()))
                        this.mergeActivity(activity)
            } catch (error) {
                repository.available = false
                errors.push(`${repository.name}: ${String(error)}`)
            }
            if (this.connections().github) {
                try {
                    const tracked = state.activities.filter((item) => item.kind === 'pr').map((item) => item.id)
                    for (const activity of await this.github.activities(
                        repository,
                        state.settings.githubLogin,
                        tracked
                    )) {
                        const previous = state.activities.find((item) => item.id === activity.id)
                        const previousFingerprint = previous?.fingerprint
                        const previousDate = previous?.date
                        const previousRevision = state.revisions.find((revision) => revision.id === previous?.revision)
                        this.mergeActivity(activity)
                        if (activity.kind === 'pr') {
                            const current = this.activity(activity.id)
                            // A failed comparison must never leave stale coverage on mutable PR state.
                            current.fingerprint = undefined
                            current.revision = undefined
                            try {
                                await this.capture(current, state.diffs[activity.id] !== undefined)
                                const revision = state.revisions.find((item) => item.id === current.revision)
                                const changed = previousFingerprint
                                    ? previousFingerprint !== current.fingerprint
                                    : previousRevision &&
                                      revision &&
                                      (previousRevision.head !== revision.head ||
                                          previousRevision.base !== revision.base)
                                if (changed) current.date = new Date().toISOString()
                                else if (previousDate && previousDate > current.date) current.date = previousDate
                            } catch (error) {
                                if (previousRevision && previousRevision.head !== current.head)
                                    current.date = new Date().toISOString()
                                else if (previousDate && previousDate > current.date) current.date = previousDate
                                errors.push(`${activity.title}: ${String(error)}`)
                            }
                        }
                    }
                } catch (error) {
                    errors.push(`GitHub ${repository.name}: ${String(error)}`)
                }
            }
        }
        if (this.connections().notion && state.settings.destination) {
            try {
                for (const page of await this.notion.pages(state.settings.destination)) {
                    const entry = await this.notion.entry(page)
                    const index = state.entries.findIndex((item) => item.id === entry.id)
                    if (index < 0) state.entries.push(entry)
                    else state.entries[index] = entry
                }
                for (const save of state.saves.filter((item) => item.status === 'unknown'))
                    await this.reconcile(save.id)
            } catch (error) {
                errors.push(`Notion: ${String(error)}`)
            }
        }
        state.lastRefreshed = new Date().toISOString()
        state.refreshError = errors.length ? errors.join('\n') : undefined
        this.store.persist()
    }
    private confirm(save: State['saves'][number], entry: State['entries'][number]): void {
        const state = this.store.state
        if (!state.entries.some((item) => item.id === entry.id)) state.entries.push(entry)
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
        if (
            draft &&
            draft.title === save.title &&
            JSON.stringify(draft.body) === JSON.stringify(save.body) &&
            JSON.stringify(draft.selections) === JSON.stringify(save.selections)
        )
            draft.publishedEntryId = entry.id
        this.store.persist()
    }
    private async publish(draftId: string): Promise<void> {
        const state = this.store.state
        const draft = state.drafts.find((item) => item.id === draftId)
        if (!draft) throw new Error('Draft does not exist')
        if (draft.publishedEntryId) throw new Error('This draft has already been published; create another entry')
        if (state.saves.some((save) => save.draftId === draftId && ['pending', 'unknown'].includes(save.status)))
            throw new Error('This draft has an uncertain save. Verify it before publishing again.')
        const destination = state.settings.destination
        if (!destination || !this.connections().notion) throw new Error('Connect Notion and choose a destination first')
        const save: State['saves'][number] = {
            id: randomUUID(),
            draftId,
            status: 'pending',
            marker: `weekly-j-operation:${randomUUID()}`,
            title: draft.title,
            body: structuredClone(draft.body),
            selections: structuredClone(draft.selections),
            destination: structuredClone(destination),
            createdAt: new Date().toISOString(),
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
        if (!save || save.status !== 'unknown') throw new Error('No uncertain save to verify')
        const entry = await this.notion.reconcile(save)
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
            case 'refresh':
                await this.refresh()
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
                const items = await commits(repository, command.branch, command.view, base)
                for (const item of items) this.mergeActivity(item)
                this.store.persist()
                return this.reply({
                    activityIds: items
                        .filter(
                            (item) =>
                                (!command.author || item.author.toLowerCase().includes(command.author.toLowerCase())) &&
                                (!command.since || item.date.slice(0, 10) >= command.since)
                        )
                        .map((item) => item.id),
                    message: `Comparison: ${base}`
                })
            }
            case 'details': {
                const activity = this.activity(command.activityId)
                if (
                    state.diffs[activity.id] !== undefined &&
                    (activity.kind !== 'pr' || activity.diffRevision === activity.revision)
                )
                    return this.reply({ diff: state.diffs[activity.id] })
                if (activity.kind === 'pr') await this.capture(activity)
                else if (activity.sha) {
                    const repository = this.repository(activity.repositoryId)
                    let details: Awaited<ReturnType<typeof commitDetails>>
                    try {
                        if (!repository.available) throw new Error('Local source unavailable')
                        details = await commitDetails(repository, activity.sha)
                    } catch {
                        if (!activity.url || !this.connections().github)
                            throw new Error(
                                'Source unavailable. Locate the repository or connect GitHub to load this diff.'
                            )
                        details = await this.github.commitDetails(repository, activity.sha)
                    }
                    state.diffs[activity.id] = details.diff
                    activity.files = details.files
                }
                this.store.persist()
                return this.reply({ diff: state.diffs[activity.id] ?? '' })
            }
            case 'newDraft':
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
                const draft = state.drafts.find((item) => item.id === command.draft.id)
                if (!draft || draft.publishedEntryId) throw new Error('Draft is read-only or unavailable')
                draft.body = command.draft.body
                draft.title = command.draft.title
                draft.updatedAt = new Date().toISOString()
                break
            }
            case 'select': {
                const draft = state.drafts.find((item) => item.id === command.draftId)
                if (!draft || draft.publishedEntryId) throw new Error('Choose an editable draft')
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
            case 'feature': {
                const current = state.features.find((item) => item.id === command.id)
                const feature = {
                    id: command.id || randomUUID(),
                    name: command.name,
                    archived: command.archived,
                    members: command.members
                }
                if (current) Object.assign(current, feature)
                else state.features.push(feature)
                break
            }
            case 'settings': {
                new Intl.DateTimeFormat('en-US', { timeZone: command.settings.timezone })
                const order = command.settings.layout.order
                if (order.length !== 3 || new Set(order).size !== 3)
                    throw new Error('Layout must contain each pane once')
                state.settings = command.settings
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
        this.store.persist()
        return this.reply()
    }
}
