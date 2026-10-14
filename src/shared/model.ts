import { z } from 'zod'

import { required } from './required'

export const documentSchema: z.ZodType<JournalNode> = z.lazy(() =>
    z.object({
        attrs: z.record(z.string(), z.unknown()).optional(),
        content: z.array(documentSchema).optional(),
        marks: z.array(z.object({ attrs: z.record(z.string(), z.unknown()).optional(), type: z.string() })).optional(),
        text: z.string().optional(),
        type: z.string()
    })
)
export interface JournalNode {
    type: string
    text?: string
    attrs?: Record<string, unknown>
    marks?: { type: string; attrs?: Record<string, unknown> }[]
    content?: JournalNode[]
}
export const emptyDocument: JournalNode = { content: [{ type: 'paragraph' }], type: 'doc' }
export const repositorySchema = z.object({
    available: z.boolean(),
    base: z.string(),
    branchBases: z.record(z.string(), z.string()),
    branches: z.array(z.string()).default([]),
    emails: z.array(z.string()),
    id: z.string(),
    name: z.string(),
    path: z.string(),
    remote: z.string(),
    remotes: z.array(z.string()).optional(),
    removed: z.boolean(),
    trackingStart: z.string()
})
export const activitySchema = z.object({
    author: z.string(),
    base: z.string().optional(),
    branches: z.array(z.string()),
    date: z.string(),
    deferUntil: z.string().optional(),
    deletedBranches: z.array(z.string()),
    description: z.string(),
    diffRevision: z.string().optional(),
    disposition: z.enum(['inbox', 'deferred', 'dismissed']),
    explicit: z.boolean(),
    files: z.array(z.object({ name: z.string(), previousName: z.string().optional(), status: z.string() })),
    filesLoaded: z.boolean().optional(),
    fingerprint: z.string().optional(),
    head: z.string().optional(),
    id: z.string(),
    integrationSha: z.string().optional(),
    kind: z.enum(['commit', 'pr', 'review', 'opened', 'merged']),
    prId: z.string().optional(),
    pullRequest: z
        .object({
            closedAt: z.string().optional(),
            commitDates: z.array(z.string()),
            mergedAt: z.string().optional(),
            openedAt: z.string(),
            status: z.enum(['open', 'draft', 'closed', 'merged']).optional()
        })
        .optional(),
    reason: z.string().optional(),
    repositoryId: z.string(),
    revision: z.string().optional(),
    sha: z.string().optional(),
    sourceVersion: z.string().optional(),
    title: z.string(),
    url: z.string().optional()
})
export const selectionSchema = z.object({ activityId: z.string(), revision: z.string().optional() })
export const draftSchema = z.object({
    body: documentSchema,
    id: z.string(),
    publishedEntryId: z.string().optional(),
    selections: z.array(selectionSchema),
    title: z.string(),
    updatedAt: z.string(),
    week: z.string()
})
export const entrySchema = z.object({
    body: documentSchema,
    date: z.string(),
    id: z.string(),
    refreshedAt: z.string(),
    title: z.string(),
    url: z.string()
})
export const destinationSchema = z.object({
    dateProperty: z.string(),
    id: z.string(),
    kind: z.enum(['page', 'database']),
    titleProperty: z.string()
})
export const stateSchema = z.object({
    acquisition: z
        .record(
            z.string(),
            z.object({
                configuration: z.string().optional(),
                error: z.string().optional(),
                excludedTips: z.array(z.string()).optional(),
                lastSuccess: z.string().optional(),
                offset: z.number().optional(),
                page: z.number().optional(),
                refs: z.record(z.string(), z.string()).optional(),
                retryAt: z.string().optional(),
                since: z.string().optional(),
                status: z.enum(['idle', 'running', 'paused', 'error', 'cancelled']),
                versions: z.record(z.string(), z.string()).optional(),
                windowEnd: z.string().optional()
            })
        )
        .optional(),
    activities: z.array(activitySchema),
    coverage: z.array(z.object({ activityId: z.string(), entryId: z.string(), revision: z.string().optional() })),
    diffs: z.record(z.string(), z.string()),
    drafts: z.array(draftSchema),
    entries: z.array(entrySchema),
    features: z.array(
        z.object({ archived: z.boolean(), id: z.string(), members: z.array(z.string()), name: z.string() })
    ),
    lastRefreshAttempt: z.string().optional(),
    lastRefreshed: z.string().optional(),
    refreshError: z.string().optional(),
    repositories: z.array(repositorySchema),
    repositoryImport: z
        .object({
            completed: z.number(),
            id: z.string().optional(),
            message: z.string().optional(),
            skipped: z.number().optional(),
            skippedItems: z.array(z.object({ path: z.string(), reason: z.string() })).optional(),
            status: z.enum(['running', 'done', 'error', 'cancelled']),
            total: z.number()
        })
        .optional(),
    restoreId: z.string().optional(),
    revisions: z.array(
        z.object({
            base: z.string(),
            diff: z.string(),
            fingerprint: z.string().optional(),
            head: z.string(),
            id: z.string(),
            prId: z.string()
        })
    ),
    saves: z.array(
        z.object({
            body: documentSchema,
            createdAt: z.string(),
            destination: destinationSchema,
            draftId: z.string(),
            entryId: z.string().optional(),
            error: z.string().optional(),
            id: z.string(),
            marker: z.string(),
            selections: z.array(selectionSchema),
            status: z.enum(['pending', 'unknown', 'failed', 'confirmed']),
            title: z.string(),
            week: z.string().optional()
        })
    ),
    settings: z.object({
        destination: destinationSchema.optional(),
        githubClientId: z.string(),
        githubLogin: z.string(),
        layout: z.object({
            hidden: z.array(z.string()),
            order: z.array(z.enum(['activity', 'details', 'draft'])),
            sizes: z.record(z.string(), z.number())
        }),
        refreshMinutes: z.number().min(0).max(1440),
        template: documentSchema,
        timezone: z.string(),
        weekStart: z.number().int().min(0).max(6)
    }),
    snapshotVersion: z.number().optional(),
    transportPauses: z.record(z.string(), z.number()).optional(),
    version: z.literal(1)
})
export type State = z.infer<typeof stateSchema>
export type Repository = z.infer<typeof repositorySchema>
export type Activity = z.infer<typeof activitySchema>
export type Draft = z.infer<typeof draftSchema>
export type Selection = z.infer<typeof selectionSchema>
export type Entry = z.infer<typeof entrySchema>
export type Destination = z.infer<typeof destinationSchema>
export const defaultLayout: State['settings']['layout'] = {
    hidden: [],
    order: ['activity', 'draft', 'details'],
    sizes: { activity: 24, details: 30, draft: 46 }
}
export const initialState = (): State => ({
    activities: [],
    coverage: [],
    diffs: {},
    drafts: [],
    entries: [],
    features: [],
    repositories: [],
    revisions: [],
    saves: [],
    settings: {
        githubClientId: '',
        githubLogin: '',
        layout: structuredClone(defaultLayout),
        refreshMinutes: 10,
        template: emptyDocument,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekStart: 1
    },
    version: 1
})
const dateFormatters = new Map<string, Intl.DateTimeFormat>()
export const localDate = (date: Date, timezone: string): string => {
    let formatter = dateFormatters.get(timezone)
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            day: '2-digit',
            month: '2-digit',
            timeZone: timezone,
            year: 'numeric'
        })
        if (dateFormatters.size >= 16) {
            dateFormatters.delete(required(dateFormatters.keys().next().value))
        }
        dateFormatters.set(timezone, formatter)
    }
    const parts = formatter.formatToParts(date)
    const get = (type: string) => required(parts.find((part) => part.type === type)).value
    return `${get('year')}-${get('month')}-${get('day')}`
}
export const weekOf = (date: Date, settings: Pick<State['settings'], 'timezone' | 'weekStart'>): string => {
    const day = new Date(`${localDate(date, settings.timezone)}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - settings.weekStart + 7) % 7))
    return day.toISOString().slice(0, 10)
}
export const shiftWeek = (week: string, direction: number): string => {
    const day = new Date(`${week}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() + direction * 7)
    return day.toISOString().slice(0, 10)
}
export const coveredEntries = (state: State, activity: Activity): Entry[] => {
    const ids = new Set(
        state.coverage
            .filter(
                (link) =>
                    link.activityId === activity.id &&
                    (activity.kind !== 'pr' || (activity.revision !== undefined && link.revision === activity.revision))
            )
            .map((link) => link.entryId)
    )
    return state.entries.filter((entry) => ids.has(entry.id))
}
export const featureActivities = (state: State, featureId: string): Activity[] => {
    const feature = state.features.find((item) => item.id === featureId)
    return state.activities.filter((activity) =>
        feature?.members.some(
            (member) =>
                member === activity.id ||
                member === activity.prId ||
                activity.branches.some((branch) => member === `branch:${activity.repositoryId}:${branch}`)
        )
    )
}
export const inbox = (state: State, week: string): Activity[] => {
    const end = shiftWeek(week, 1)
    return state.activities.filter((activity) => {
        const repository = state.repositories.find((item) => item.id === activity.repositoryId)
        if (!repository || activity.disposition === 'dismissed' || coveredEntries(state, activity).length) {
            return false
        }
        if (
            activity.kind === 'commit' &&
            state.activities.some(
                (item) => item.integrationSha === activity.sha && item.repositoryId === activity.repositoryId
            )
        ) {
            return false
        }
        if (activity.disposition === 'deferred') {
            return !!activity.deferUntil && activity.deferUntil <= week
        }
        const date = localDate(new Date(activity.date), state.settings.timezone)
        if (
            activity.kind === 'commit' &&
            !activity.explicit &&
            !repository.emails.some((email) => email.toLowerCase() === activity.author.toLowerCase())
        ) {
            return false
        }
        return date < end && (activity.explicit || date >= repository.trackingStart)
    })
}
export const commandSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('state') }),
    z.object({ type: z.literal('addRepository') }),
    z.object({ type: z.literal('addRepositories') }),
    z.object({ repository: repositorySchema, type: z.literal('repository') }),
    z.object({ id: z.string(), type: z.literal('relocate') }),
    z.object({
        repositoryId: z.string().optional(),
        source: z.enum(['git', 'github', 'notion']).optional(),
        type: z.literal('refresh')
    }),
    z.object({ repositoryId: z.string(), since: z.iso.date(), type: z.literal('backfill') }),
    z.object({
        repositoryId: z.string().optional(),
        source: z.enum(['git', 'github', 'repositories']),
        type: z.literal('stopWork')
    }),
    z.object({
        author: z.union([z.string(), z.array(z.string())]),
        branch: z.string(),
        repositoryId: z.string(),
        since: z.string(),
        type: z.literal('history'),
        view: z.enum(['introduced', 'history'])
    }),
    z.object({ activityId: z.string(), content: z.enum(['files', 'diff']).optional(), type: z.literal('details') }),
    z.object({ type: z.literal('newDraft'), week: z.string() }),
    z.object({ draft: draftSchema, type: z.literal('draft') }),
    z.object({ activityId: z.string(), draftId: z.string(), included: z.boolean(), type: z.literal('select') }),
    z.object({
        activityId: z.string(),
        disposition: z.enum(['inbox', 'deferred', 'dismissed']),
        reason: z.string().optional(),
        type: z.literal('disposition'),
        until: z.string().optional()
    }),
    z.object({
        archived: z.boolean(),
        id: z.string(),
        members: z.array(z.string()),
        name: z.string(),
        type: z.literal('feature')
    }),
    z.object({ settings: stateSchema.shape.settings, type: z.literal('settings') }),
    z.object({ draftId: z.string(), type: z.literal('publish') }),
    z.object({ saveId: z.string(), type: z.literal('reconcile') }),
    z.object({ activityId: z.string(), entryId: z.string(), linked: z.boolean(), type: z.literal('coverage') }),
    z.object({ token: z.string(), type: z.literal('notionConnect') }),
    z.object({ type: z.literal('githubStart') }),
    z.object({ type: z.literal('githubPoll') }),
    z.object({ service: z.enum(['github', 'notion']), type: z.literal('disconnect') }),
    z.object({ type: z.literal('export') }),
    z.object({ type: z.literal('import') }),
    z.object({ type: z.literal('open'), url: z.url() }),
    z.object({ id: z.string(), kind: z.enum(['entry', 'activity']), type: z.literal('popout') })
])
export type Command = z.infer<typeof commandSchema>
export interface Reply {
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
    onRepositoryImportProgress?: (listener: (progress: RepositoryImportProgress) => void) => () => void
}
export type RepositoryImportProgress =
    | { stage: 'selecting' }
    | { stage: 'discovering'; scanned: number; found: number }
    | { stage: 'processing'; completed: number; total: number }
