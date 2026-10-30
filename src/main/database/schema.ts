import { sql } from 'drizzle-orm'
import {
    blob,
    check,
    foreignKey,
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
    type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'
import type { Activity, Destination, JournalNode, Repository, State } from '../../shared/model'
import type { ProviderAccount, ProviderPreparation } from '../../shared/provider-accounts'

export const providerAccounts = sqliteTable('provider_accounts', {
    id: text().primaryKey(),
    identity: text().notNull().unique(),
    metadata: text({ mode: 'json' }).$type<ProviderAccount>().notNull()
})
export const providerPreparations = sqliteTable('provider_preparations', {
    id: text().primaryKey(),
    metadata: text({ mode: 'json' }).$type<ProviderPreparation>().notNull()
})
export const credentialCleanup = sqliteTable('provider_credential_cleanup', {
    key: text().primaryKey()
})

export const journal = sqliteTable(
    'journal',
    {
        id: integer().primaryKey(),
        generation: text().notNull(),
        sequence: integer().notNull(),
        providerUpgrade: integer({ mode: 'boolean' }).notNull().default(false),
        settings: text({ mode: 'json' }).$type<State['settings']>().notNull(),
        lastRefreshed: text(),
        lastRefreshAttempt: text(),
        refreshError: text(),
        repositoryImport: text({ mode: 'json' }).$type<State['repositoryImport']>()
    },
    (t) => [check('journal_singleton', sql`${t.id}=1`), check('settings_json', sql`json_valid(${t.settings})`)]
)

export const repositories = sqliteTable(
    'repositories',
    {
        id: text().primaryKey(),
        name: text().notNull(),
        path: text().notNull(),
        remote: text().notNull(),
        accountId: text(),
        providerProjectId: text(),
        accountGeneration: integer(),
        assignment: text({ enum: ['automatic', 'explicit'] }),
        base: text().notNull(),
        trackingStart: text().notNull(),
        available: integer({ mode: 'boolean' }).notNull(),
        removed: integer({ mode: 'boolean' }).notNull(),
        branchBases: text({ mode: 'json' }).$type<Repository['branchBases']>().notNull(),
        remotes: text({ mode: 'json' }).$type<string[]>().notNull()
    },
    (t) => [
        check('repository_flags', sql`${t.available} IN (0,1) AND ${t.removed} IN (0,1)`),
        uniqueIndex('repository_path')
            .on(t.path)
            .where(sql`${t.path}<>''`)
    ]
)
export const repositoryEmails = sqliteTable(
    'repository_emails',
    {
        repositoryId: text()
            .notNull()
            .references(() => repositories.id, { onDelete: 'cascade' }),
        email: text().notNull()
    },
    (t) => [primaryKey({ columns: [t.repositoryId, t.email] })]
)
export const repositoryBranches = sqliteTable(
    'repository_branches',
    {
        repositoryId: text()
            .notNull()
            .references(() => repositories.id, { onDelete: 'cascade' }),
        name: text().notNull()
    },
    (t) => [primaryKey({ columns: [t.repositoryId, t.name] })]
)

export const patches = sqliteTable(
    'patches',
    { id: text().primaryKey(), content: text().notNull(), accessedAt: integer().notNull() },
    (t) => [index('patch_access').on(t.accessedAt)]
)
export const activities = sqliteTable(
    'activities',
    {
        id: text().primaryKey(),
        repositoryId: text()
            .notNull()
            .references(() => repositories.id),
        kind: text({ enum: ['commit', 'change-request', 'review', 'opened', 'merged'] }).notNull(),
        title: text().notNull(),
        occurredAt: integer().notNull(),
        author: text().notNull(),
        sha: text(),
        changeRequestId: text('prId'),
        url: text(),
        description: text().notNull(),
        revision: text(),
        diffRevision: text(),
        patchId: text().references(() => patches.id),
        base: text(),
        head: text(),
        fingerprint: text(),
        integrationSha: text(),
        sourceVersion: text(),
        revisionSource: text({ mode: 'json' }).$type<Activity['revisionSource']>(),
        localQualified: integer({ mode: 'boolean' }).notNull().default(false),
        remoteIdentity: text(),
        remoteSource: text({ mode: 'json' }).$type<Activity['remoteSource']>(),
        filesLoaded: integer({ mode: 'boolean' }).notNull(),
        disposition: text({ enum: ['inbox', 'deferred', 'dismissed'] }).notNull(),
        deferUntil: text(),
        reason: text(),
        explicit: integer({ mode: 'boolean' }).notNull(),
        journaled: integer({ mode: 'boolean' }).notNull(),
        prStatus: text({ enum: ['open', 'draft', 'closed', 'merged'] }),
        openedAt: integer(),
        closedAt: integer(),
        mergedAt: integer()
    },
    (t) => [
        index('activity_repository_date').on(t.repositoryId, t.occurredAt, t.id),
        index('activity_date').on(t.occurredAt, t.id),
        uniqueIndex('activity_remote_identity').on(t.repositoryId, t.remoteIdentity),
        index('activity_pr').on(t.repositoryId, t.changeRequestId),
        index('activity_inbox').on(t.disposition, t.deferUntil, t.occurredAt),
        foreignKey({
            columns: [t.id, t.revision],
            foreignColumns: [revisions.activityId, revisions.id],
            name: 'activity_current_revision'
        }),
        foreignKey({
            columns: [t.id, t.diffRevision],
            foreignColumns: [revisions.activityId, revisions.id],
            name: 'activity_cached_revision'
        }),
        check('activity_kind', sql`${t.kind} IN ('commit','change-request','review','opened','merged')`),
        check('activity_disposition', sql`${t.disposition} IN ('inbox','deferred','dismissed')`),
        check('activity_flags', sql`${t.explicit} IN (0,1) AND ${t.filesLoaded} IN (0,1) AND ${t.journaled} IN (0,1)`)
    ]
)
export const activityBranches = sqliteTable(
    'activity_branches',
    {
        activityId: text()
            .notNull()
            .references(() => activities.id, { onDelete: 'cascade' }),
        name: text().notNull(),
        deleted: integer({ mode: 'boolean' }).notNull()
    },
    (t) => [primaryKey({ columns: [t.activityId, t.name] }), index('branch_activity').on(t.name, t.activityId)]
)
export const activityDates = sqliteTable(
    'activity_dates',
    {
        activityId: text()
            .notNull()
            .references(() => activities.id, { onDelete: 'cascade' }),
        instant: integer().notNull(),
        kind: text({ enum: ['activity', 'commit', 'opened', 'closed', 'merged'] }).notNull()
    },
    (t) => [primaryKey({ columns: [t.activityId, t.kind, t.instant] }), index('event_date').on(t.instant, t.activityId)]
)
export const activityFiles = sqliteTable(
    'activity_files',
    {
        activityId: text()
            .notNull()
            .references(() => activities.id, { onDelete: 'cascade' }),
        name: text().notNull(),
        position: integer().notNull(),
        status: text().notNull(),
        previousName: text(),
        additions: integer(),
        deletions: integer(),
        binary: integer({ mode: 'boolean' }).notNull()
    },
    (t) => [
        primaryKey({ columns: [t.activityId, t.name] }),
        check(
            'file_counts',
            sql`(${t.additions} IS NULL OR ${t.additions}>=0) AND (${t.deletions} IS NULL OR ${t.deletions}>=0)`
        )
    ]
)
export const revisions = sqliteTable(
    'activity_revisions',
    {
        id: text().primaryKey(),
        activityId: text()
            .notNull()
            .references((): AnySQLiteColumn => activities.id),
        base: text().notNull(),
        head: text().notNull(),
        fingerprint: text(),
        patchId: text().references(() => patches.id)
    },
    (t) => [
        uniqueIndex('revision_owner').on(t.activityId, t.id),
        index('revision_fingerprint').on(t.activityId, t.fingerprint)
    ]
)

export const entries = sqliteTable(
    'entries',
    {
        id: text().primaryKey(),
        title: text().notNull(),
        date: text().notNull(),
        url: text().notNull(),
        body: text({ mode: 'json' }).$type<JournalNode>().notNull(),
        refreshedAt: text().notNull(),
        excerpt: text().notNull(),
        searchText: text().notNull()
    },
    (t) => [check('entry_body', sql`json_valid(${t.body})`), index('entry_date').on(t.date, t.id)]
)
export const drafts = sqliteTable(
    'drafts',
    {
        id: text().primaryKey(),
        week: text().notNull().unique(),
        title: text().notNull(),
        body: text({ mode: 'json' }).$type<JournalNode>().notNull(),
        updatedAt: text().notNull(),
        publishedEntryId: text().references(() => entries.id),
        version: integer().notNull()
    },
    (t) => [check('draft_body', sql`json_valid(${t.body})`), check('draft_version', sql`${t.version}>0`)]
)
export const draftSelections = sqliteTable(
    'draft_selections',
    {
        draftId: text()
            .notNull()
            .references(() => drafts.id, { onDelete: 'cascade' }),
        activityId: text()
            .notNull()
            .references(() => activities.id),
        revision: text(),
        position: integer().notNull()
    },
    (t) => [
        primaryKey({ columns: [t.draftId, t.activityId] }),
        index('selected_revision').on(t.revision),
        foreignKey({ columns: [t.activityId, t.revision], foreignColumns: [revisions.activityId, revisions.id] })
    ]
)
export const coverage = sqliteTable(
    'entry_coverage',
    {
        id: integer().primaryKey(),
        activityId: text()
            .notNull()
            .references(() => activities.id),
        revision: text(),
        entryId: text()
            .notNull()
            .references(() => entries.id, { onDelete: 'cascade' })
    },
    (t) => [
        foreignKey({ columns: [t.activityId, t.revision], foreignColumns: [revisions.activityId, revisions.id] }),
        index('covered_revision').on(t.revision),
        uniqueIndex('coverage_commit')
            .on(t.activityId, t.entryId)
            .where(sql`${t.revision} IS NULL`),
        uniqueIndex('coverage_revision')
            .on(t.activityId, t.revision, t.entryId)
            .where(sql`${t.revision} IS NOT NULL`)
    ]
)
export const publications = sqliteTable(
    'publication_attempts',
    {
        id: text().primaryKey(),
        draftId: text()
            .notNull()
            .references(() => drafts.id),
        status: text({ enum: ['pending', 'unknown', 'failed', 'confirmed'] }).notNull(),
        marker: text().notNull().unique(),
        title: text().notNull(),
        body: text({ mode: 'json' }).$type<JournalNode>().notNull(),
        destination: text({ mode: 'json' }).$type<Destination>().notNull(),
        createdAt: text().notNull(),
        week: text(),
        entryId: text(),
        replacedBlockIds: text({ mode: 'json' }).$type<string[]>(),
        updateExisting: integer({ mode: 'boolean' }),
        error: text(),
        imageUploads: text({ mode: 'json' }).$type<State['saves'][number]['imageUploads']>()
    },
    (t) => [
        uniqueIndex('one_unresolved_publication')
            .on(t.draftId)
            .where(sql`${t.status} IN ('pending','unknown')`),
        check('publication_status', sql`${t.status} IN ('pending','unknown','failed','confirmed')`),
        check('publication_documents', sql`json_valid(${t.body}) AND json_valid(${t.destination})`)
    ]
)
export const publicationSelections = sqliteTable(
    'publication_selections',
    {
        publicationId: text()
            .notNull()
            .references(() => publications.id, { onDelete: 'cascade' }),
        activityId: text()
            .notNull()
            .references(() => activities.id),
        revision: text(),
        position: integer().notNull()
    },
    (t) => [
        primaryKey({ columns: [t.publicationId, t.activityId] }),
        index('publication_revision').on(t.revision),
        foreignKey({ columns: [t.activityId, t.revision], foreignColumns: [revisions.activityId, revisions.id] })
    ]
)
export const acquisition = sqliteTable(
    'acquisition_checkpoints',
    {
        key: text().primaryKey(),
        status: text().notNull(),
        retryAt: text(),
        provider: text({ enum: ['git', 'remote', 'notion'] }).notNull(),
        repositoryId: text().references(() => repositories.id, { onDelete: 'cascade' }),
        cursor: text({ mode: 'json' })
            .$type<
                Omit<
                    NonNullable<State['acquisition']>[string],
                    'status' | 'retryAt' | 'versions' | 'refs' | 'excludedTips'
                >
            >()
            .notNull()
    },
    (t) => [
        check('acquisition_status', sql`${t.status} IN ('idle','running','paused','error','cancelled')`),
        check('acquisition_cursor', sql`json_valid(${t.cursor})`),
        check(
            'acquisition_source',
            sql`(${t.provider}='notion' AND ${t.repositoryId} IS NULL) OR (${t.provider} IN ('git','remote') AND ${t.repositoryId} IS NOT NULL)`
        )
    ]
)
export const acquisitionVersions = sqliteTable(
    'acquisition_versions',
    {
        key: text()
            .notNull()
            .references(() => acquisition.key, { onDelete: 'cascade' }),
        sourceId: text().notNull(),
        version: text().notNull()
    },
    (t) => [primaryKey({ columns: [t.key, t.sourceId] })]
)
export const transportPauses = sqliteTable('transport_pauses', {
    scope: text().primaryKey(),
    until: integer().notNull()
})
export const gitHistory = sqliteTable('git_history', {
    repositoryId: text()
        .primaryKey()
        .references(() => repositories.id, { onDelete: 'cascade' }),
    configuration: text().notNull(),
    refs: text({ mode: 'json' }).$type<Record<string, string>>().notNull(),
    nextOffset: integer(),
    excludedTips: text({ mode: 'json' }).$type<string[]>()
})
export const gitHistoryItems = sqliteTable(
    'git_history_items',
    {
        repositoryId: text()
            .notNull()
            .references(() => gitHistory.repositoryId, { onDelete: 'cascade' }),
        activityId: text()
            .notNull()
            .references(() => activities.id, { onDelete: 'cascade' })
    },
    (t) => [primaryKey({ columns: [t.repositoryId, t.activityId] })]
)
export const images = sqliteTable(
    'images',
    {
        id: text().primaryKey(),
        mime: text().notNull(),
        width: integer().notNull(),
        height: integer().notNull(),
        bytes: blob({ mode: 'buffer' }).notNull()
    },
    (t) => [check('image_dimensions', sql`${t.width}>0 AND ${t.height}>0`)]
)
export const imageReferences = sqliteTable(
    'document_images',
    {
        owner: text().notNull(),
        imageId: text()
            .notNull()
            .references(() => images.id)
    },
    (t) => [primaryKey({ columns: [t.owner, t.imageId] }), index('image_owners').on(t.imageId)]
)
