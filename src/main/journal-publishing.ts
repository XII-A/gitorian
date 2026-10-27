import { toJournalFailure } from './journal-errors'
import type { JournalFailure } from './journal-errors'
import { fromNotion, toNotion } from '../shared/notion-format'
import type { NotionBlock } from '../shared/notion-format'
import type { Entry } from '../shared/model'
import type { Page } from './notion'
import { NotionFailure } from './notion'
import { NotionRequests } from './notion-request'
import { imageIds, imageExtension } from '../shared/images'
import { makeSharedRequests } from './shared-requests'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { HttpError } from './http'
import { Notion } from './notion'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
import { DurabilityError } from './durability-error'
import type { State } from '../shared/model'
interface PageWriteProgress {
    dispatched: boolean
}
export interface JournalPublishing {
    readonly publish: (draftId: string) => Effect.Effect<void, JournalFailure>
    readonly reconcile: (saveId: string) => Effect.Effect<void, JournalFailure>
}
export const JournalPublishing = Context.GenericTag<JournalPublishing>('gitorian/JournalPublishing')
/** Owns durable intent, remote progress, uncertain outcomes and recoverable confirmation. */
export const JournalPublishingLive = Layer.scoped(
    JournalPublishing,
    Effect.gen(function* () {
        const store = yield* JournalStore
        const notion = yield* Notion
        const { request } = yield* NotionRequests
        const images = store
        const loadPages = notion.pages
        const loadBlocks = notion.blocks
        const readEntry = notion.entry
        const connectionState = yield* ConnectionState
        const connections = connectionState.snapshot
        const sharedReconciliation = yield* makeSharedRequests<string, undefined, Error>(
            () => new JournalError('Publishing is closed')
        )
        const confirming = new Set<string>()
        const checkpoint = Effect.try({
            try: () => {
                store.persist()
            },
            catch: (error) => new DurabilityError(error)
        })
            .pipe(
                Effect.zipRight(
                    Effect.tryPromise({ try: () => store.flush(), catch: (error) => new DurabilityError(error) })
                )
            )
            .pipe(Effect.uninterruptible)
        const remotePublish = (
            save: State['saves'][number],
            progress: PageWriteProgress
        ): Effect.Effect<Entry, Error> =>
            Effect.gen(function* () {
                if (!save.title.trim() || save.title.length > 2000)
                    return yield* Effect.fail(new HttpError(400, 'Use a title between 1 and 2000 characters'))
                if (save.entryId) return yield* remoteUpdate(save, progress)
                const children = toNotion(save.body, yield* uploadImages(save))
                const batches = yield* chunkBlocks(children)
                const destination = save.destination
                const properties: Record<string, unknown> = {
                    [destination.kind === 'page' ? 'title' : destination.titleProperty]: {
                        title: [{ text: { content: save.title } }]
                    }
                }
                if (destination.kind === 'database' && destination.dateProperty)
                    properties[destination.dateProperty] = { date: { start: save.week ?? save.createdAt.slice(0, 10) } }
                progress.dispatched = true
                const page = yield* request<Page>('pages', {
                    method: 'POST',
                    body: JSON.stringify({
                        parent:
                            destination.kind === 'page'
                                ? { page_id: destination.id }
                                : { data_source_id: destination.id },
                        properties,
                        children: batches[0] ?? []
                    })
                })
                save.entryId = page.id
                yield* checkpoint
                for (const children of batches.slice(1))
                    yield* request(`blocks/${page.id}/children`, {
                        method: 'PATCH',
                        body: JSON.stringify({ children })
                    })
                return {
                    id: page.id,
                    url: page.url,
                    title: save.title,
                    date: save.createdAt,
                    body: save.body,
                    refreshedAt: new Date().toISOString()
                }
            })
        const remoteReconcile = (
            save: State['saves'][number],
            progress: PageWriteProgress
        ): Effect.Effect<Entry | undefined, Error> =>
            Effect.gen(function* () {
                if (save.updateExisting) return yield* remoteUpdate(save, progress)
                const pages = save.entryId
                    ? [yield* request<Page>(`pages/${save.entryId}`)]
                    : yield* loadPages(save.destination)
                const candidates: {
                    page: Page
                    blocks: NotionBlock[]
                }[] = []
                for (const page of pages) {
                    const blocks = yield* loadBlocks(page.id)
                    const legacyMarker = blocks.some(
                        (block) => block.type === 'paragraph' && JSON.stringify(block.paragraph).includes(save.marker)
                    )
                    const title = Object.values(page.properties)
                        .find((property) => property.title)
                        ?.title?.map((text) => text.plain_text ?? text.text?.content ?? '')
                        .join('')
                    const elapsed = Date.parse(page.created_time) - Date.parse(save.createdAt)
                    const body = fromNotion(blocks)
                    // New pages contain only user writing. Without a checkpointed ID, adopt
                    // only one complete matching page created during this publish attempt.
                    if (
                        save.entryId ||
                        legacyMarker ||
                        (title === save.title &&
                            elapsed >= -1000 &&
                            elapsed <= 120000 &&
                            JSON.stringify(toNotion(body)) === JSON.stringify(toNotion(save.body)))
                    )
                        candidates.push({ page, blocks })
                }
                if (candidates.length > 1)
                    return yield* Effect.fail(
                        new NotionFailure(
                            'More than one matching Notion page was found. Inspect them in Notion before retrying verification.'
                        )
                    )
                for (const { page, blocks } of candidates) {
                    const body = fromNotion(blocks)
                    const actual = toNotion(body)
                    const expected = toNotion(save.body)
                    if (JSON.stringify(actual) === JSON.stringify(expected))
                        return { ...(yield* readEntry(page)), body }
                    if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
                        return yield* Effect.fail(
                            new NotionFailure(
                                'The possible saved page differs from the draft. Coverage remains pending; inspect it in Notion.'
                            )
                        )
                    // Adopt the identified page durably before resuming remote writes.
                    save.entryId = page.id
                    yield* checkpoint
                    const sending = toNotion(save.body, yield* uploadImages(save))
                    progress.dispatched = true
                    for (const children of yield* chunkBlocks(sending.slice(actual.length)))
                        yield* request(`blocks/${page.id}/children`, {
                            method: 'PATCH',
                            body: JSON.stringify({ children })
                        })
                    return { ...(yield* readEntry(page)), body: save.body }
                }
                return undefined
            })
        const remoteUpdate = (save: State['saves'][number], progress: PageWriteProgress): Effect.Effect<Entry, Error> =>
            Effect.gen(function* () {
                const expected = toNotion(save.body)
                yield* chunkBlocks(expected)
                const sending = toNotion(save.body, yield* uploadImages(save))
                const blocks = yield* loadBlocks(save.entryId!)
                if (!save.replacedBlockIds) {
                    if (blocks.some((block) => !block.id))
                        return yield* Effect.fail(
                            new NotionFailure('Notion did not return block IDs. Retry verification.')
                        )
                    save.replacedBlockIds = blocks.map((block) => block.id!)
                    // Persist the replacement boundary before mutating remote content, so a
                    // lost response or restart cannot cause newly appended writing to be deleted.
                }
                yield* checkpoint
                const oldIds = new Set(save.replacedBlockIds)
                const remaining = blocks.filter((block) => !oldIds.has(block.id!))
                const actual = remaining.length ? toNotion(fromNotion(remaining)) : []
                if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
                    return yield* Effect.fail(
                        new NotionFailure(
                            'The Notion page changed during publishing. Inspect it in Notion before verifying again.'
                        )
                    )
                const properties = {
                    [save.destination.kind === 'page' ? 'title' : save.destination.titleProperty]: {
                        title: [{ text: { content: save.title } }]
                    }
                }
                progress.dispatched = true
                const page = yield* request<Page>(`pages/${save.entryId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ properties })
                })
                for (const block of blocks.filter((block) => oldIds.has(block.id!)))
                    yield* request(`blocks/${block.id}`, { method: 'DELETE' })
                for (const children of yield* chunkBlocks(sending.slice(actual.length)))
                    yield* request(`blocks/${save.entryId}/children`, {
                        method: 'PATCH',
                        body: JSON.stringify({ children })
                    })
                return {
                    id: page.id,
                    url: page.url,
                    title: save.title,
                    date: page.created_time,
                    body: save.body,
                    refreshedAt: new Date().toISOString()
                }
            })
        const splitBlocks = (blocks: NotionBlock[]): NotionBlock[][] => {
            const batches: NotionBlock[][] = []
            let batch: NotionBlock[] = []
            let bytes = 0
            for (const block of blocks) {
                const size = Buffer.byteLength(JSON.stringify(block))
                if (size > 450000)
                    throw new HttpError(
                        400,
                        'A journal block exceeds the Notion payload limit; split this block before publishing'
                    )
                if (batch.length >= 100 || bytes + size > 450000) {
                    batches.push(batch)
                    batch = []
                    bytes = 0
                }
                batch.push(block)
                bytes += size
            }
            if (batch.length) batches.push(batch)
            return batches
        }
        const chunkBlocks = (blocks: NotionBlock[]) =>
            Effect.try({
                try: () => splitBlocks(blocks),
                catch: (error) => (error instanceof Error ? error : new NotionFailure(String(error)))
            })
        const uploadImages = (save: State['saves'][number]): Effect.Effect<Record<string, string>, Error> =>
            Effect.gen(function* () {
                const uploads: Record<string, string> = {}
                for (const id of imageIds(save.body)) {
                    const image = images?.image(id)
                    if (!image)
                        return yield* Effect.fail(
                            new HttpError(
                                400,
                                'A journal image is missing. Restore it from a backup before publishing.'
                            )
                        )
                    const existing = save.imageUploads?.[id]
                    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 60000)) {
                        const prior = yield* Effect.either(
                            request<{
                                status: string
                                expiry_time: string | null
                            }>('file_uploads/' + existing.id)
                        )
                        if (prior._tag === 'Right' && prior.right.status === 'uploaded') {
                            uploads[id] = existing.id
                            continue
                        }
                        if (prior._tag === 'Left' && !(prior.left instanceof HttpError && prior.left.status === 404))
                            return yield* Effect.fail(prior.left)
                    }
                    const created = yield* request<{
                        id: string
                    }>('file_uploads', {
                        method: 'POST',
                        body: JSON.stringify({
                            mode: 'single_part',
                            filename: id + '.' + imageExtension(image.mime),
                            content_type: image.mime
                        })
                    })
                    const form = new FormData()
                    form.append(
                        'file',
                        new Blob([new Uint8Array(image.bytes)], { type: image.mime }),
                        id + '.' + imageExtension(image.mime)
                    )
                    const uploaded = yield* request<{
                        status: string
                        expiry_time: string | null
                    }>('file_uploads/' + created.id + '/send', { method: 'POST', body: form })
                    if (uploaded.status !== 'uploaded')
                        return yield* Effect.fail(
                            new NotionFailure('Notion has not finished uploading an image. Try publishing again.')
                        )
                    save.imageUploads ??= {}
                    save.imageUploads[id] = { id: created.id, expiresAt: uploaded.expiry_time }
                    yield* checkpoint
                    uploads[id] = created.id
                }
                return uploads
            })
        const confirm = (save: State['saves'][number], entry: State['entries'][number]): (() => void) => {
            const state = store.state
            const previousSave = { status: save.status, entryId: save.entryId, error: save.error }
            const previousEntry = state.entries.find((item) => item.id === entry.id)
            const previousCoverage = new Set(state.coverage)
            const draft = state.drafts.find((item) => item.id === save.draftId)
            const previousLink = draft?.publishedEntryId
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
            // The page belongs to this weekly draft even if newer local edits arrived
            // while publishing. The next publish must update that page.
            if (draft) draft.publishedEntryId = entry.id
            const addedCoverage = new Set(state.coverage.filter((link) => !previousCoverage.has(link)))
            return () => {
                Object.assign(save, previousSave)
                const current = state.entries.findIndex((item) => item.id === entry.id)
                if (current >= 0 && state.entries[current] === entry) {
                    if (previousEntry) state.entries[current] = previousEntry
                    else state.entries.splice(current, 1)
                }
                state.coverage = state.coverage.filter((link) => !addedCoverage.has(link))
                if (draft?.publishedEntryId === entry.id) draft.publishedEntryId = previousLink
            }
        }
        const confirmDurably = (
            save: State['saves'][number],
            entry: State['entries'][number]
        ): Effect.Effect<void, Error> => {
            return Effect.acquireUseRelease(
                Effect.sync(() => {
                    confirming.add(save.id)
                    return confirm(save, entry)
                }),
                (rollback) => checkpoint.pipe(Effect.onError(() => Effect.sync(rollback))),
                () =>
                    Effect.sync(() => {
                        confirming.delete(save.id)
                    })
            ).pipe(Effect.uninterruptible)
        }
        const publish = (draftId: string): Effect.Effect<void, Error> =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    const state = store.state
                    const draft = state.drafts.find((item) => item.id === draftId)
                    if (!draft) return yield* Effect.fail(new JournalError('Draft does not exist'))
                    if (
                        state.saves.some(
                            (save) =>
                                save.draftId === draftId &&
                                (['pending', 'unknown'].includes(save.status) || confirming.has(save.id))
                        )
                    )
                        return yield* Effect.fail(
                            new JournalError('This draft has an uncertain save. Verify it before publishing again.')
                        )
                    const previous = state.saves
                        .filter((save) => save.entryId === draft.publishedEntryId && save.status === 'confirmed')
                        .at(-1)
                    const destination = previous?.destination ?? state.settings.destination
                    if (!destination || !connections().notion)
                        return yield* Effect.fail(new JournalError('Connect Notion and choose a destination first'))
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
                        week: draft.week,
                        entryId: draft.publishedEntryId,
                        updateExisting: !!draft.publishedEntryId
                    }
                    const progress: PageWriteProgress = { dispatched: false }
                    state.saves.push(save)
                    // No external write is allowed until the recovery intent is durable.
                    yield* checkpoint.pipe(
                        Effect.tapError((error) =>
                            Effect.sync(() => {
                                save.status = 'failed'
                                save.error = String(error)
                            })
                        )
                    )
                    yield* restore(
                        remotePublish(save, progress).pipe(
                            Effect.flatMap((entry) => confirmDurably(save, entry)),
                            Effect.matchEffect({
                                onSuccess: () => Effect.void,
                                onFailure: (error) =>
                                    Effect.gen(function* () {
                                        // A server/network failure can follow a committed remote write.
                                        save.status =
                                            !progress.dispatched ||
                                            ((!save.entryId || (save.updateExisting && !save.replacedBlockIds)) &&
                                                error instanceof HttpError &&
                                                error.status >= 400 &&
                                                error.status < 500 &&
                                                error.status !== 408)
                                                ? 'failed'
                                                : 'unknown'
                                        save.error = progress.dispatched
                                            ? String(error)
                                            : `${String(error)} Your page has not been changed. Try publishing again.`
                                        // The caller must not outrun persistence of the recovery outcome.
                                        yield* checkpoint
                                        return yield* Effect.fail(error)
                                    })
                            })
                        )
                    ).pipe(
                        Effect.onInterrupt(() =>
                            Effect.suspend(() => {
                                if (save.status === 'confirmed' || save.status === 'failed') return Effect.void
                                save.status = progress.dispatched ? 'unknown' : 'failed'
                                save.error = progress.dispatched
                                    ? 'Publishing was interrupted. Verify the saved page before trying again.'
                                    : 'Publishing was interrupted before the page changed. Try publishing again.'
                                return checkpoint.pipe(Effect.orDie)
                            })
                        )
                    )
                })
            )
        const reconcile = (saveId: string): Effect.Effect<void, Error> =>
            sharedReconciliation(
                saveId,
                Effect.succeed(
                    Effect.gen(function* () {
                        const save = store.state.saves.find((item) => item.id === saveId)
                        if (!save || save.status !== 'unknown')
                            return yield* Effect.fail(new JournalError('No uncertain save to verify'))
                        const entry = yield* remoteReconcile(save, { dispatched: false })
                        if (entry) yield* confirmDurably(save, entry)
                        else {
                            save.error =
                                'The saved page has not been found yet. Retry verification after Notion is reachable; creation remains blocked.'
                            yield* checkpoint
                        }
                    }).pipe(Effect.as(undefined))
                )
            )
        return {
            publish: Effect.fn('JournalPublishing.publish')(publish, Effect.mapError(toJournalFailure)),
            reconcile: Effect.fn('JournalPublishing.reconcile')(reconcile, Effect.mapError(toJournalFailure))
        }
    })
)
