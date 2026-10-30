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
import { Context, Effect, Layer } from 'effect'
import { HttpError } from './http'
import { Notion } from './notion'
import { ConnectionState, JournalError, JournalStore } from './journal-context'
import { DurabilityError } from './durability-error'
import type { State } from '../shared/model'
type PublishingAttempt = State['saves'][number] & { generation: string }
const convert = (...args: Parameters<typeof toNotion>) =>
    Effect.try({
        try: () => toNotion(...args),
        catch: (error) =>
            new NotionFailure(error instanceof Error ? error.message : 'The writing could not be converted.', {
                cause: error
            })
    })
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
        const local = <A>(operation: () => Promise<A>) =>
            Effect.tryPromise({ try: operation, catch: (error) => new DurabilityError(error) })
        // Unacknowledged remote progress must be checkpointed again before another remote mutation.
        const volatileAttempts = new Map<string, PublishingAttempt>()
        const checkpoint = (save: PublishingAttempt) =>
            local(() => store.checkpointPublication(save, save.generation)).pipe(
                Effect.tapError(() =>
                    Effect.sync(() => {
                        volatileAttempts.set(save.id, save)
                    })
                ),
                Effect.uninterruptible
            )
        const remotePublish = (save: PublishingAttempt, progress: PageWriteProgress): Effect.Effect<Entry, Error> =>
            Effect.gen(function* () {
                if (!save.title.trim() || save.title.length > 2000)
                    return yield* Effect.fail(new HttpError(400, 'Use a title between 1 and 2000 characters'))
                if (save.entryId) return yield* remoteUpdate(save, progress)
                const children = yield* convert(save.body, yield* uploadImages(save))
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
                yield* checkpoint(save)
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
            save: PublishingAttempt,
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
                        (title === save.title &&
                            elapsed >= -1000 &&
                            elapsed <= 120000 &&
                            JSON.stringify(yield* convert(body)) === JSON.stringify(yield* convert(save.body)))
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
                    const actual = yield* convert(body)
                    const expected = yield* convert(save.body)
                    if (JSON.stringify(actual) === JSON.stringify(expected))
                        return { ...(yield* readEntry(page)), body: save.body }
                    if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, actual.length)))
                        return yield* Effect.fail(
                            new NotionFailure(
                                'The possible saved page differs from the draft. Coverage remains pending; inspect it in Notion.'
                            )
                        )
                    // Adopt the identified page durably before resuming remote writes.
                    save.entryId = page.id
                    yield* checkpoint(save)
                    const sending = yield* convert(save.body, yield* uploadImages(save))
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
        const remoteUpdate = (save: PublishingAttempt, progress: PageWriteProgress): Effect.Effect<Entry, Error> =>
            Effect.gen(function* () {
                const expected = yield* convert(save.body)
                yield* chunkBlocks(expected)
                const sending = yield* convert(save.body, yield* uploadImages(save))
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
                yield* checkpoint(save)
                const oldIds = new Set(save.replacedBlockIds)
                const remaining = blocks.filter((block) => !oldIds.has(block.id!))
                const actual = remaining.length ? yield* convert(fromNotion(remaining)) : []
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
        const uploadImages = (save: PublishingAttempt): Effect.Effect<Record<string, string>, Error> =>
            Effect.gen(function* () {
                const uploads: Record<string, string> = {}
                for (const id of imageIds(save.body)) {
                    const image = yield* local(() => images.image(id))
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
                    yield* checkpoint(save)
                    uploads[id] = created.id
                }
                return uploads
            })
        const confirmDurably = (save: PublishingAttempt, entry: Entry): Effect.Effect<void, Error> =>
            local(() => store.confirmPublication(save.id, entry, save.generation)).pipe(
                Effect.tap(() =>
                    Effect.sync(() => {
                        volatileAttempts.delete(save.id)
                    })
                ),
                Effect.uninterruptible
            )
        const publish = (draftId: string): Effect.Effect<void, Error> =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    if (!connections().notion)
                        return yield* Effect.fail(new JournalError('Connect Notion and choose a destination first'))
                    const generation = store.generation
                    const created = yield* local(() => store.beginPublication(draftId, generation))
                    const save: PublishingAttempt = { ...created, generation }
                    const progress: PageWriteProgress = { dispatched: false }
                    // No external write is allowed until the recovery intent is durable.
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
                                        yield* local(() =>
                                            store.recordPublicationOutcome(
                                                save.id,
                                                save.status as 'unknown' | 'failed',
                                                save.error!,
                                                generation
                                            )
                                        )
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
                                return local(() =>
                                    store.recordPublicationOutcome(
                                        save.id,
                                        save.status as 'unknown' | 'failed',
                                        save.error!,
                                        generation
                                    )
                                ).pipe(Effect.orDie)
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
                        const generation = store.generation
                        const found = yield* local(() => store.publication(saveId))
                        if (!found || found.status !== 'unknown')
                            return yield* Effect.fail(new JournalError('No uncertain save to verify'))
                        const volatile = volatileAttempts.get(saveId)
                        const save: PublishingAttempt =
                            volatile?.generation === generation
                                ? { ...volatile, status: found.status }
                                : { ...found, generation }
                        const entry = yield* remoteReconcile(save, { dispatched: false })
                        if (entry) yield* confirmDurably(save, entry)
                        else {
                            save.error =
                                'The saved page has not been found yet. Retry verification after Notion is reachable; creation remains blocked.'
                            yield* checkpoint(save)
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
