import { ConnectionError } from './connection-errors'
import type { ConnectionFailure } from './connection-errors'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { Context, Deferred, Effect, ExecutionStrategy, Exit, Fiber, Layer, Schema, Scope } from 'effect'
import { attemptLifetime, credentialSchema } from '../../services/notion-oauth/src/protocol'
import type { Destination } from '../shared/model'
import type { JournalSetupStore } from './notion-setup'
import type { Store } from './store'
import { Http } from './http'
import { makeNotion, toNotionError } from './notion'
import type { Notion } from './notion'
import { JournalStore } from './journal-context'
import { DurabilityError } from './durability-error'
interface CredentialStore {
    get: (key: string) => string
    set: (key: string, value: string) => void
}
export interface JournalSetup {
    id: string
    started: boolean
    pageId?: string
    title?: string
}
const sessionSchema = Schema.Struct({
    ...credentialSchema.fields,
    origin: Schema.NonEmptyString,
    journal: Schema.Struct({
        id: Schema.NonEmptyString,
        started: Schema.Boolean,
        pageId: Schema.optional(Schema.NonEmptyString),
        title: Schema.optional(Schema.NonEmptyString)
    })
})
type Session = Omit<typeof sessionSchema.Type, 'journal'> & {
    journal: JournalSetup
}
function decodeTokens(value: unknown) {
    try {
        return Schema.decodeUnknownSync(credentialSchema)(value)
    } catch {
        throw new Error('Notion returned an incomplete connection. Connect again.')
    }
}
function connectionError(error: unknown): ConnectionError {
    return error instanceof ConnectionError ? error : new ConnectionError(error)
}
interface Attempt {
    server: Server
    nonce: string
    verifier: string
    expires: number
    callback?: {
        state: string
        grant: string
    }
    error?: string
    exchange?: Effect.Effect<void, Error>
    terminal: Deferred.Deferred<undefined>
    scope: Scope.CloseableScope
    expiration?: Fiber.RuntimeFiber<void>
}
export interface ConnectionSelection {
    title?: string
    destination?: Destination
}
export interface NotionConnection {
    readonly start: () => Effect.Effect<
        {
            url: string
            interval: number
        },
        ConnectionFailure
    >
    readonly poll: () => Effect.Effect<
        | {
              pending: true
              interval: number
          }
        | {
              authorized: true
          },
        ConnectionFailure
    >
    readonly pendingToken: (refresh?: boolean, rejected?: string) => Effect.Effect<string, ConnectionFailure>
    readonly token: (refresh?: boolean, rejected?: string) => Effect.Effect<string, ConnectionFailure>
    readonly choose: () => Effect.Effect<boolean, ConnectionFailure>
    readonly refreshDestination: () => Effect.Effect<void, ConnectionFailure>
    readonly completeJournal: (selection?: ConnectionSelection) => Effect.Effect<Destination, ConnectionFailure>
    readonly cancel: () => Effect.Effect<void>
    readonly disconnect: () => Effect.Effect<void, ConnectionFailure>
    readonly connected: () => boolean
    readonly profileKey: () => string
}
export const NotionConnection = Context.GenericTag<NotionConnection>('gitorian/NotionConnection')
export interface ConnectionAdapters {
    vault: CredentialStore
    origin: string
    fetcher: typeof fetch
    recovery: Pick<JournalSetupStore, 'get' | 'set' | 'clear'>
}
type DestinationStore = Pick<Store, 'state' | 'persist' | 'flush'>
type SetupPages = Pick<Notion, 'prepareJournal' | 'destinationIcon' | 'describeDestination'>
type TokenAccess = (refresh?: boolean, rejected?: string) => Effect.Effect<string, Error>
export const NotionConnectionLive = (adapters: ConnectionAdapters) =>
    Layer.scoped(
        NotionConnection,
        Effect.gen(function* () {
            const store = yield* JournalStore
            const http = yield* Http
            return yield* makeNotionConnection(adapters, store, (getToken) => makeNotion(http, getToken, store))
        })
    )
