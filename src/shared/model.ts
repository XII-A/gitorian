import { z } from 'zod'
import type { StateCursor, UpdateReply } from './state-updates'

export const documentSchema: z.ZodType<JournalNode> = z.lazy(() =>
    z.object({
        type: z.string(),
        text: z.string().optional(),
        attrs: z.record(z.string(), z.unknown()).optional(),
        marks: z.array(z.object({ type: z.string(), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
        content: z.array(documentSchema).optional()
    })
)
export interface JournalNode {
    type: string
    text?: string
    attrs?: Record<string, unknown>
    marks?: { type: string; attrs?: Record<string, unknown> }[]
    content?: JournalNode[]
}
export const emptyDocument: JournalNode = { type: 'doc', content: [{ type: 'paragraph' }] }
export const repositorySchema = z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    remote: z.string(),
    base: z.string(),
    trackingStart: z.string(),
    emails: z.array(z.string()),
    available: z.boolean(),
    removed: z.boolean(),
    branchBases: z.record(z.string(), z.string()),
    branches: z.array(z.string()).default([]),
    remotes: z.array(z.string()).optional()
})
export const activitySchema = z.object({
    id: z.string(),
    repositoryId: z.string(),
    kind: z.enum(['commit', 'pr', 'review', 'opened', 'merged']),
    title: z.string(),
    date: z.string(),
    author: z.string(),
    branches: z.array(z.string()),
    sha: z.string().optional(),
    prId: z.string().optional(),
    pullRequest: z
        .object({
            status: z.enum(['open', 'draft', 'closed', 'merged']).optional(),
            openedAt: z.string(),
            commitDates: z.array(z.string()),
            closedAt: z.string().optional(),
            mergedAt: z.string().optional()
        })
        .optional(),
    url: z.string().optional(),
    description: z.string(),
    files: z.array(z.object({ name: z.string(), status: z.string(), previousName: z.string().optional() })),
    revision: z.string().optional(),
    diffRevision: z.string().optional(),
    base: z.string().optional(),
    head: z.string().optional(),
    fingerprint: z.string().optional(),
    integrationSha: z.string().optional(),
    sourceVersion: z.string().optional(),
    filesLoaded: z.boolean().optional(),
    disposition: z.enum(['inbox', 'deferred', 'dismissed']),
    deferUntil: z.string().optional(),
    reason: z.string().optional(),
    explicit: z.boolean(),
    deletedBranches: z.array(z.string())
})
export const selectionSchema = z.object({ activityId: z.string(), revision: z.string().optional() })
export const draftSchema = z.object({
    id: z.string(),
    week: z.string(),
    title: z.string(),
    body: documentSchema,
    selections: z.array(selectionSchema),
    updatedAt: z.string(),
    publishedEntryId: z.string().optional()
})
export const entrySchema = z.object({
    id: z.string(),
    title: z.string(),
    date: z.string(),
    url: z.string(),
    body: documentSchema,
    refreshedAt: z.string()
})
export const destinationSchema = z.object({
    kind: z.enum(['page', 'database']),
    id: z.string(),
    titleProperty: z.string(),
    dateProperty: z.string()
})
export const stateSchema = z.object({
    version: z.literal(1),
    restoreId: z.string().optional(),
    repositories: z.array(repositorySchema),
    activities: z.array(activitySchema),
    drafts: z.array(draftSchema),
    entries: z.array(entrySchema),
    coverage: z.array(z.object({ activityId: z.string(), revision: z.string().optional(), entryId: z.string() })),
    revisions: z.array(
        z.object({
            id: z.string(),
            prId: z.string(),
            base: z.string(),
            head: z.string(),
            fingerprint: z.string().optional(),
            diff: z.string()
        })
    ),
    diffs: z.record(z.string(), z.string()),
    saves: z.array(
        z.object({
            id: z.string(),
            draftId: z.string(),
            status: z.enum(['pending', 'unknown', 'failed', 'confirmed']),
            marker: z.string(),
            title: z.string(),
            body: documentSchema,
            selections: z.array(selectionSchema),
            destination: destinationSchema,
            createdAt: z.string(),
            week: z.string().optional(),
            entryId: z.string().optional(),
            replacedBlockIds: z.array(z.string()).optional(),
            updateExisting: z.boolean().optional(),
            error: z.string().optional()
        })
    ),
    settings: z.object({
        weekStart: z.number().int().min(0).max(6),
        timezone: z.string(),
        refreshMinutes: z.number().min(0).max(1440),
        template: documentSchema,
        githubClientId: z.string(),
        githubLogin: z.string(),
        destination: destinationSchema.optional(),
        layout: z.object({
            order: z.array(z.enum(['activity', 'details', 'draft'])),
            hidden: z.array(z.string()),
            sizes: z.record(z.string(), z.number())
        })
    }),
    lastRefreshed: z.string().optional(),
    lastRefreshAttempt: z.string().optional(),
    refreshError: z.string().optional(),
    snapshotVersion: z.number().optional(),
    transportPauses: z.record(z.string(), z.number()).optional(),
    acquisition: z
        .record(
            z.string(),
            z.object({
                status: z.enum(['idle', 'running', 'paused', 'error', 'cancelled']),
                lastSuccess: z.string().optional(),
                error: z.string().optional(),
                retryAt: z.string().optional(),
                since: z.string().optional(),
                windowEnd: z.string().optional(),
                page: z.number().optional(),
                versions: z.record(z.string(), z.string()).optional(),
                refs: z.record(z.string(), z.string()).optional(),
                configuration: z.string().optional(),
                offset: z.number().optional(),
                excludedTips: z.array(z.string()).optional()
            })
        )
        .optional(),
    repositoryImport: z
        .object({
            id: z.string().optional(),
            skipped: z.number().optional(),
            skippedItems: z.array(z.object({ path: z.string(), reason: z.string() })).optional(),
            status: z.enum(['running', 'done', 'error', 'cancelled']),
            completed: z.number(),
            total: z.number(),
            message: z.string().optional()
        })
        .optional()
})
export type State = z.infer<typeof stateSchema>
export type Repository = z.infer<typeof repositorySchema>
export type Activity = z.infer<typeof activitySchema>
export type Draft = z.infer<typeof draftSchema>
export type Selection = z.infer<typeof selectionSchema>
export type Entry = z.infer<typeof entrySchema>
export type Destination = z.infer<typeof destinationSchema>
export const defaultLayout: State['settings']['layout'] = {
    order: ['activity', 'draft', 'details'],
    hidden: [],
    sizes: { activity: 24, draft: 46, details: 30 }
}
export function initialState(): State {
    return {
        version: 1,
        repositories: [],
        activities: [],
        drafts: [],
        entries: [],
        coverage: [],
        revisions: [],
        diffs: {},
        saves: [],
        settings: {
            weekStart: 1,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            refreshMinutes: 10,
            template: emptyDocument,
            githubClientId: '',
            githubLogin: '',
            layout: structuredClone(defaultLayout)
        }
    }
}
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
export function localDate(date: Date, timezone: string): string {
    let formatter = dateFormatters.get(timezone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        })
        if (dateFormatters.size >= 16) dateFormatters.delete(dateFormatters.keys().next().value!)
        dateFormatters.set(timezone, formatter)
    }
    const parts = formatter.formatToParts(date)
    const get = (type: string) => parts.find((part) => part.type === type)!.value
    return `${get('year')}-${get('month')}-${get('day')}`
}
export function weekOf(date: Date, settings: Pick<State['settings'], 'timezone' | 'weekStart'>): string {
    const day = new Date(`${localDate(date, settings.timezone)}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - settings.weekStart + 7) % 7))
    return day.toISOString().slice(0, 10)
}
export function shiftWeek(week: string, direction: number): string {
    const day = new Date(`${week}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() + direction * 7)
    return day.toISOString().slice(0, 10)
}
export function coveredEntries(state: State, activity: Activity): Entry[] {
    const ids = state.coverage
        .filter(
            (link) =>
                link.activityId === activity.id &&
                (activity.kind !== 'pr' || (activity.revision !== undefined && link.revision === activity.revision))
        )
        .map((link) => link.entryId)
    return state.entries.filter((entry) => ids.includes(entry.id))
}
export function inbox(state: State, week: string): Activity[] {
    const end = shiftWeek(week, 1)
    return state.activities.filter((activity) => {
        const repository = state.repositories.find((item) => item.id === activity.repositoryId)
        if (!repository || activity.disposition === 'dismissed' || coveredEntries(state, activity).length) return false
        if (
            activity.kind === 'commit' &&
            state.activities.some(
                (item) => item.integrationSha === activity.sha && item.repositoryId === activity.repositoryId
            )
        )
            return false
        if (activity.disposition === 'deferred') return !!activity.deferUntil && activity.deferUntil <= week
        const date = localDate(new Date(activity.date), state.settings.timezone)
        if (
            activity.kind === 'commit' &&
            !activity.explicit &&
            !repository.emails.some((email) => email.toLowerCase() === activity.author.toLowerCase())
        )
            return false
        return date < end && (activity.explicit || date >= repository.trackingStart)
    })
}
export const commandSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('state') }),
    z.object({ type: z.literal('addRepository') }),
    z.object({ type: z.literal('addRepositories') }),
    z.object({ type: z.literal('importRepositories'), scanId: z.string(), paths: z.array(z.string()).min(1) }),
    z.object({ type: z.literal('repository'), repository: repositorySchema }),
    z.object({ type: z.literal('relocate'), id: z.string() }),
    z.object({
        type: z.literal('refresh'),
        since: z.iso.date().optional(),
        repositoryId: z.string().optional(),
        source: z.enum(['git', 'github', 'notion']).optional()
    }),
    z.object({ type: z.literal('backfill'), repositoryId: z.string(), since: z.iso.date() }),
    z.object({
        type: z.literal('stopWork'),
        source: z.enum(['git', 'github', 'repositories']),
        repositoryId: z.string().optional()
    }),
    z.object({
        type: z.literal('history'),
        repositoryId: z.string(),
        branch: z.string(),
        view: z.enum(['introduced', 'history']),
        author: z.union([z.string(), z.array(z.string())]),
        since: z.string()
    }),
    z.object({ type: z.literal('details'), activityId: z.string(), content: z.enum(['files', 'diff']).optional() }),
    z.object({ type: z.literal('newDraft'), week: z.string() }),
    z.object({ type: z.literal('draft'), draft: draftSchema }),
    z.object({ type: z.literal('select'), draftId: z.string(), activityId: z.string(), included: z.boolean() }),
    z.object({
        type: z.literal('disposition'),
        activityId: z.string(),
        disposition: z.enum(['inbox', 'deferred', 'dismissed']),
        until: z.string().optional(),
        reason: z.string().optional()
    }),
    z.object({ type: z.literal('settings'), settings: stateSchema.shape.settings }),
    z.object({ type: z.literal('publish'), draftId: z.string() }),
    z.object({ type: z.literal('reconcile'), saveId: z.string() }),
    z.object({ type: z.literal('coverage'), activityId: z.string(), entryId: z.string(), linked: z.boolean() }),
    z.object({ type: z.literal('notionConnect'), token: z.string() }),
    z.object({ type: z.literal('notionProfile') }),
    z.object({ type: z.literal('notionTestDestination'), destination: destinationSchema }),
    z.object({ type: z.literal('githubStart') }),
    z.object({ type: z.literal('githubPoll') }),
    z.object({ type: z.literal('disconnect'), service: z.enum(['github', 'notion']) }),
    z.object({ type: z.literal('export') }),
    z.object({ type: z.literal('import') }),
    z.object({ type: z.literal('open'), url: z.url() }),
    z.object({ type: z.literal('popout'), kind: z.enum(['entry', 'activity']), id: z.string() })
])
export type Command = z.infer<typeof commandSchema>
export interface NotionIdentity {
    name: string
    avatarUrl?: string
}
export interface Reply {
    repositoryScan?: {
        id: string
        folder: string
        repositories: { path: string; name: string; relativePath: string; status: 'new' | 'tracked' | 'stopped' }[]
        unreadable: string[]
    }
    notionIdentity?: NotionIdentity
    state: State
    diff?: string
    activityIds?: string[]
    device?: { code: string; url: string; interval: number }
    devicePending?: { interval: number }
    connections: { github: boolean; notion: boolean; protectedStorage: boolean }
    message?: string
    detailError?: string
}
export interface DesktopBridge {
    invoke: (command: Command) => Promise<Reply>
    updates?: (command: Command, base?: StateCursor) => Promise<UpdateReply>
    onRepositoryImportProgress?: (listener: (progress: RepositoryImportProgress) => void) => () => void
}
export type RepositoryImportProgress =
    | { stage: 'selecting' }
    | { stage: 'discovering'; scanned: number; found: number }
    | { stage: 'processing'; completed: number; total: number }
