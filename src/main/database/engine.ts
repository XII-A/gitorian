import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import {
    activitySchema,
    draftSchema,
    entrySchema,
    initialState,
    repositorySchema,
    stateSchema,
    weekOf
} from '../../shared/model'
import type {
    Activity,
    Destination,
    Draft,
    Entry,
    HistoryEntry,
    JournalNode,
    Repository,
    Selection,
    State
} from '../../shared/model'
import { localDate } from '../../shared/model'
import { plainText, toNotion } from '../../shared/notion-format'
import { gitConfiguration, contributionConfiguration } from '../../shared/activity-history'
import { imageIds } from '../../shared/images'
import type { JournalImage } from '../../shared/images'
import { imageLimits } from '../../shared/images'
import type { GitHistory } from '../git'
import { DatabaseError, type AcquisitionBatch, type Configuration, type JournalView } from './types'
import * as t from './schema'
import { upgradeJournalBackup } from '../../shared/journal-upgrade'
import { bodySchema, titleSchema, titleDocument } from '../../shared/writing-schema'
import { Step } from '@tiptap/pm/transform'
import {
    writingRequest,
    writingLimits,
    writingSize,
    type WritingRequest,
    type WritingState
} from '../../shared/writing'
import {
    providerAccountSchema,
    providerRemote,
    remoteConfiguration,
    type ProviderAccount
} from '../../shared/provider-accounts'

const optional = <T>(value: T | null): T | undefined => value ?? undefined
const instant = (value: string) => {
    const result = Date.parse(value)
    if (!Number.isFinite(result)) throw new DatabaseError('invalid', 'Invalid activity date')
    return result
}

function parseSettings(input: State['settings']) {
    const settings = stateSchema.shape.settings.parse(input)
    new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone })
    if (settings.layout.order.length !== 3 || new Set(settings.layout.order).size !== 3)
        throw new DatabaseError('invalid', 'Layout must contain each pane once')
    return settings
}

/** SQLite and its transaction invariants live only in the owning worker. */
export class JournalEngine {
    private readonly native: DatabaseSync
    private readonly db: ReturnType<typeof drizzle>
    constructor(
        path: string,
        migrations: string,
        private readonly now: () => number = Date.now
    ) {
        this.native = new DatabaseSync(path)
        this.db = drizzle({ client: this.native })
        try {
            this.native.function('journal_text', { deterministic: true }, (body) => plainText(JSON.parse(String(body))))
            this.native.function('journal_lower', { deterministic: true }, (text) =>
                String(text).toLocaleLowerCase('en-US')
            )
            // The new release file has one baseline; an unrelated/old schema is never rewritten.
            const tables = this.native
                .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                .all()
            if (tables.length && !tables.some((row) => row.name === '__drizzle_migrations'))
                throw new DatabaseError('schema', 'This database uses an unsupported journal format.')
            const known = new Map(
                readMigrationFiles({ migrationsFolder: migrations }).map((migration) => [
                    migration.name,
                    migration.hash
                ])
            )
            if (!known.size) throw new DatabaseError('schema', 'Journal migrations are missing from this installation.')
            if (tables.some((row) => row.name === '__drizzle_migrations'))
                for (const row of this.native.prepare('SELECT name,hash FROM __drizzle_migrations').all()) {
                    if (!known.has(String(row.name)))
                        throw new DatabaseError(
                            'schema',
                            'This journal uses a newer unsupported database version. Install a newer Gitorian release.'
                        )
                    if (known.get(String(row.name)) !== row.hash)
                        throw new DatabaseError('schema', 'Journal migration history does not match this installation.')
                }
            this.native.exec(
                'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000'
            )
            // SQLite ignores FK toggles inside Drizzle's migration transaction. Disable
            // before it starts so table rebuilds cannot cascade-delete retained evidence.
            this.native.exec('PRAGMA foreign_keys=OFF')
            try {
                migrate(this.db, { migrationsFolder: migrations })
            } finally {
                this.native.exec('PRAGMA foreign_keys=ON')
            }
            if (this.native.prepare('PRAGMA foreign_key_check').all().length)
                throw new DatabaseError('schema', 'Journal migration relationships could not be verified.')
            if (!this.db.select().from(t.journal).get())
                this.db
                    .insert(t.journal)
                    .values({
                        id: 1,
                        generation: randomUUID(),
                        sequence: 0,
                        settings: initialState().settings
                    })
                    .run()
            this.write(() => {
                if (!this.db.select().from(t.journal).get()!.providerUpgrade) {
                    const legacy = this.hydrateActivities(this.db.select().from(t.activities).all())
                    const converted = upgradeJournalBackup({
                        repositories: this.repositories(),
                        activities: legacy,
                        revisions: []
                    }) as { activities: unknown[] }
                    for (const activity of stateSchema.shape.activities.parse(converted.activities))
                        this.putActivity(activity, false)
                    this.native.exec(
                        "UPDATE activities SET localQualified=1 WHERE kind='commit' AND (remoteSource IS NULL OR id IN (SELECT activityId FROM git_history_items))"
                    )
                    this.db.update(t.journal).set({ providerUpgrade: true }).where(eq(t.journal.id, 1)).run()
                }
                this.db
                    .update(t.publications)
                    .set({ status: 'unknown' })
                    .where(eq(t.publications.status, 'pending'))
                    .run()
                for (const row of this.db.select().from(t.acquisition).all()) {
                    if (row.status === 'running')
                        this.putCheckpoint(row.key, {
                            ...row.cursor,
                            status: 'idle',
                            retryAt: row.retryAt ?? undefined
                        })
                }
                const progress = this.config().repositoryImport
                if (progress?.status === 'running')
                    this.db
                        .update(t.journal)
                        .set({
                            repositoryImport: {
                                ...progress,
                                status: 'error',
                                message:
                                    'Import was interrupted. Add the folder again to continue; existing repositories are kept.'
                            }
                        })
                        .where(eq(t.journal.id, 1))
                        .run()
            })
            this.collectCaches()
        } catch (error) {
            this.native.close()
            throw error
        }
    }