/** The public confirmation operation owns the entire durable credential/destination protocol. */
export function makeNotionConnection(
    adapters: ConnectionAdapters,
    store: DestinationStore,
    setupPages: (getToken: TokenAccess) => SetupPages
) {
    return Effect.gen(function* () {
        const rootScope = yield* Scope.Scope
        const registration = yield* Effect.makeSemaphore(1)
        const { vault, origin: serviceOrigin, fetcher, recovery } = adapters
        let attempt: Attempt | undefined
        let attemptGeneration = 0
        let credentialGeneration = 0
        let refreshing: Effect.Effect<string, Error> | undefined
        let pendingRefreshing: Effect.Effect<string, Error> | undefined
        let completing: Effect.Effect<Destination, Error> | undefined
        let pending: Session | undefined
        let pendingGeneration: number | undefined
        let pendingInstalled = false
        let savedSetup:
            | {
                  workspace: string
                  id: string
              }
            | undefined
        let committing = false
        let stagedKey: string | undefined
        let stateOwner = store.state
        let credentialKey = stateOwner.settings.destination?.credentialSlot
            ? 'notion-' + stateOwner.settings.destination.credentialSlot
            : 'notion'
        let destinationId = stateOwner.settings.destination?.id
        let closed = false
        const synchronizeDestination = () => {
            if (stateOwner === store.state) return
            stateOwner = store.state
            credentialKey = stateOwner.settings.destination?.credentialSlot
                ? 'notion-' + stateOwner.settings.destination.credentialSlot
                : 'notion'
            destinationId = stateOwner.settings.destination?.id
            credentialGeneration++
            attemptGeneration++
            pending = undefined
            pendingGeneration = undefined
            pendingInstalled = false
            pendingRefreshing = undefined
            if (attempt) {
                attempt.error = 'Local data was restored. Connect Notion again.'
                Deferred.unsafeDone(attempt.terminal, Effect.succeed(undefined))
            }
            refreshing = undefined
        }
        const session = (key?: string): Session | undefined => {
            synchronizeDestination()
            const raw = vault.get(key ?? credentialKey)
            if (!raw.startsWith('{')) return undefined
            try {
                const value = Schema.decodeUnknownSync(sessionSchema)(JSON.parse(raw))
                return value.journal.pageId !== destinationId ? undefined : value
            } catch {
                return undefined
            }
        }
        const save = (value: Session, key = credentialKey) => vault.set(key, JSON.stringify(value))
        const journalSetup = (workspace: string): JournalSetup => {
            const value = recovery.get(workspace)
            const completed = savedSetup?.workspace === workspace && savedSetup.id === value?.id
            return value && !completed ? value : { id: randomBytes(16).toString('hex'), started: false }
        }
        const brokerRequest = (path: string, body?: unknown, origin = serviceOrigin): Effect.Effect<unknown, Error> => {
            return Effect.gen(function* () {
                const target = yield* Effect.try({ try: () => new URL(origin), catch: connectionError })
                if (
                    target.origin !== origin ||
                    (target.protocol !== 'https:' &&
                        !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname)))
                )
                    return yield* Effect.fail(
                        new ConnectionError('Notion sign-in is unavailable. Check the connection configuration.')
                    )
                const response = yield* Effect.tryPromise({
                    try: (signal) =>
                        fetcher(`${origin}${path}`, {
                            method: body ? 'POST' : 'GET',
                            redirect: 'error',
                            headers: { 'Content-Type': 'application/json' },
                            ...(body ? { body: JSON.stringify(body) } : {}),
                            signal: AbortSignal.any([signal, AbortSignal.timeout(25000)])
                        }),
                    catch: connectionError
                })
                if (!response.ok) {
                    yield* Effect.sync(() => {
                        void response.body?.cancel().catch(() => {
                            /* Failed cancellation does not replace the provider rejection. */
                        })
                    })
                    return yield* Effect.fail(
                        new ConnectionError(
                            response.status === 503
                                ? 'Configure the local Notion OAuth module before connecting.'
                                : response.status === 401
                                  ? 'Notion authorization expired. Connect again.'
                                  : 'Notion could not connect. Try again.'
                        )
                    )
                }
                return yield* Effect.tryPromise({
                    try: () => response.json() as Promise<unknown>,
                    catch: connectionError
                })
            })
        }
        const releaseAttempt = () =>
            Effect.gen(function* () {
                synchronizeDestination()
                if (!completing) {
                    if (stagedKey) {
                        try {
                            if (stagedKey !== credentialKey) vault.set(stagedKey, '')
                        } catch {
                            /* An inactive slot cannot be selected without a destination pointer. */
                        }
                        stagedKey = undefined
                    }
                    pending = undefined
                    pendingGeneration = undefined
                    pendingRefreshing = undefined
                }
                const current = attempt
                attempt = undefined
                if (current) yield* Scope.close(current.scope, Exit.void)
            })
        const cancel = () =>
            Effect.suspend(() => {
                attemptGeneration++
                return releaseAttempt()
            })
        yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
                const accepted = yield* registration.withPermits(1)(
                    Effect.sync(() => {
                        closed = true
                        const accepted: Effect.Effect<unknown, Error>[] = []
                        if (completing) accepted.push(completing)
                        if (refreshing) accepted.push(refreshing)
                        if (pendingRefreshing) accepted.push(pendingRefreshing)
                        if (attempt?.exchange) accepted.push(attempt.exchange)
                        return accepted
                    })
                )
                yield* Effect.forEach(accepted, (operation) => Effect.exit(operation), {
                    concurrency: 'unbounded',
                    discard: true
                })
                yield* cancel()
            })
        )
        const start = (): Effect.Effect<
            {
                url: string
                interval: number
            },
            Error
        > =>
            Effect.gen(function* () {
                if (closed) return yield* Effect.fail(new ConnectionError('Notion connection is closed.'))
                if (completing)
                    return yield* Effect.fail(new ConnectionError('Notion is finishing setup. Try again in a moment.'))
                const generation = yield* Effect.sync(() => ++attemptGeneration)
                yield* releaseAttempt()
                if (!serviceOrigin)
                    return yield* Effect.fail(
                        new ConnectionError('Notion sign-in is unavailable. Check the connection configuration.')
                    )
                yield* brokerRequest('/health')
                if (generation !== attemptGeneration)
                    return yield* Effect.fail(new ConnectionError('Notion connection cancelled.'))
                const nonce = randomBytes(24).toString('base64url')
                const verifier = randomBytes(32).toString('base64url')
                const scope = yield* Scope.fork(rootScope, ExecutionStrategy.sequential)
                const terminal = yield* Deferred.make<undefined>()
                const server = createServer((incoming, outgoing) => {
                    synchronizeDestination()
                    const current = attempt
                    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1')
                    const host =
                        '127.0.0.1:' +
                        String(
                            (
                                server.address() as {
                                    port: number
                                } | null
                            )?.port
                        )
                    if (
                        !current ||
                        current.server !== server ||
                        incoming.method !== 'GET' ||
                        incoming.headers.host !== host ||
                        url.pathname !== '/callback/' + nonce ||
                        current.callback ||
                        current.error
                    ) {
                        outgoing.writeHead(400).end()
                        return
                    }
                    const state = url.searchParams.get('state'),
                        grant = url.searchParams.get('grant')
                    if (!state || state.length > 2048 || (!grant && !url.searchParams.has('error'))) {
                        outgoing.writeHead(400).end()
                        return
                    }
                    if (Date.now() >= current.expires) current.error = 'Notion sign-in expired. Connect again.'
                    else if (url.searchParams.has('error'))
                        current.error = 'Notion authorization declined. Connect again.'
                    else if (grant && grant.length <= 2048) current.callback = { state, grant }
                    else {
                        outgoing.writeHead(400).end()
                        return
                    }
                    outgoing.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Referrer-Policy': 'no-referrer',
                        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
                    })
                    outgoing.end(
                        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Gitorian</title><p>Return to Gitorian to finish connecting Notion.</p></html>'
                    )
                    // Native callback adaptation signals the Layer-owned terminal monitor.
                    Deferred.unsafeDone(terminal, Effect.succeed(undefined))
                })
                yield* Scope.addFinalizer(
                    scope,
                    Effect.promise(
                        () =>
                            new Promise<void>((resolve) => {
                                server.close(() => resolve())
                            })
                    )
                )
                yield* Scope.addFinalizer(scope, Deferred.succeed(terminal, undefined))
                yield* Effect.forkIn(
                    Effect.interruptible(Deferred.await(terminal).pipe(Effect.zipRight(Scope.close(scope, Exit.void)))),
                    rootScope
                )
                yield* Effect.gen(function* () {
                    yield* Effect.async<undefined, Error>((resume) => {
                        const cleanup = () => {
                            server.removeListener('error', error)
                            server.removeListener('close', close)
                        }
                        const error = (error: Error) => {
                            cleanup()
                            resume(Effect.fail(connectionError(error)))
                        }
                        const close = () => {
                            cleanup()
                            resume(Effect.fail(new ConnectionError('Notion connection cancelled.')))
                        }
                        server.once('error', error)
                        server.once('close', close)
                        server.listen(0, '127.0.0.1', () => {
                            cleanup()
                            resume(Effect.succeed(undefined))
                        })
                        return Effect.sync(cleanup)
                    })
                    if (closed || generation !== attemptGeneration)
                        return yield* Effect.fail(new ConnectionError('Notion connection cancelled.'))
                    const current: Attempt = {
                        server,
                        nonce,
                        verifier,
                        expires: Date.now() + attemptLifetime,
                        scope,
                        terminal
                    }
                    attempt = current
                    current.expiration = yield* Effect.forkIn(
                        Effect.interruptible(
                            Effect.async<undefined>((resume) => {
                                const timer = setTimeout(() => resume(Effect.succeed(undefined)), attemptLifetime)
                                timer.unref()
                                return Effect.sync(() => clearTimeout(timer))
                            }).pipe(
                                Effect.zipRight(
                                    Effect.sync(() => {
                                        if (attempt === current)
                                            current.error = 'Notion sign-in expired. Connect again.'
                                    })
                                ),
                                Effect.zipRight(Deferred.succeed(terminal, undefined)),
                                Effect.asVoid
                            )
                        ),
                        scope
                    )
                }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)))
                const url = new URL(serviceOrigin + '/authorize')
                url.search = new URLSearchParams({
                    port: String(
                        (
                            server.address() as {
                                port: number
                            }
                        ).port
                    ),
                    challenge: createHash('sha256').update(verifier).digest('base64url'),
                    nonce
                }).toString()
                return { url: url.toString(), interval: 1 }
            })
        const poll = (): Effect.Effect<
            | {
                  pending: true
                  interval: number
              }
            | {
                  authorized: true
              },
            Error
        > =>
            Effect.uninterruptible(
                Effect.gen(function* () {
                    const current = attempt
                    if (closed || !current)
                        return yield* Effect.fail(new ConnectionError('Notion connection cancelled. Connect again.'))
                    if (current.error) return yield* Effect.fail(new ConnectionError(current.error))
                    if (Date.now() >= current.expires)
                        return yield* Effect.fail(new ConnectionError('Notion sign-in expired. Connect again.'))
                    if (!current.callback) return { pending: true, interval: 1 }
                    const generation = attemptGeneration
                    const exchange = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (current.exchange) return current.exchange
                            current.exchange = yield* Effect.cached(
                                Effect.gen(function* () {
                                    const value = yield* brokerRequest('/token', {
                                        ...current.callback,
                                        verifier: current.verifier
                                    })
                                    const tokens = yield* Effect.try({
                                        try: () => decodeTokens(value),
                                        catch: connectionError
                                    })
                                    yield* Effect.try({
                                        try: () => {
                                            synchronizeDestination()
                                            if (attemptGeneration !== generation)
                                                throw new ConnectionError('Notion connection cancelled.')
                                            const journal = journalSetup(tokens.workspace_id)
                                            pendingGeneration = credentialGeneration
                                            pendingInstalled = false
                                            pending = { ...tokens, origin: serviceOrigin, journal }
                                        },
                                        catch: connectionError
                                    })
                                    if (current.expiration) yield* Fiber.interrupt(current.expiration)
                                })
                            )
                            return current.exchange
                        })
                    )
                    yield* exchange
                    if (generation !== attemptGeneration)
                        return yield* Effect.fail(new ConnectionError('Notion connection cancelled.'))
                    return { authorized: true }
                })
            )
        const token: TokenAccess = (refresh = false, rejected) =>
            Effect.uninterruptible(
                Effect.gen(function* () {
                    synchronizeDestination()
                    if (closed && !completing)
                        return yield* Effect.fail(new ConnectionError('Notion connection is closed.'))
                    if (refresh && committing && completing) {
                        yield* Effect.exit(completing)
                        return yield* token(refresh, rejected)
                    }
                    const raw = vault.get(credentialKey),
                        current = session()
                    if (!current) return credentialKey === 'notion' && !raw.startsWith('{') ? raw : ''
                    if (!refresh || (rejected && current.access_token !== rejected)) return current.access_token
                    const work = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (refreshing) return refreshing
                            const generation = credentialGeneration
                            const work = yield* Effect.cached(
                                Effect.gen(function* () {
                                    const value = yield* brokerRequest(
                                        '/refresh',
                                        { refresh_token: current.refresh_token },
                                        current.origin
                                    )
                                    const tokens = yield* Effect.try({
                                        try: () => decodeTokens(value),
                                        catch: connectionError
                                    })
                                    if (tokens.workspace_id !== current.workspace_id)
                                        return yield* Effect.fail(
                                            new ConnectionError('Notion workspace changed. Connect again.')
                                        )
                                    yield* Effect.try({
                                        try: () => {
                                            const latest = session()
                                            if (
                                                generation !== credentialGeneration ||
                                                latest?.refresh_token !== current.refresh_token
                                            )
                                                throw new ConnectionError(
                                                    'Notion connection cancelled or disconnected.'
                                                )
                                            save({ ...latest, ...tokens })
                                        },
                                        catch: connectionError
                                    })
                                    return tokens.access_token
                                }).pipe(
                                    Effect.ensuring(
                                        Effect.sync(() => {
                                            if (refreshing === work) refreshing = undefined
                                        })
                                    )
                                )
                            )
                            refreshing = work
                            return work
                        })
                    )
                    return yield* work
                })
            )
        const pendingToken: TokenAccess = (refresh = false, rejected) =>
            Effect.uninterruptible(
                Effect.gen(function* () {
                    synchronizeDestination()
                    if (closed && !completing)
                        return yield* Effect.fail(new ConnectionError('Notion connection is closed.'))
                    if (refresh && committing && completing) {
                        const result = yield* Effect.either(completing)
                        return yield* result._tag === 'Right'
                            ? token(refresh, rejected)
                            : pendingToken(refresh, rejected)
                    }
                    const current = pending
                    if (!current)
                        return yield* Effect.fail(new ConnectionError('Connect Notion before choosing a page.'))
                    if (pendingInstalled) return yield* token(refresh, rejected)
                    if (!refresh || (rejected && current.access_token !== rejected)) return current.access_token
                    const work = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (pendingRefreshing) return pendingRefreshing
                            const work = yield* Effect.cached(
                                Effect.gen(function* () {
                                    const value = yield* brokerRequest(
                                        '/refresh',
                                        { refresh_token: current.refresh_token },
                                        current.origin
                                    )
                                    const tokens = yield* Effect.try({
                                        try: () => decodeTokens(value),
                                        catch: connectionError
                                    })
                                    if (pending !== current)
                                        return yield* Effect.fail(new ConnectionError('Notion connection cancelled.'))
                                    if (tokens.workspace_id !== current.workspace_id)
                                        return yield* Effect.fail(
                                            new ConnectionError('Notion workspace changed. Connect again.')
                                        )
                                    Object.assign(current, tokens)
                                    return tokens.access_token
                                }).pipe(
                                    Effect.ensuring(
                                        Effect.sync(() => {
                                            if (pendingRefreshing === work) pendingRefreshing = undefined
                                        })
                                    )
                                )
                            )
                            pendingRefreshing = work
                            return work
                        })
                    )
                    return yield* work
                })
            )
        const choose = () =>
            Effect.gen(function* () {
                if (closed) return yield* Effect.fail(new ConnectionError('Notion connection is closed.'))
                if (completing)
                    return yield* Effect.fail(new ConnectionError('Notion is finishing setup. Try again in a moment.'))
                const current = session()
                if (!current) return false
                const owner = credentialGeneration
                const choiceGeneration = yield* Effect.sync(() => ++attemptGeneration)
                yield* releaseAttempt()
                return yield* Effect.try({
                    try: () => {
                        synchronizeDestination()
                        if (closed || owner !== credentialGeneration || choiceGeneration !== attemptGeneration)
                            throw new ConnectionError('Notion connection changed while choosing a destination.')
                        const journal = journalSetup(current.workspace_id)
                        pendingGeneration = owner
                        pendingInstalled = true
                        pending = { ...current, journal }
                        return true
                    },
                    catch: connectionError
                })
            })
        const pages = setupPages(pendingToken)
        const installedPages = setupPages(token)
        const finishRecovery = () => {
            const current = session()
            if (!current) return
            savedSetup = { workspace: current.workspace_id, id: current.journal.id }
            try {
                recovery.clear(current.workspace_id)
            } catch {
                /* Cleanup cannot undo a durable activation. */
            }
        }
        const completeJournal = (selection: ConnectionSelection = {}): Effect.Effect<Destination, Error> =>
            Effect.uninterruptible(
                Effect.gen(function* () {
                    const work = yield* registration.withPermits(1)(
                        Effect.gen(function* () {
                            if (closed) return yield* Effect.fail(new ConnectionError('Notion connection is closed.'))
                            if (completing) return completing
                            synchronizeDestination()
                            const generation = credentialGeneration,
                                current = pending
                            if (!current)
                                return yield* Effect.fail(
                                    new ConnectionError('Connect Notion before preparing your journal.')
                                )
                            if (current.journal.started && selection.title && current.journal.title !== selection.title)
                                return yield* Effect.fail(
                                    new ConnectionError('Finish creating the original page or choose an existing page.')
                                )
                            if (selection.title) current.journal = { ...current.journal, title: selection.title }
                            const check = () => {
                                synchronizeDestination()
                                if (generation !== credentialGeneration || pendingGeneration !== generation)
                                    throw new ConnectionError('Notion connection cancelled.')
                            }
                            const work = yield* Effect.cached(
                                Effect.gen(function* () {
                                    const selected = selection.destination
                                        ? {
                                              ...selection.destination,
                                              icon: (yield* pages.destinationIcon(selection.destination.icon)) ?? ''
                                          }
                                        : undefined
                                    const destination = yield* pages.prepareJournal(
                                        current.journal,
                                        (pageId) => {
                                            check()
                                            const journal = {
                                                ...current.journal,
                                                started: true,
                                                ...(pageId ? { pageId } : {})
                                            }
                                            recovery.set(current.workspace_id, journal)
                                            current.journal = journal
                                        },
                                        selected
                                    )
                                    yield* Effect.try({ try: check, catch: connectionError })
                                    for (;;) {
                                        const rotation = pendingInstalled ? refreshing : pendingRefreshing
                                        if (!rotation) break
                                        yield* rotation
                                    }
                                    const transaction = yield* Effect.try({
                                        try: () => {
                                            check()
                                            const latest = pendingInstalled ? session() : current
                                            if (!latest) throw new ConnectionError('Notion connection cancelled.')
                                            committing = true
                                            const slot = credentialKey === 'notion-a' ? 'b' : 'a'
                                            const key = 'notion-' + slot
                                            stagedKey = key
                                            save(
                                                { ...latest, journal: { ...current.journal, pageId: destination.id } },
                                                key
                                            )
                                            check()
                                            const committed: Destination = { ...destination, credentialSlot: slot }
                                            const commitState = store.state
                                            const previous = commitState.settings.destination
                                            commitState.settings.destination = committed
                                            try {
                                                store.persist()
                                            } catch (error) {
                                                if (
                                                    store.state === commitState &&
                                                    commitState.settings.destination === committed
                                                )
                                                    commitState.settings.destination = previous
                                                throw new DurabilityError(error)
                                            }
                                            return { committed, commitState, previous, key }
                                        },
                                        catch: (error) =>
                                            error instanceof DurabilityError ? error : connectionError(error)
                                    })
                                    yield* Effect.tryPromise({
                                        try: () => store.flush(),
                                        catch: (error) => new DurabilityError(error)
                                    }).pipe(
                                        Effect.onError(() =>
                                            Effect.sync(() => {
                                                if (
                                                    store.state === transaction.commitState &&
                                                    transaction.commitState.settings.destination ===
                                                        transaction.committed
                                                )
                                                    transaction.commitState.settings.destination = transaction.previous
                                            })
                                        )
                                    )
                                    return yield* Effect.try({
                                        try: () => {
                                            check()
                                            credentialKey = transaction.key
                                            destinationId = transaction.committed.id
                                            stagedKey = undefined
                                            credentialGeneration++
                                            refreshing = undefined
                                            pending = undefined
                                            finishRecovery()
                                            return transaction.committed
                                        },
                                        catch: connectionError
                                    })
                                }).pipe(
                                    Effect.ensuring(
                                        Effect.sync(() => {
                                            committing = false
                                            if (completing === work) completing = undefined
                                        })
                                    )
                                )
                            )
                            completing = work
                            return work
                        })
                    )
                    return yield* work
                })
            )
        const connected = () => {
            synchronizeDestination()
            if (committing || closed) return false
            const raw = vault.get(credentialKey)
            return !!raw && (raw.startsWith('{') ? !!session()?.journal.pageId : credentialKey === 'notion')
        }
        const refreshDestination = () =>
            Effect.gen(function* () {
                const saved = store.state.settings.destination
                if (!connected() || !saved) return
                const owner = credentialGeneration
                const destination = yield* installedPages.describeDestination(saved)
                synchronizeDestination()
                if (
                    !closed &&
                    owner === credentialGeneration &&
                    store.state.settings.destination === saved &&
                    connected() &&
                    JSON.stringify(saved) !== JSON.stringify(destination)
                ) {
                    store.state.settings.destination = { ...destination, credentialSlot: saved.credentialSlot }
                    yield* Effect.try({
                        try: () => {
                            store.persist()
                        },
                        catch: (error) => new DurabilityError(error)
                    })
                }
            })
        const profileKey = () => session()?.access_token ?? (credentialKey === 'notion' ? vault.get(credentialKey) : '')
        const disconnect = () =>
            Effect.gen(function* () {
                yield* cancel()
                credentialGeneration++
                refreshing = undefined
                yield* Effect.try({
                    try: () => {
                        for (const key of ['notion', 'notion-a', 'notion-b']) vault.set(key, '')
                        vault.set('notion-setup', '')
                    },
                    catch: connectionError
                })
                pending = undefined
            })
        return {
            start: Effect.fn('NotionConnection.start')(start, Effect.mapError(toNotionError)),
            poll: Effect.fn('NotionConnection.poll')(poll, Effect.mapError(toNotionError)),
            token: Effect.fn('NotionConnection.token')(token, Effect.mapError(toNotionError)),
            pendingToken: Effect.fn('NotionConnection.pendingToken')(pendingToken, Effect.mapError(toNotionError)),
            choose: Effect.fn('NotionConnection.choose')(choose, Effect.mapError(toNotionError)),
            completeJournal: Effect.fn('NotionConnection.completeJournal')(
                completeJournal,
                Effect.mapError(toNotionError)
            ),
            refreshDestination: Effect.fn('NotionConnection.refreshDestination')(
                refreshDestination,
                Effect.mapError(toNotionError)
            ),
            cancel,
            disconnect: Effect.fn('NotionConnection.disconnect')(disconnect, Effect.mapError(toNotionError)),
            connected,
            profileKey
        }
    })
}