    private write<T>(operation: () => T, generation?: string): T {
        let result!: T
        this.db.transaction(
            () => {
                if (generation && generation !== this.generation())
                    throw new DatabaseError('generation', 'The journal was restored. Reload before saving again.')
                result = operation()
                this.db
                    .update(t.journal)
                    .set({ sequence: sql`${t.journal.sequence}+1` })
                    .where(eq(t.journal.id, 1))
                    .run()
            },
            { behavior: 'immediate' }
        )
        return result
    }
    private generation() {
        return this.db.select({ value: t.journal.generation }).from(t.journal).get()!.value
    }
    config(): Configuration {
        const row = this.db.select().from(t.journal).get()!
        return {
            generation: row.generation,
            sequence: row.sequence,
            settings: parseSettings(row.settings),
            credentialCleanup: this.db
                .select()
                .from(t.credentialCleanup)
                .all()
                .map((r) => r.key),
            accounts: this.db
                .select()
                .from(t.providerAccounts)
                .all()
                .map((a) => a.metadata),
            accountPreparations: this.db
                .select()
                .from(t.providerPreparations)
                .all()
                .map((a) => a.metadata),
            repositories: this.repositories(),
            acquisition: Object.fromEntries(
                this.db
                    .select()
                    .from(t.acquisition)
                    .all()
                    .map((r) => [
                        r.key,
                        {
                            ...r.cursor,
                            status: r.status as NonNullable<State['acquisition']>[string]['status'],
                            retryAt: r.retryAt ?? undefined
                        }
                    ])
            ),
            transportPauses: Object.fromEntries(
                this.db
                    .select()
                    .from(t.transportPauses)
                    .all()
                    .map((r) => [r.scope, r.until])
            ),
            repositoryImport: optional(row.repositoryImport),
            lastRefreshed: optional(row.lastRefreshed),
            lastRefreshAttempt: optional(row.lastRefreshAttempt),
            refreshError: optional(row.refreshError)
        }
    }
    repositories(): Repository[] {
        const emails = this.db.select().from(t.repositoryEmails).all()
        const branches = this.db.select().from(t.repositoryBranches).all()
        return this.db
            .select()
            .from(t.repositories)
            .orderBy(asc(t.repositories.id))
            .all()
            .map((r) => ({
                ...r,
                accountId: r.accountId ?? undefined,
                providerProjectId: r.providerProjectId ?? undefined,
                accountGeneration: r.accountGeneration ?? undefined,
                assignment: r.assignment ?? undefined,
                emails: emails.filter((e) => e.repositoryId === r.id).map((e) => e.email),
                branches: branches.filter((b) => b.repositoryId === r.id).map((b) => b.name)
            }))
    }
    private putRepository(input: Repository) {
        const r = repositorySchema.parse(input)
        const { emails, branches, ...record } = r
        const stored = {
            ...record,
            remotes: r.remotes ?? [],
            accountId: r.accountId ?? null,
            accountGeneration: r.accountGeneration ?? null,
            providerProjectId: r.providerProjectId ?? null,
            assignment: r.assignment ?? null
        }
        this.db
            .insert(t.repositories)
            .values(stored)
            .onConflictDoUpdate({ target: t.repositories.id, set: stored })
            .run()
        this.db.delete(t.repositoryEmails).where(eq(t.repositoryEmails.repositoryId, r.id)).run()
        this.db.delete(t.repositoryBranches).where(eq(t.repositoryBranches.repositoryId, r.id)).run()
        for (const email of new Set(emails))
            this.db.insert(t.repositoryEmails).values({ repositoryId: r.id, email }).run()
        for (const name of new Set(branches))
            this.db.insert(t.repositoryBranches).values({ repositoryId: r.id, name }).run()
    }
    saveRepository(repository: Repository, generation: string) {
        this.write(() => {
            const current = this.repositories().find((r) => r.id === repository.id)
            const assignment = current?.remote === repository.remote ? current : undefined
            this.putRepository(
                current
                    ? {
                          ...repository,
                          accountId: assignment?.accountId,
                          accountGeneration: assignment?.accountGeneration,
                          providerProjectId: assignment?.providerProjectId,
                          assignment: assignment?.assignment
                      }
                    : repository
            )
        }, generation)
    }
    updateRepositorySettings(repository: Repository, generation: string) {
        this.write(() => {
            const current = this.repositories().find((r) => r.id === repository.id)
            if (!current) throw new DatabaseError('invalid', 'Repository is no longer available.')
            const assignment = current.remote === repository.remote ? current : undefined
            this.putRepository({
                ...repository,
                path: current.path,
                available: current.available,
                accountId: assignment?.accountId,
                accountGeneration: assignment?.accountGeneration,
                providerProjectId: assignment?.providerProjectId,
                assignment: assignment?.assignment
            })
        }, generation)
    }
    updateRepositoryLocation(
        location: Pick<Repository, 'id' | 'path' | 'branches' | 'remotes' | 'available' | 'removed'>,
        generation: string
    ) {
        this.write(() => {
            const current = this.repositories().find((r) => r.id === location.id)
            if (!current) throw new DatabaseError('invalid', 'Repository is no longer available.')
            this.putRepository({
                ...current,
                path: location.path,
                branches: location.branches,
                remotes: location.remotes,
                available: location.available,
                removed: location.removed
            })
        }, generation)
    }
    assignProviderAccount(
        repositoryId: string,
        configuration: string,
        assignment: {
            accountId?: string
            accountGeneration?: number
            providerProjectId?: string
            assignment: 'automatic' | 'explicit'
        },
        generation: string
    ) {
        this.write(() => {
            const repository = this.repositories().find((r) => r.id === repositoryId)
            if (!repository || remoteConfiguration(repository) !== configuration)
                throw new DatabaseError('conflict', 'Repository changed. Choose its account again.')
            if (assignment.accountId) {
                const account = this.config().accounts.find((a) => a.id === assignment.accountId)
                if (
                    !account ||
                    account.generation !== assignment.accountGeneration ||
                    !['connected', 'session'].includes(account.status)
                )
                    throw new DatabaseError('conflict', 'The account changed. Reconnect or choose another account.')
            }
            this.putRepository({ ...repository, ...assignment })
        }, generation)
    }
    prepareProviderAccount(input: ProviderAccount, generation: string) {
        this.write(() => {
            const account = providerAccountSchema.parse(input)
            const current = this.config().accounts.find((a) => a.id === account.id)
            if (current && account.generation !== current.generation + 1 && account.generation !== current.generation)
                throw new DatabaseError('conflict', 'This account changed. Connect again.')
            const metadata = {
                ...account,
                predecessorKey: current?.credentialKey,
                previousGeneration: current?.generation ?? 0
            }
            this.db
                .insert(t.providerPreparations)
                .values({ id: account.id, metadata })
                .onConflictDoUpdate({ target: t.providerPreparations.id, set: { metadata } })
                .run()
        }, generation)
    }
    activateProviderAccount(id: string, expected: number, generation: string) {
        this.write(() => {
            const pending = this.db
                .select()
                .from(t.providerPreparations)
                .where(eq(t.providerPreparations.id, id))
                .get()?.metadata
            const current = this.config().accounts.find((a) => a.id === id)
            if (
                !pending ||
                pending.status === 'disconnected' ||
                pending.generation !== expected ||
                (current?.generation ?? 0) !== pending.previousGeneration ||
                current?.credentialKey !== pending.predecessorKey
            )
                throw new DatabaseError('conflict', 'This account changed. Connect again.')
            const metadata = providerAccountSchema.parse(pending)
            if (
                this.config().accounts.some(
                    (a) =>
                        a.id !== id &&
                        a.provider === pending.provider &&
                        a.host === pending.host &&
                        a.userId === pending.userId
                )
            )
                throw new DatabaseError('conflict', 'This account is already connected.')
            this.db
                .insert(t.providerAccounts)
                .values({ id, identity: JSON.stringify([pending.provider, pending.host, pending.userId]), metadata })
                .onConflictDoUpdate({ target: t.providerAccounts.id, set: { metadata } })
                .run()
            for (const r of this.repositories().filter((r) => r.accountId === id))
                this.putRepository({ ...r, accountGeneration: expected })
        }, generation)
    }
    finishProviderAccount(id: string, generation: string) {
        this.write(
            () => this.db.delete(t.providerPreparations).where(eq(t.providerPreparations.id, id)).run(),
            generation
        )
    }
    finishCredentialCleanup(key: string, generation: string) {
        this.write(() => this.db.delete(t.credentialCleanup).where(eq(t.credentialCleanup.key, key)).run(), generation)
    }
    disconnectProviderAccount(id: string, generation: string, status: 'disconnected' | 'reconnect' = 'disconnected') {
        return this.write(() => {
            const current = this.config().accounts.find((a) => a.id === id)
            if (!current) throw new DatabaseError('invalid', 'Account not found.')
            const pending = this.config().accountPreparations.find((a) => a.id === id)
            const keys = [
                ...new Set(
                    [current.credentialKey, pending?.credentialKey, pending?.predecessorKey].filter(
                        (k): k is string => !!k
                    )
                )
            ]
            for (const key of keys) this.db.insert(t.credentialCleanup).values({ key }).onConflictDoNothing().run()
            this.db
                .insert(t.providerPreparations)
                .values({
                    id,
                    metadata: {
                        ...(pending ?? current),
                        status: 'disconnected',
                        predecessorKey: current.credentialKey,
                        previousGeneration: current.generation + 1
                    }
                })
                .onConflictDoUpdate({
                    target: t.providerPreparations.id,
                    set: {
                        metadata: {
                            ...(pending ?? current),
                            status: 'disconnected',
                            predecessorKey: current.credentialKey,
                            previousGeneration: current.generation + 1
                        }
                    }
                })
                .run()
            this.db
                .update(t.providerAccounts)
                .set({ metadata: { ...current, status, generation: current.generation + 1 } })
                .where(eq(t.providerAccounts.id, id))
                .run()
            for (const r of this.repositories().filter((r) => r.accountId === id))
                this.putRepository({ ...r, accountGeneration: current.generation + 1 })
            return keys
        }, generation)
    }
    extendTrackingStart(id: string, since: string, generation: string) {
        return this.write(
            () =>
                this.db
                    .update(t.repositories)
                    .set({ trackingStart: since })
                    .where(and(eq(t.repositories.id, id), sql`${t.repositories.trackingStart}>${since}`))
                    .run(),
            generation
        )
    }
    saveSettings(settings: State['settings'], generation: string) {
        this.write(() => {
            const current = this.config().settings
            const parsed = parseSettings({
                ...settings,
                destination: current.destination
            })
            this.setImageReferences('template', parsed.template)
            this.db.update(t.journal).set({ settings: parsed }).where(eq(t.journal.id, 1)).run()
        }, generation)
    }
    setDestination(destination: Destination | undefined, generation: string) {
        this.write(() => {
            this.db
                .update(t.journal)
                .set({ settings: { ...this.config().settings, destination } })
                .where(eq(t.journal.id, 1))
                .run()
        }, generation)
    }
    repositoryUnavailable(id: string, configuration: string, generation: string) {
        this.write(() => {
            const config = this.config(),
                repository = config.repositories.find((r) => r.id === id)
            if (
                repository &&
                gitConfiguration(repository, { settings: config.settings, restoreId: generation }) === configuration
            )
                this.db.update(t.repositories).set({ available: false }).where(eq(t.repositories.id, id)).run()
        }, generation)
    }
    saveProgress(
        progress: Partial<Pick<State, 'repositoryImport' | 'lastRefreshed' | 'lastRefreshAttempt' | 'refreshError'>>,
        generation: string
    ) {
        return this.write(
            () =>
                this.db
                    .update(t.journal)
                    .set({
                        ...progress,
                        ...('refreshError' in progress ? { refreshError: progress.refreshError ?? null } : {})
                    })
                    .where(eq(t.journal.id, 1))
                    .run(),
            generation
        )
    }
    savePause(scope: string, until: number) {
        return this.write(() =>
            this.db
                .insert(t.transportPauses)
                .values({ scope, until })
                .onConflictDoUpdate({ target: t.transportPauses.scope, set: { until } })
                .run()
        )
    }
    private putCheckpoint(key: string, input: NonNullable<State['acquisition']>[string]) {
        const value = stateSchema.shape.acquisition.unwrap().valueType.parse(input)
        const { status, retryAt, versions, refs: _refs, excludedTips: _tips, ...cursor } = value
        const provider = key.slice(0, !key.includes(':') ? undefined : key.indexOf(':'))
        if (!['git', 'remote', 'notion'].includes(provider))
            throw new DatabaseError('invalid', 'Unknown activity source')
        const repositoryId = provider === 'notion' ? null : key.slice(key.indexOf(':') + 1)
        const previous = this.db
            .select({ cursor: t.acquisition.cursor })
            .from(t.acquisition)
            .where(eq(t.acquisition.key, key))
            .get()
        const record = {
            key,
            status,
            retryAt: retryAt ?? null,
            provider: provider as 'git' | 'remote' | 'notion',
            repositoryId,
            cursor
        }
        this.db
            .insert(t.acquisition)
            .values(record)
            .onConflictDoUpdate({ target: t.acquisition.key, set: record })
            .run()
        if (versions) {
            if (previous?.cursor.configuration !== cursor.configuration || !Object.keys(versions).length)
                this.db.delete(t.acquisitionVersions).where(eq(t.acquisitionVersions.key, key)).run()
            const stored = new Map(
                this.db
                    .select()
                    .from(t.acquisitionVersions)
                    .where(eq(t.acquisitionVersions.key, key))
                    .all()
                    .map((r) => [r.sourceId, r.version])
            )
            for (const [sourceId, version] of Object.entries(versions))
                if (stored.get(sourceId) !== version)
                    this.db
                        .insert(t.acquisitionVersions)
                        .values({ key, sourceId, version })
                        .onConflictDoUpdate({
                            target: [t.acquisitionVersions.key, t.acquisitionVersions.sourceId],
                            set: { version }
                        })
                        .run()
        }
    }
    acquisitionCheckpoint(key: string) {
        const row = this.db.select().from(t.acquisition).where(eq(t.acquisition.key, key)).get()
        if (!row) return undefined
        const versions =
            row.provider === 'remote'
                ? Object.fromEntries(
                      this.db
                          .select()
                          .from(t.acquisitionVersions)
                          .where(eq(t.acquisitionVersions.key, key))
                          .all()
                          .map((r) => [r.sourceId, r.version])
                  )
                : undefined
        const history = row.repositoryId
            ? this.db
                  .select({ refs: t.gitHistory.refs, excludedTips: t.gitHistory.excludedTips })
                  .from(t.gitHistory)
                  .where(eq(t.gitHistory.repositoryId, row.repositoryId))
                  .get()
            : undefined
        return stateSchema.shape.acquisition.unwrap().valueType.parse({
            ...row.cursor,
            status: row.status,
            retryAt: row.retryAt ?? undefined,
            versions,
            refs: history?.refs,
            excludedTips: history?.excludedTips ?? undefined
        })
    }

    saveCheckpoint(key: string, value: NonNullable<State['acquisition']>[string], generation: string) {
        this.write(() => this.putCheckpoint(key, value), generation)
    }

    activity(id: string): Activity | undefined {
        const row = this.db.select().from(t.activities).where(eq(t.activities.id, id)).get()
        return row ? this.hydrateActivity(row) : undefined
    }
    private hydrateActivities(rows: (typeof t.activities.$inferSelect)[]): Activity[] {
        if (!rows.length) return []
        if (rows.length > 500) {
            const result: Activity[] = []
            for (let offset = 0; offset < rows.length; offset += 500)
                result.push(...this.hydrateActivities(rows.slice(offset, offset + 500)))
            return result
        }
        const ids = rows.map((row) => row.id)
        const group = <T extends { activityId: string }>(values: T[]) => {
            const groups = new Map<string, T[]>()
            for (const value of values) {
                const items = groups.get(value.activityId) ?? []
                items.push(value)
                groups.set(value.activityId, items)
            }
            return groups
        }
        const branches = group(
            this.db.select().from(t.activityBranches).where(inArray(t.activityBranches.activityId, ids)).all()
        )
        const files = group(
            this.db
                .select()
                .from(t.activityFiles)
                .where(inArray(t.activityFiles.activityId, ids))
                .orderBy(asc(t.activityFiles.position))
                .all()
        )
        const dates = group(
            this.db
                .select()
                .from(t.activityDates)
                .where(and(inArray(t.activityDates.activityId, ids), eq(t.activityDates.kind, 'commit')))
                .all()
        )
        const configurations = new Map(this.repositories().map((r) => [r.id, remoteConfiguration(r)]))
        return rows.map((row) =>
            this.hydrateActivity(row, {
                branches: branches.get(row.id) ?? [],
                files: files.get(row.id) ?? [],
                configuration: configurations.get(row.repositoryId),
                commitDates: dates.get(row.id) ?? []
            })
        )
    }
    private hydrateActivity(
        row: typeof t.activities.$inferSelect,
        related?: {
            branches: (typeof t.activityBranches.$inferSelect)[]
            files: (typeof t.activityFiles.$inferSelect)[]
            configuration?: string
            commitDates: { instant: number }[]
        }
    ): Activity {
        const branches =
            related?.branches ??
            this.db.select().from(t.activityBranches).where(eq(t.activityBranches.activityId, row.id)).all()
        const files =
            related?.files ??
            this.db
                .select()
                .from(t.activityFiles)
                .where(eq(t.activityFiles.activityId, row.id))
                .orderBy(asc(t.activityFiles.position))
                .all()
        const commitDates =
            related?.commitDates ??
            this.db
                .select({ instant: t.activityDates.instant })
                .from(t.activityDates)
                .where(and(eq(t.activityDates.activityId, row.id), eq(t.activityDates.kind, 'commit')))
                .all()
        return activitySchema.parse({
            ...row,
            previousSource:
                !!row.remoteSource &&
                !row.localQualified &&
                !row.explicit &&
                (related?.configuration ??
                    remoteConfiguration(this.repositories().find((r) => r.id === row.repositoryId)!)) !==
                    row.remoteSource.configuration,
            changeRequest:
                row.openedAt === null
                    ? undefined
                    : {
                          status: row.prStatus ?? undefined,
                          openedAt: new Date(row.openedAt).toISOString(),
                          closedAt: row.closedAt === null ? undefined : new Date(row.closedAt).toISOString(),
                          mergedAt: row.mergedAt === null ? undefined : new Date(row.mergedAt).toISOString(),
                          commitDates: commitDates.map((d) => new Date(d.instant).toISOString())
                      },
            date: new Date(row.occurredAt).toISOString(),
            branches: branches.map((b) => b.name),
            deletedBranches: branches.filter((b) => b.deleted).map((b) => b.name),
            ...Object.fromEntries(
                Object.entries(row)
                    .filter(([, v]) => v === null)
                    .map(([k]) => [k, undefined])
            ),
            files: files.map((f) => ({
                name: f.name,
                status: f.status,
                previousName: f.previousName ?? undefined,
                lineStats: f.binary
                    ? null
                    : f.additions === null
                      ? undefined
                      : { additions: f.additions, deletions: f.deletions! }
            }))
        })
    }
    listActivities(repositoryId?: string, kind?: Activity['kind']): Activity[] {
        const rows = this.db
            .select()
            .from(t.activities)
            .where(
                and(
                    eq(t.activities.journaled, true),
                    repositoryId ? eq(t.activities.repositoryId, repositoryId) : undefined,
                    kind ? eq(t.activities.kind, kind) : undefined
                )
            )
            .all()
        return this.hydrateActivities(rows)
    }
    private putActivity(input: Activity, preserveDecisions: boolean, journaled = true) {
        const incoming = activitySchema.parse(input)
        const previous = preserveDecisions ? this.activity(incoming.id) : undefined
        const a = previous
            ? {
                  ...previous,
                  ...incoming,
                  disposition: previous.disposition,
                  deferUntil: previous.deferUntil,
                  reason: previous.reason,
                  explicit: previous.explicit,
                  revision:
                      incoming.sourceVersion && incoming.sourceVersion !== previous.sourceVersion
                          ? undefined
                          : (incoming.revision ?? previous.revision),
                  fingerprint:
                      incoming.sourceVersion && incoming.sourceVersion !== previous.sourceVersion
                          ? undefined
                          : (incoming.fingerprint ?? previous.fingerprint),
                  branches: [...new Set([...previous.branches, ...incoming.branches])],
                  deletedBranches: previous.deletedBranches,
                  files: incoming.filesLoaded ? incoming.files : previous.files,
                  filesLoaded:
                      previous.filesLoaded &&
                      (!incoming.sourceVersion || incoming.sourceVersion === previous.sourceVersion)
              }
            : incoming
        if (previous && JSON.stringify(a) === JSON.stringify(previous)) {
            if (journaled)
                this.db
                    .update(t.activities)
                    .set({ journaled: true })
                    .where(and(eq(t.activities.id, a.id), eq(t.activities.journaled, false)))
                    .run()
            return
        }
        const retained = this.db
            .select({ journaled: t.activities.journaled })
            .from(t.activities)
            .where(eq(t.activities.id, a.id))
            .get()
        const record = {
            id: a.id,
            repositoryId: a.repositoryId,
            kind: a.kind,
            title: a.title,
            occurredAt: instant(a.date),
            journaled: journaled || !!retained?.journaled,
            author: a.author,
            sha: a.sha ?? null,
            changeRequestId: a.changeRequestId ?? null,
            prStatus: a.changeRequest?.status ?? null,
            openedAt: a.changeRequest ? instant(a.changeRequest.openedAt) : null,
            closedAt: a.changeRequest?.closedAt ? instant(a.changeRequest.closedAt) : null,
            mergedAt: a.changeRequest?.mergedAt ? instant(a.changeRequest.mergedAt) : null,
            url: a.url ?? null,
            description: a.description,
            revision: a.revision ?? null,
            diffRevision: a.diffRevision ?? null,
            base: a.base ?? null,
            head: a.head ?? null,
            fingerprint: a.fingerprint ?? null,
            integrationSha: a.integrationSha ?? null,
            sourceVersion: a.sourceVersion ?? null,
            revisionSource: a.revisionSource ?? null,
            localQualified: a.localQualified ?? (a.kind === 'commit' && !a.remoteSource),
            remoteIdentity:
                a.remoteSource && a.kind !== 'commit'
                    ? JSON.stringify([
                          a.remoteSource.provider,
                          a.remoteSource.host,
                          a.remoteSource.projectId ?? a.remoteSource.path,
                          a.kind,
                          a.remoteSource.eventId
                      ])
                    : null,
            remoteSource: a.remoteSource ?? null,
            filesLoaded: !!a.filesLoaded,
            disposition: a.disposition,
            deferUntil: a.deferUntil ?? null,
            reason: a.reason ?? null,
            explicit: a.explicit
        }
        this.db.insert(t.activities).values(record).onConflictDoUpdate({ target: t.activities.id, set: record }).run()
        this.db.delete(t.activityBranches).where(eq(t.activityBranches.activityId, a.id)).run()
        const branchRows = [...new Set(a.branches)].map((name) => ({
            activityId: a.id,
            name,
            deleted: a.deletedBranches.includes(name)
        }))
        for (let i = 0; i < branchRows.length; i += 300)
            this.db
                .insert(t.activityBranches)
                .values(branchRows.slice(i, i + 300))
                .run()
        this.db.delete(t.activityDates).where(eq(t.activityDates.activityId, a.id)).run()
        const facts: { kind: 'activity' | 'commit' | 'opened' | 'closed' | 'merged'; instant: number }[] = [
            { kind: 'activity', instant: instant(a.date) }
        ]
        if (a.changeRequest) {
            facts.push(
                { kind: 'opened', instant: instant(a.changeRequest.openedAt) },
                ...a.changeRequest.commitDates.map((date) => ({ kind: 'commit' as const, instant: instant(date) }))
            )
            if (a.changeRequest.closedAt) facts.push({ kind: 'closed', instant: instant(a.changeRequest.closedAt) })
            if (a.changeRequest.mergedAt) facts.push({ kind: 'merged', instant: instant(a.changeRequest.mergedAt) })
        }
        for (const fact of new Map(
            facts
                .filter((f) => !a.changeRequest || f.instant >= instant(a.changeRequest.openedAt))
                .map((f) => [`${f.kind}:${f.instant}`, f])
        ).values())
            this.db
                .insert(t.activityDates)
                .values({ activityId: a.id, ...fact })
                .run()
        this.db.delete(t.activityFiles).where(eq(t.activityFiles.activityId, a.id)).run()
        for (const [position, file] of a.files.entries())
            this.db
                .insert(t.activityFiles)
                .values({
                    activityId: a.id,
                    name: file.name,
                    position,
                    status: file.status,
                    previousName: file.previousName,
                    additions: file.lineStats?.additions,
                    deletions: file.lineStats?.deletions,
                    binary: file.lineStats === null
                })
                .run()
    }
    applyAcquisitionBatch(batch: AcquisitionBatch, generation: string) {
        this.write(() => {
            const config = this.config()
            let branchesChanged = false
            if (batch.source) {
                const repository = config.repositories.find((r) => r.id === batch.source!.repositoryId)
                const configuration =
                    repository &&
                    (batch.source.provider === 'git' ? gitConfiguration : contributionConfiguration)(repository, {
                        settings: config.settings,
                        restoreId: config.generation
                    })
                if (!repository || repository.removed || configuration !== batch.source.configuration)
                    throw new DatabaseError(
                        'conflict',
                        'Repository settings changed. Refresh again to use the new settings.'
                    )
            }
            if (batch.repository) {
                const current = config.repositories.find((r) => r.id === batch.repository!.id)
                if (!current || current.removed)
                    throw new DatabaseError('conflict', 'This repository is no longer tracked.')
                branchesChanged = JSON.stringify(current.branches) !== JSON.stringify(batch.repository.branches)
                if (
                    branchesChanged ||
                    current.available !== batch.repository.available ||
                    JSON.stringify(current.remotes) !== JSON.stringify(batch.repository.remotes)
                )
                    this.putRepository({
                        ...current,
                        branches: batch.repository.branches,
                        remotes: batch.repository.remotes,
                        available: batch.repository.available
                    })
            }
            for (const activity of batch.activities ?? []) {
                if (activity.remoteSource) {
                    const account = config.accounts.find((a) => a.id === activity.remoteSource!.accountId)
                    if (
                        !account ||
                        account.generation !== activity.remoteSource.sessionGeneration ||
                        !['connected', 'session'].includes(account.status)
                    )
                        throw new DatabaseError('conflict', 'The connected account changed. Refresh again.')
                }
                this.putActivity(
                    batch.source?.provider === 'git' ? { ...activity, localQualified: true } : activity,
                    true
                )
            }
            if (batch.historyDelta && batch.repository) {
                const h = batch.historyDelta,
                    repositoryId = batch.repository.id
                const visible = new Set((batch.activities ?? []).map((item) => item.id))
                for (const item of h.items) if (!visible.has(item.id)) this.putActivity(item, true, false)
                const stored = this.db
                    .select()
                    .from(t.gitHistory)
                    .where(eq(t.gitHistory.repositoryId, repositoryId))
                    .get()
                const record = {
                    repositoryId,
                    configuration: h.configuration,
                    refs: h.refs,
                    nextOffset: h.nextOffset ?? null,
                    excludedTips: h.excludedTips ?? null
                }
                this.db
                    .insert(t.gitHistory)
                    .values(record)
                    .onConflictDoUpdate({ target: t.gitHistory.repositoryId, set: record })
                    .run()
                // History membership is append-only within a configuration; evidence survives reprojection.
                if (stored && stored.configuration !== h.configuration)
                    this.db.delete(t.gitHistoryItems).where(eq(t.gitHistoryItems.repositoryId, repositoryId)).run()
                const added = h.items.map((item) => ({ repositoryId, activityId: item.id }))
                for (let i = 0; i < added.length; i += 400)
                    this.db
                        .insert(t.gitHistoryItems)
                        .values(added.slice(i, i + 400))
                        .onConflictDoNothing()
                        .run()
                for (const group of h.memberships ?? [])
                    for (let i = 0; i < group.shas.length; i += 200) {
                        const ids = this.db
                            .select({ id: t.activities.id })
                            .from(t.activities)
                            .where(
                                and(
                                    eq(t.activities.repositoryId, repositoryId),
                                    inArray(t.activities.sha, group.shas.slice(i, i + 200))
                                )
                            )
                            .all()
                        const rows = ids.flatMap((item) =>
                            group.branches.map((name) => ({ activityId: item.id, name, deleted: false }))
                        )
                        for (let j = 0; j < rows.length; j += 300)
                            this.db
                                .insert(t.activityBranches)
                                .values(rows.slice(j, j + 300))
                                .onConflictDoNothing()
                                .run()
                    }
            }
            if (batch.repository && branchesChanged) {
                this.db
                    .update(t.activityBranches)
                    .set({
                        deleted: batch.repository.branches.length
                            ? sql`${t.activityBranches.name} NOT IN (${sql.join(
                                  batch.repository.branches.map((name) => sql`${name}`),
                                  sql`,`
                              )})`
                            : true
                    })
                    .where(
                        sql`${t.activityBranches.activityId} IN (SELECT id FROM activities WHERE repositoryId = ${batch.repository.id})`
                    )
                    .run()
            }
            if (batch.projectHistoryIds?.length && batch.repository) {
                if (batch.projectHistoryIds.length > 2000)
                    throw new DatabaseError('invalid', 'History projection page exceeds its work limit.')
                for (let i = 0; i < batch.projectHistoryIds.length; i += 400)
                    this.db
                        .update(t.activities)
                        .set({ journaled: true, localQualified: true })
                        .where(
                            and(
                                eq(t.activities.repositoryId, batch.repository.id),
                                inArray(t.activities.id, batch.projectHistoryIds.slice(i, i + 400)),
                                sql`${t.activities.id} IN (SELECT activityId FROM git_history_items WHERE repositoryId = ${batch.repository.id})`
                            )
                        )
                        .run()
            }
            if (batch.checkpoint) this.putCheckpoint(batch.checkpoint.key, batch.checkpoint.value)
        }, generation)
    }
    historyProjectionPage(repositoryId: string, after?: string) {
        return this.db
            .select({ id: t.activities.id, instant: t.activities.occurredAt, journaled: t.activities.journaled })
            .from(t.gitHistoryItems)
            .innerJoin(t.activities, eq(t.activities.id, t.gitHistoryItems.activityId))
            .where(
                and(
                    eq(t.gitHistoryItems.repositoryId, repositoryId),
                    after ? gt(t.gitHistoryItems.activityId, after) : undefined
                )
            )
            .orderBy(asc(t.gitHistoryItems.activityId))
            .limit(2000)
            .all()
    }
    history(repositoryId: string, includeItems = true): GitHistory | undefined {
        const h = this.db.select().from(t.gitHistory).where(eq(t.gitHistory.repositoryId, repositoryId)).get()
        if (!h) return undefined
        if (!includeItems)
            return {
                configuration: h.configuration,
                refs: h.refs,
                nextOffset: optional(h.nextOffset),
                excludedTips: optional(h.excludedTips),
                items: []
            }
        const items = this.db
            .select({ activity: t.activities })
            .from(t.gitHistoryItems)
            .innerJoin(t.activities, eq(t.activities.id, t.gitHistoryItems.activityId))
            .where(eq(t.gitHistoryItems.repositoryId, repositoryId))
            .all()
        return {
            configuration: h.configuration,
            refs: h.refs,
            nextOffset: optional(h.nextOffset),
            excludedTips: optional(h.excludedTips),
            items: this.hydrateActivities(items.map((r) => r.activity))
        }
    }
    patch(activityId: string): string | undefined {
        const patch = this.db
            .select({ id: t.patches.id, content: t.patches.content })
            .from(t.activities)
            .innerJoin(t.patches, eq(t.activities.patchId, t.patches.id))
            .where(eq(t.activities.id, activityId))
            .get()
        if (patch) this.db.update(t.patches).set({ accessedAt: this.now() }).where(eq(t.patches.id, patch.id)).run()
        return patch?.content
    }
    private putPatch(content: string): string {
        const id = createHash('sha256').update(content).digest('hex')
        this.db.insert(t.patches).values({ id, content, accessedAt: this.now() }).onConflictDoNothing().run()
        return id
    }
    activityRevisions(activityId: string): State['revisions'] {
        return this.db
            .select()
            .from(t.revisions)
            .where(eq(t.revisions.activityId, activityId))
            .all()
            .map((r) => ({
                id: r.id,
                activityId: r.activityId,
                base: r.base,
                head: r.head,
                fingerprint: optional(r.fingerprint),
                diff: ''
            }))
    }
    recordActivityDetails(
        activity: Activity,
        diff: string | undefined,
        revision: State['revisions'][number] | undefined,
        generation: string
    ) {
        this.write(() => {
            const current = this.activity(activity.id)
            if (activity.remoteSource) {
                const repository = this.repositories().find((r) => r.id === activity.repositoryId)
                const account = this.config().accounts.find((a) => a.id === activity.remoteSource!.accountId)
                if (
                    !repository ||
                    remoteConfiguration(repository) !== activity.remoteSource.configuration ||
                    !account ||
                    account.generation !== activity.remoteSource.sessionGeneration ||
                    !['connected', 'session'].includes(account.status)
                )
                    throw new DatabaseError('conflict', 'The connected account changed. Open this activity again.')
            }
            if (!current || current.sourceVersion !== activity.sourceVersion)
                throw new DatabaseError('conflict', 'Activity changed while loading. Open it again.')
            this.putActivity(
                {
                    ...current,
                    files: activity.files,
                    filesLoaded: activity.filesLoaded,
                    ...(revision
                        ? {
                              revision: revision.id,
                              fingerprint: activity.fingerprint,
                              head: activity.head,
                              ...(diff !== undefined ? { diffRevision: revision.id } : {})
                          }
                        : {})
                },
                false
            )
            if (revision) {
                const patchId = revision.diff || diff !== undefined ? this.putPatch(revision.diff) : undefined
                const value = {
                    id: revision.id,
                    activityId: activity.id,
                    base: revision.base,
                    head: revision.head,
                    fingerprint: revision.fingerprint ?? null,
                    patchId
                }
                this.db
                    .insert(t.revisions)
                    .values(value)
                    .onConflictDoUpdate({ target: t.revisions.id, set: value })
                    .run()
            }
            if (diff !== undefined)
                this.db
                    .update(t.activities)
                    .set({ patchId: this.putPatch(diff) })
                    .where(eq(t.activities.id, activity.id))
                    .run()
        }, generation)
    }
    updateActivityDate(id: string, date: string, sourceVersion: string | undefined, generation: string) {
        this.write(() => {
            const current = this.activity(id)
            if (!current || current.sourceVersion !== sourceVersion)
                throw new DatabaseError('conflict', 'Activity changed while comparing it. Refresh again.')
            this.putActivity({ ...current, date }, false)
        }, generation)
    }

    private selections(draftId: string): Selection[] {
        return this.db
            .select()
            .from(t.draftSelections)
            .where(eq(t.draftSelections.draftId, draftId))
            .orderBy(asc(t.draftSelections.position))
            .all()
            .map((r) => ({ activityId: r.activityId, revision: optional(r.revision) }))
    }
    draft(id: string): Draft | undefined {
        const row = this.db.select().from(t.drafts).where(eq(t.drafts.id, id)).get()
        return row
            ? { ...row, publishedEntryId: optional(row.publishedEntryId), selections: this.selections(id) }
            : undefined
    }
    draftForWeek(week: string): Draft | undefined {
        const row = this.db.select({ id: t.drafts.id }).from(t.drafts).where(eq(t.drafts.week, week)).get()
        return row ? this.draft(row.id) : undefined
    }
    createDraft(week: string, generation: string): Draft {
        return this.write(() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(Date.parse(week)))
                throw new DatabaseError('invalid', 'Choose a valid journal week')
            const existing = this.draftForWeek(week)
            if (existing) return existing
            const settings = this.config().settings
            const id = randomUUID()
            this.db
                .insert(t.drafts)
                .values({
                    id,
                    week,
                    title: `${week} – ${new Date(Date.parse(week) + 6 * 86400000).toISOString().slice(0, 10)}`,
                    body: settings.template,
                    updatedAt: new Date(this.now()).toISOString(),
                    version: 1
                })
                .run()
            this.setImageReferences(`draft:${id}`, settings.template)
            return this.draft(id)!
        }, generation)
    }
    openWriting(draftId: string, field: 'body' | 'title', generation: string): WritingState {
        return this.write(() => {
            const draft = this.draft(draftId)
            if (!draft) throw new DatabaseError('invalid', 'Draft is unavailable')
            const schema = field === 'body' ? bodySchema : titleSchema
            let row = this.db
                .select()
                .from(t.writingDocuments)
                .where(and(eq(t.writingDocuments.draftId, draftId), eq(t.writingDocuments.field, field)))
                .get()
            if (!row) {
                const document = schema.nodeFromJSON(field === 'body' ? draft.body : titleDocument(draft.title))
                document.check()
                row = { draftId, field, document: document.toJSON(), version: 0 }
                this.db.insert(t.writingDocuments).values(row).run()
            }
            return { ...row, generation, fromVersion: row.version, steps: [], clients: [] }
        }, generation)
    }
    private writingChanges(
        draftId: string,
        field: 'body' | 'title',
        generation: string,
        fromVersion: number
    ): WritingState {
        const row = this.db
            .select()
            .from(t.writingDocuments)
            .where(and(eq(t.writingDocuments.draftId, draftId), eq(t.writingDocuments.field, field)))
            .get()!
        const changes = this.db
            .select()
            .from(t.writingSteps)
            .where(
                and(
                    eq(t.writingSteps.draftId, draftId),
                    eq(t.writingSteps.field, field),
                    gte(t.writingSteps.version, fromVersion)
                )
            )
            .orderBy(asc(t.writingSteps.version))
            .all()
        return {
            ...row,
            generation,
            fromVersion,
            steps: changes.map((r) => r.step),
            clients: changes.map((r) => r.client)
        }
    }
    submitWriting(input: WritingRequest): WritingState {
        const request = writingRequest.parse(input)
        return this.write(() => {
            const { draftId, field, generation, version, client, steps } = request
            const row = this.db
                .select()
                .from(t.writingDocuments)
                .where(and(eq(t.writingDocuments.draftId, draftId), eq(t.writingDocuments.field, field)))
                .get()
            if (!row) throw new DatabaseError('invalid', 'Open writing before editing')
            if (version > row.version) throw new DatabaseError('invalid', 'Invalid writing version')
            // A lost acknowledgement is resolved by returning the durable ordered
            // history. receiveTransaction confirms our steps or rebases pending work.
            if (version !== row.version || !steps.length)
                return this.writingChanges(draftId, field, generation, version)
            if (writingSize(steps) > writingLimits.updateBytes)
                throw new DatabaseError('invalid', 'Writing update is too large')
            const schema = field === 'body' ? bodySchema : titleSchema
            let document = schema.nodeFromJSON(row.document)
            for (const json of steps) {
                const result = Step.fromJSON(schema, json).apply(document)
                if (!result.doc) throw new DatabaseError('invalid', 'Writing update is invalid')
                document = result.doc
                document.check()
            }
            if (writingSize(document.toJSON()) > writingLimits.documentBytes)
                throw new DatabaseError('invalid', 'This draft is too large to save')
            const body = document.toJSON() as JournalNode
            if (field === 'body') this.setImageReferences(`draft:${draftId}`, body)
            this.db
                .update(t.drafts)
                .set({
                    ...(field === 'body' ? { body } : { title: document.textContent }),
                    updatedAt: new Date(this.now()).toISOString(),
                    version: sql`${t.drafts.version}+1`
                })
                .where(eq(t.drafts.id, draftId))
                .run()
            for (const [offset, step] of steps.entries())
                this.db
                    .insert(t.writingSteps)
                    .values({ draftId, field, version: version + offset, client, step })
                    .run()
            this.db
                .update(t.writingDocuments)
                .set({ document: body, version: version + steps.length })
                .where(and(eq(t.writingDocuments.draftId, draftId), eq(t.writingDocuments.field, field)))
                .run()
            return this.writingChanges(draftId, field, generation, version)
        }, request.generation)
    }
    saveDraft(input: Draft, expectedVersion: number, generation: string): Draft {
        return this.write(() => {
            const draft = draftSchema.parse(input),
                previous = this.draft(draft.id)
            if (!previous) throw new DatabaseError('invalid', 'Draft is unavailable')
            if (this.db.select().from(t.writingDocuments).where(eq(t.writingDocuments.draftId, draft.id)).get())
                throw new DatabaseError(
                    'conflict',
                    'This draft uses a shared writing session. Reopen it before editing.'
                )
            if (
                previous.version === expectedVersion + 1 &&
                previous.title === draft.title &&
                JSON.stringify(previous.body) === JSON.stringify(draft.body)
            )
                return previous
            if (previous.version !== expectedVersion)
                throw new DatabaseError(
                    'conflict',
                    'This draft changed in another window. Your writing is kept locally; reload before saving.'
                )
            this.setImageReferences(`draft:${draft.id}`, draft.body)
            this.db
                .update(t.drafts)
                .set({
                    title: draft.title,
                    body: draft.body,
                    updatedAt: new Date(this.now()).toISOString(),
                    version: expectedVersion + 1
                })
                .where(eq(t.drafts.id, draft.id))
                .run()
            return this.draft(draft.id)!
        }, generation)
    }
    setSelection(draftId: string, selection: Selection, included: boolean, generation: string) {
        this.write(() => {
            if (included) {
                const position = this.selections(draftId).length
                this.db
                    .insert(t.draftSelections)
                    .values({ draftId, ...selection, position })
                    .onConflictDoNothing()
                    .run()
                this.db
                    .update(t.activities)
                    .set({ explicit: true })
                    .where(eq(t.activities.id, selection.activityId))
                    .run()
            } else
                this.db
                    .delete(t.draftSelections)
                    .where(
                        and(
                            eq(t.draftSelections.draftId, draftId),
                            eq(t.draftSelections.activityId, selection.activityId)
                        )
                    )
                    .run()
        }, generation)
    }
    setDisposition(
        id: string,
        disposition: Activity['disposition'],
        deferUntil: string | undefined,
        reason: string | undefined,
        generation: string
    ) {
        return this.write(
            () =>
                this.db
                    .update(t.activities)
                    .set({
                        disposition,
                        deferUntil: deferUntil ?? null,
                        reason: reason ?? null,
                        ...(disposition === 'inbox' ? { explicit: true } : {})
                    })
                    .where(eq(t.activities.id, id))
                    .run(),
            generation
        )
    }
    setCoverage(selection: Selection, entryId: string, linked: boolean, generation: string) {
        this.write(() => {
            if (linked)
                this.db
                    .insert(t.coverage)
                    .values({ ...selection, entryId })
                    .onConflictDoNothing()
                    .run()
            else
                this.db
                    .delete(t.coverage)
                    .where(and(eq(t.coverage.activityId, selection.activityId), eq(t.coverage.entryId, entryId)))
                    .run()
        }, generation)
    }

    publication(id: string): State['saves'][number] | undefined {
        const row = this.db.select().from(t.publications).where(eq(t.publications.id, id)).get()
        if (!row) return undefined
        return stateSchema.shape.saves.element.parse({
            ...row,
            ...Object.fromEntries(
                Object.entries(row)
                    .filter(([, v]) => v === null)
                    .map(([k]) => [k, undefined])
            ),
            selections: this.db
                .select()
                .from(t.publicationSelections)
                .where(eq(t.publicationSelections.publicationId, id))
                .orderBy(asc(t.publicationSelections.position))
                .all()
                .map((r) => ({ activityId: r.activityId, revision: optional(r.revision) }))
        })
    }
    listPublications(draftId?: string): State['saves'] {
        return this.db
            .select({ id: t.publications.id })
            .from(t.publications)
            .where(draftId ? eq(t.publications.draftId, draftId) : undefined)
            .orderBy(sql`rowid`)
            .all()
            .map((r) => this.publication(r.id)!)
    }
    beginPublication(draftId: string, generation: string) {
        return this.write(() => {
            const draft = this.draft(draftId)
            if (!draft) throw new DatabaseError('invalid', 'Draft does not exist')
            if (
                this.db
                    .select({ id: t.publications.id })
                    .from(t.publications)
                    .where(
                        and(eq(t.publications.draftId, draftId), inArray(t.publications.status, ['pending', 'unknown']))
                    )
                    .get()
            )
                throw new DatabaseError(
                    'conflict',
                    'This draft has an uncertain save. Verify it before publishing again.'
                )
            const previous = this.listPublications()
                .filter((s) => s.entryId === draft.publishedEntryId && s.status === 'confirmed')
                .at(-1)
            const destination = previous?.destination ?? this.config().settings.destination
            if (!destination) throw new DatabaseError('invalid', 'Connect Notion and choose a destination first')
            const id = randomUUID()
            this.db
                .insert(t.publications)
                .values({
                    id,
                    draftId,
                    status: 'pending',
                    marker: `gitorian-operation:${randomUUID()}`,
                    title: draft.title,
                    body: draft.body,
                    destination,
                    createdAt: new Date(this.now()).toISOString(),
                    week: draft.week,
                    entryId: draft.publishedEntryId,
                    updateExisting: !!draft.publishedEntryId
                })
                .run()
            for (const [position, s] of draft.selections.entries())
                this.db
                    .insert(t.publicationSelections)
                    .values({ publicationId: id, ...s, position })
                    .run()
            this.setImageReferences(`publication:${id}`, draft.body)
            return this.publication(id)!
        }, generation)
    }
    checkpointPublication(save: State['saves'][number], generation: string) {
        this.write(() => {
            const existing = this.publication(save.id)
            if (!existing || existing.status === 'confirmed')
                throw new DatabaseError('conflict', 'Publishing state changed. Reload the journal.')
            this.db
                .update(t.publications)
                .set({
                    status: save.status,
                    entryId: save.entryId ?? null,
                    error: save.error ?? null,
                    replacedBlockIds: save.replacedBlockIds ?? null,
                    imageUploads: save.imageUploads ?? null
                })
                .where(eq(t.publications.id, save.id))
                .run()
        }, generation)
    }
    recordPublicationOutcome(id: string, status: 'unknown' | 'failed', error: string, generation: string) {
        return this.write(
            () =>
                this.db
                    .update(t.publications)
                    .set({ status, error })
                    .where(and(eq(t.publications.id, id), inArray(t.publications.status, ['pending', 'unknown'])))
                    .run(),
            generation
        )
    }
    private putEntry(entry: Entry) {
        const parsed = entrySchema.parse(entry)
        const text = plainText(parsed.body)
        const value = {
            ...parsed,
            excerpt: text.slice(0, 200),
            searchText: `${parsed.title} ${parsed.date} ${text}`.toLocaleLowerCase('en-US')
        }
        this.setImageReferences(`entry:${entry.id}`, value.body)
        this.db.insert(t.entries).values(value).onConflictDoUpdate({ target: t.entries.id, set: value }).run()
    }
    entry(id: string): HistoryEntry | undefined {
        if (id.startsWith('local:')) {
            const draft = this.db
                .select({
                    title: t.drafts.title,
                    week: t.drafts.week,
                    body: t.drafts.body,
                    publishedEntryId: t.drafts.publishedEntryId
                })
                .from(t.drafts)
                .where(eq(t.drafts.id, id.slice(6)))
                .get()
            if (!draft) return undefined
            const publication = draft.publishedEntryId
                ? this.db
                      .select({ url: t.entries.url })
                      .from(t.entries)
                      .where(eq(t.entries.id, draft.publishedEntryId))
                      .get()
                : undefined
            return {
                id,
                title: draft.title,
                date: draft.week,
                week: draft.week,
                body: draft.body,
                excerpt: plainText(draft.body).slice(0, 200),
                url: publication?.url
            }
        }
        if (!id.startsWith('notion:')) return undefined
        const value = this.db
            .select()
            .from(t.entries)
            .where(eq(t.entries.id, id.slice(7)))
            .get()
        return value
            ? { id, title: value.title, date: value.date, body: value.body, excerpt: value.excerpt, url: value.url }
            : undefined
    }
    entryHistory(query: string, cursor?: { date: string; id: string }) {
        // Deduplicate before searching: old remote wording must not match a newer local document.
        // Body parsing stays in the worker; only the bounded summaries cross the interface.
        const rows = this.db.all<{ id: string; title: string; date: string; excerpt: string }>(sql`
            WITH history AS (
                SELECT 'local:' || id AS id, title, week AS date,
                    substr(journal_text(body), 1, 200) AS excerpt,
                    journal_lower(title || ' ' || week || ' ' || journal_text(body)) AS searchText
                FROM drafts
                WHERE publishedEntryId IS NOT NULL
                    OR (trim(title) <> '' AND title <> week || ' – ' || date(week, '+6 days'))
                    OR trim(journal_text(body)) <> ''
                    OR EXISTS (SELECT 1 FROM json_tree(body) WHERE key = 'type' AND value IN ('image', 'horizontalRule'))
                UNION ALL
                SELECT 'notion:' || id, title, date, excerpt, searchText FROM entries
                WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE publishedEntryId = entries.id)
            )
            SELECT id, title, date, excerpt FROM history
            WHERE instr(searchText, ${query.trim().toLocaleLowerCase('en-US')}) > 0
                ${cursor ? sql`AND (date < ${cursor.date} OR (date = ${cursor.date} AND id < ${cursor.id}))` : sql``}
            ORDER BY date DESC, id DESC LIMIT 51
        `)
        const items = rows.slice(0, 50),
            last = items.at(-1)
        return { items, next: rows.length > 50 && last ? { date: last.date, id: last.id } : undefined }
    }
    refreshEntry(entry: Entry, generation: string, expected?: Pick<Entry, 'body' | 'title'>) {
        this.write(() => {
            const current = this.db.select().from(t.entries).where(eq(t.entries.id, entry.id)).get()
            if (
                expected &&
                current &&
                (JSON.stringify(current.body) !== JSON.stringify(expected.body) || current.title !== expected.title)
            )
                throw new DatabaseError('conflict', 'Published writing changed during refresh. Refresh again.')
            const body =
                current && JSON.stringify(toNotion(current.body)) === JSON.stringify(toNotion(entry.body))
                    ? current.body
                    : entry.body
            this.putEntry({ ...entry, body })
        }, generation)
    }
    confirmPublication(id: string, entry: Entry, generation: string) {
        this.write(() => {
            const save = this.publication(id)
            if (!save || !['pending', 'unknown'].includes(save.status))
                throw new DatabaseError('conflict', 'Publishing state changed. Reload the journal.')
            this.putEntry(entry)
            for (const selected of save.selections)
                this.db
                    .insert(t.coverage)
                    .values({ ...selected, entryId: entry.id })
                    .onConflictDoNothing()
                    .run()
            this.db
                .update(t.publications)
                .set({ status: 'confirmed', entryId: entry.id, error: null })
                .where(eq(t.publications.id, id))
                .run()
            this.db.update(t.drafts).set({ publishedEntryId: entry.id }).where(eq(t.drafts.id, save.draftId)).run()
        }, generation)
    }

    private setImageReferences(owner: string, body: JournalNode) {
        this.db.delete(t.imageReferences).where(eq(t.imageReferences.owner, owner)).run()
        for (const imageId of new Set(imageIds(body))) {
            if (!this.db.select({ id: t.images.id }).from(t.images).where(eq(t.images.id, imageId)).get())
                throw new DatabaseError('invalid', 'A referenced image is missing. Restore it from a backup.')
            this.db.insert(t.imageReferences).values({ owner, imageId }).run()
        }
    }
    image(id: string): JournalImage | undefined {
        const row = this.db.select().from(t.images).where(eq(t.images.id, id)).get()
        return row ? { ...row, mime: row.mime as JournalImage['mime'] } : undefined
    }
    importImage(image: JournalImage, generation: string) {
        return this.write(() => {
            this.db
                .insert(t.images)
                .values({ ...image, bytes: Buffer.from(image.bytes) })
                .onConflictDoNothing()
                .run()
            return image.id
        }, generation)
    }
    collectCaches() {
        return this.write(() => {
            const cutoff = this.now() - 30 * 86400000
            const attempts = this.db
                .select({
                    id: t.publications.id,
                    draftId: t.publications.draftId,
                    status: t.publications.status,
                    createdAt: t.publications.createdAt
                })
                .from(t.publications)
                .orderBy(sql`rowid`)
                .all()
            const latest = new Map<string, string>()
            for (const attempt of attempts) if (attempt.status === 'confirmed') latest.set(attempt.draftId, attempt.id)
            const removable = attempts
                .filter(
                    (a) =>
                        ['failed', 'confirmed'].includes(a.status) &&
                        Date.parse(a.createdAt) < cutoff &&
                        latest.get(a.draftId) !== a.id
                )
                .slice(0, 100)
            for (const attempt of removable) {
                this.db
                    .delete(t.imageReferences)
                    .where(eq(t.imageReferences.owner, `publication:${attempt.id}`))
                    .run()
                this.db.delete(t.publications).where(eq(t.publications.id, attempt.id)).run()
            }
            const expired = this.db
                .select({ id: t.patches.id })
                .from(t.patches)
                .where(sql`${t.patches.accessedAt}<${cutoff}
                AND NOT EXISTS (SELECT 1 FROM activity_revisions r WHERE r.patchId=patches.id AND (
                    EXISTS(SELECT 1 FROM draft_selections d WHERE d.revision=r.id) OR
                    EXISTS(SELECT 1 FROM publication_selections p WHERE p.revision=r.id) OR
                    EXISTS(SELECT 1 FROM entry_coverage c WHERE c.revision=r.id)))`)
                .limit(100)
                .all()
                .map((p) => p.id)
            if (expired.length) {
                this.db.update(t.activities).set({ patchId: null }).where(inArray(t.activities.patchId, expired)).run()
                this.db.update(t.revisions).set({ patchId: null }).where(inArray(t.revisions.patchId, expired)).run()
                this.db.delete(t.patches).where(inArray(t.patches.id, expired)).run()
            }
            // Imported images may be owned only by renderer recovery after a failed save.
            // They are durable user content; only an explicit restore/discard may remove them.
            return { patches: expired.length, publications: removable.length }
        })
    }

    readWorkspace(view?: JournalView): State {
        const config = this.config(),
            state = initialState()
        const { generation, sequence, ...metadata } = config
        const { accountPreparations: _preparations, credentialCleanup: _cleanup, accounts, ...safeMetadata } = metadata
        Object.assign(state, {
            ...safeMetadata,
            accounts: accounts.map(({ credentialKey: _key, ...account }) => account),
            version: 1,
            restoreId: generation,
            snapshotVersion: sequence
        })
        const week = view?.since ?? weekOf(new Date(this.now()), config.settings)
        const until = view?.until ?? new Date(Date.parse(week) + 6 * 86400000).toISOString().slice(0, 10)
        const midnight = (date: string) => {
            let lower = Date.parse(date) - 86400000,
                upper = Date.parse(date) + 86400000
            while (lower < upper) {
                const middle = Math.floor((lower + upper) / 2)
                if (localDate(new Date(middle), config.settings.timezone) < date) lower = middle + 1
                else upper = middle
            }
            return lower
        }
        const start = midnight(week),
            end = midnight(new Date(Date.parse(until) + 86400000).toISOString().slice(0, 10))
        const candidates = this.db
            .selectDistinct({ id: t.activities.id, instant: t.activities.occurredAt })
            .from(t.activities)
            .innerJoin(t.activityDates, eq(t.activityDates.activityId, t.activities.id))
            .where(
                and(
                    eq(t.activities.journaled, true),
                    gte(t.activityDates.instant, start),
                    lt(t.activityDates.instant, end),
                    view?.cursor
                        ? or(
                              lt(t.activities.occurredAt, view.cursor.instant),
                              and(eq(t.activities.occurredAt, view.cursor.instant), lt(t.activities.id, view.cursor.id))
                          )
                        : undefined
                )
            )
            .orderBy(desc(t.activities.occurredAt), desc(t.activities.id))
            .limit(Math.min(view?.limit ?? 500, 2000) + 1)
            .all()
        const limit = Math.min(view?.limit ?? 500, 2000)
        const page = candidates.slice(0, limit)
        const ids = new Set(page.map((r) => r.id))
        if (view?.activityId) ids.add(view.activityId)
        state.drafts = this.db
            .select({ id: t.drafts.id })
            .from(t.drafts)
            .where(eq(t.drafts.week, week))
            .all()
            .map((r) => this.draft(r.id)!)
        for (const draft of state.drafts) for (const selection of draft.selections) ids.add(selection.activityId)
        const rows = ids.size
            ? this.db
                  .select()
                  .from(t.activities)
                  .where(inArray(t.activities.id, [...ids]))
                  .all()
            : []
        const records = new Map(rows.map((row) => [row.id, row]))
        state.activities = this.hydrateActivities([...ids].flatMap((id) => (records.has(id) ? [records.get(id)!] : [])))
        const entryIds = new Set(state.drafts.flatMap((d) => (d.publishedEntryId ? [d.publishedEntryId] : [])))
        if (view?.entryId) entryIds.add(view.entryId)
        const links = ids.size
            ? this.db
                  .select()
                  .from(t.coverage)
                  .where(inArray(t.coverage.activityId, [...ids]))
                  .all()
            : []
        for (const link of links) entryIds.add(link.entryId)
        state.coverage = links.map((l) => ({
            activityId: l.activityId,
            entryId: l.entryId,
            revision: optional(l.revision)
        }))
        state.entries = entryIds.size
            ? this.db
                  .select()
                  .from(t.entries)
                  .where(inArray(t.entries.id, [...entryIds]))
                  .all()
                  .map((row) => entrySchema.parse(row))
            : []
        state.revisions = ids.size
            ? this.db
                  .select()
                  .from(t.revisions)
                  .where(inArray(t.revisions.activityId, [...ids]))
                  .all()
                  .map((row) => ({
                      id: row.id,
                      activityId: row.activityId,
                      base: row.base,
                      head: row.head,
                      fingerprint: optional(row.fingerprint),
                      diff: ''
                  }))
            : []
        state.saves = state.drafts.flatMap((d) => this.listPublications(d.id))
        state.activityPage = {
            since: week,
            until,
            next: candidates.length > limit && page.length ? page[page.length - 1] : undefined
        }
        return state
    }
    exportJournal(): string {
        const bytes = this.db
            .select({ value: sql<number>`coalesce(sum(4*((length(${t.images.bytes})+2)/3)),0)` })
            .from(t.images)
            .get()!.value
        if (bytes > imageLimits.backup)
            throw new DatabaseError('invalid', 'The journal exceeds the 512 MiB backup limit.')
        const {
                generation,
                sequence,
                accountPreparations: _preparations,
                credentialCleanup: _cleanup,
                acquisition: _acquisition,
                ...config
            } = this.config(),
            state = { ...initialState(), ...config, restoreId: generation, snapshotVersion: sequence }
        state.activities = this.listActivities()
        state.repositories = config.repositories.map((r) => ({ ...r, path: '' }))
        state.drafts = this.db
            .select({ id: t.drafts.id })
            .from(t.drafts)
            .orderBy(asc(t.drafts.week))
            .all()
            .map((r) => this.draft(r.id)!)
        state.entries = this.db
            .select()
            .from(t.entries)
            .all()
            .map((row) => entrySchema.parse(row))
        state.revisions = state.activities.flatMap((a) => this.activityRevisions(a.id))
        state.saves = this.listPublications()
        for (const activity of state.activities) {
            const patch = this.patch(activity.id)
            if (patch !== undefined) state.diffs[activity.id] = patch
        }
        for (const revision of state.revisions) {
            const value = this.db
                .select({ content: t.patches.content })
                .from(t.revisions)
                .innerJoin(t.patches, eq(t.revisions.patchId, t.patches.id))
                .where(eq(t.revisions.id, revision.id))
                .get()
            revision.diff = value?.content ?? ''
        }
        state.coverage = this.db
            .select()
            .from(t.coverage)
            .all()
            .map((r) => ({ activityId: r.activityId, revision: optional(r.revision), entryId: r.entryId }))
        const images = this.db
            .select()
            .from(t.images)
            .all()
            .map((i) => ({
                id: i.id,
                mime: i.mime,
                width: i.width,
                height: i.height,
                bytes: i.bytes.toString('base64')
            }))
        state.accounts = config.accounts.map(({ credentialKey: _key, ...account }) => ({
            ...account,
            status: 'disconnected'
        }))
        const result = JSON.stringify({ backupVersion: 4, state, images })
        if (Buffer.byteLength(result) > imageLimits.backup)
            throw new DatabaseError('invalid', 'The journal exceeds the 512 MiB backup limit.')
        return result
    }
    restore(state: State, images: JournalImage[]) {
        state = stateSchema.parse(state)
        state.settings = parseSettings(state.settings)
        for (const repository of state.repositories) {
            if (!repository.accountId) continue
            const account = state.accounts.find((a) => a.id === repository.accountId)
            const remote = providerRemote(repository.remote)
            if (!account || !remote || remote.provider !== account.provider || remote.host !== account.host)
                throw new DatabaseError('invalid', 'The backup contains an invalid repository account assignment.')
        }
        this.write(() => {
            const config = this.config()
            const keys = new Set([
                'github',
                ...config.accounts.flatMap((a) => (a.credentialKey ? [a.credentialKey] : [])),
                ...config.accountPreparations.flatMap((a) =>
                    [a.credentialKey, a.predecessorKey].filter((k): k is string => !!k)
                )
            ])
            for (const key of keys) this.db.insert(t.credentialCleanup).values({ key }).onConflictDoNothing().run()
            // FK order deliberately keeps every replacement atomic.
            for (const table of [
                t.imageReferences,
                t.coverage,
                t.draftSelections,
                t.publicationSelections,
                t.publications,
                t.drafts,
                t.entries,
                t.gitHistoryItems,
                t.gitHistory,
                t.revisions,
                t.activityFiles,
                t.activityBranches,
                t.activityDates,
                t.activities,
                t.patches,
                t.repositoryBranches,
                t.repositoryEmails,
                t.repositories,
                t.providerAccounts,
                t.providerPreparations,
                t.acquisition,
                t.transportPauses,
                t.images
            ])
                this.db.delete(table).run()
            for (const image of images)
                this.db
                    .insert(t.images)
                    .values({ ...image, bytes: Buffer.from(image.bytes) })
                    .run()
            for (const repository of state.repositories)
                this.putRepository({ ...repository, path: '', available: false })
            for (const account of state.accounts)
                this.db
                    .insert(t.providerAccounts)
                    .values({
                        id: account.id,
                        identity: JSON.stringify([account.provider, account.host, account.userId]),
                        metadata: { ...account, status: 'disconnected' }
                    })
                    .run()
            for (const activity of state.activities) this.putActivity(activity, false)
            for (const revision of state.revisions)
                this.db
                    .insert(t.revisions)
                    .values({
                        id: revision.id,
                        activityId: revision.activityId,
                        base: revision.base,
                        head: revision.head,
                        fingerprint: revision.fingerprint,
                        patchId: this.putPatch(revision.diff)
                    })
                    .run()
            for (const [id, content] of Object.entries(state.diffs)) {
                if (!this.activity(id))
                    throw new DatabaseError('invalid', 'The backup contains a patch without its activity.')
                this.db
                    .update(t.activities)
                    .set({ patchId: this.putPatch(content) })
                    .where(eq(t.activities.id, id))
                    .run()
            }
            for (const entry of state.entries) this.putEntry(entry)
            for (const draft of state.drafts) {
                this.db
                    .insert(t.drafts)
                    .values({ ...draft, version: 1 })
                    .run()
                this.setImageReferences(`draft:${draft.id}`, draft.body)
                for (const [position, selection] of draft.selections.entries())
                    this.db
                        .insert(t.draftSelections)
                        .values({ draftId: draft.id, ...selection, position })
                        .run()
            }
            for (const link of state.coverage) this.db.insert(t.coverage).values(link).run()
            for (const save of state.saves) {
                this.db
                    .insert(t.publications)
                    .values({ ...save, status: save.status === 'pending' ? 'unknown' : save.status })
                    .run()
                this.setImageReferences(`publication:${save.id}`, save.body)
                for (const [position, selection] of save.selections.entries())
                    this.db
                        .insert(t.publicationSelections)
                        .values({ publicationId: save.id, ...selection, position })
                        .run()
            }
            this.setImageReferences('template', state.settings.template)
            this.db
                .update(t.journal)
                .set({
                    generation: randomUUID(),
                    settings: state.settings,
                    repositoryImport: null,
                    lastRefreshed: state.lastRefreshed ?? null,
                    lastRefreshAttempt: null,
                    refreshError: null
                })
                .where(eq(t.journal.id, 1))
                .run()
        })
    }
    close() {
        this.native.close()
    }
}
