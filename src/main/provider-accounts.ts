import sharp from 'sharp'
import { downloadImage } from './images'
import { randomUUID } from 'node:crypto'
import { Context, Effect, Exit, Fiber, Layer, Scope } from 'effect'
import { z } from 'zod'
import { Http, HttpError, TransportError } from './http'
import { DatabaseError } from './database/types'
import { JournalStore } from './journal-context'
import {
    remoteConfiguration,
    chooseAccount,
    providerRemote,
    providerName,
    type Provider,
    type ProviderAccount
} from '../shared/provider-accounts'
import type { Repository } from '../shared/model'

export interface ProviderVault {
    get(key: string): string
    set(key: string, value: string): void
    protected(): boolean
}
export interface ProviderAccountAdapters {
    vault: ProviderVault
    fetcher?: typeof fetch
    gitlabClientId?: string
}
const githubClientId = 'Ov23li9PFMAWRrbZQ6Xy'
// Public application identifier supplied by the owner; never a client secret.
const defaultGitLabClientId = '996eb527b4a182b07fd19c41e0923e73d8912ff15b087ab801e5abcaf92ba9d1'
const credentials = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().optional(),
    expires: z.number().optional()
})
const tokenResponse = z.object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_in: z.number().optional(),
    error: z.string().optional()
})
const deviceResponse = z.object({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.url(),
    interval: z.number().positive(),
    expires_in: z.number().positive()
})
export class ProviderAccountError extends Error {
    readonly _tag = 'ProviderAccountError'
}
const native = <A>(operation: () => A | Promise<A>) =>
    Effect.tryPromise({
        try: async () => operation(),
        catch: (e) => (e instanceof Error ? e : new ProviderAccountError(String(e)))
    })
export type ProviderAccounts = Effect.Effect.Success<ReturnType<typeof makeAccounts>>
export const ProviderAccounts = Context.GenericTag<ProviderAccounts>('gitorian/ProviderAccounts')
export const ProviderAccountsLive = (adapters: ProviderAccountAdapters) =>
    Layer.scoped(ProviderAccounts, makeAccounts(adapters))

function makeAccounts({ vault, fetcher = fetch, gitlabClientId = defaultGitLabClientId }: ProviderAccountAdapters) {
    return Effect.gen(function* () {
        const store = yield* JournalStore
        const http = yield* Http
        const scope = yield* Scope.make()
        const locks = new Map<string, Effect.Semaphore>()
        const lock = (key: string) => {
            let value = locks.get(key)
            if (!value) {
                value = Effect.unsafeMakeSemaphore(1)
                locks.set(key, value)
            }
            return value
        }
        let closed = false
        const own = <A, E>(operation: Effect.Effect<A, E>) =>
            Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                    if (closed) return yield* Effect.fail(new ProviderAccountError('Connections are closed.'))
                    const fiber = yield* Effect.forkIn(Effect.interruptible(operation), scope)
                    return yield* restore(Fiber.join(fiber)).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
                })
            )
        const attempts = new Map<
            string,
            z.infer<typeof deviceResponse> & {
                provider: Provider
                accountId?: string
                generations: Record<string, number>
                journal: string
                expires: number
                next: number
            }
        >()
        const clientId = (provider: Provider) =>
            provider === 'github' ? githubClientId : gitlabClientId || defaultGitLabClientId
        const endpoint = (provider: Provider) =>
            provider === 'github' ? 'https://github.com/login/oauth/access_token' : 'https://gitlab.com/oauth/token'
        const post = (url: string, body: Record<string, string>) =>
            Effect.tryPromise({
                try: async (signal) => {
                    const form = new URL(url).host === 'gitlab.com'
                    const response = await fetcher(url, {
                        method: 'POST',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json'
                        },
                        body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
                        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
                        redirect: 'error'
                    })
                    const responseBody: unknown = await response.json()
                    if (
                        !response.ok &&
                        !(
                            response.status === 400 &&
                            tokenResponse.safeParse(responseBody).success &&
                            tokenResponse.parse(responseBody).error
                        )
                    )
                        throw new HttpError(response.status, 'Sign-in could not be completed. Try again.')
                    return responseBody
                },
                catch: (e) => (e instanceof HttpError ? e : new TransportError(e))
            })
        const install = (
            account: ProviderAccount,
            secret: string,
            journal: string,
            expected?: ProviderAccount,
            valid = () => true
        ) =>
            lock(`mutation:${account.id}`).withPermits(1)(
                Effect.uninterruptible(
                    Effect.gen(function* () {
                        const pending = store.config.accountPreparations.find((a) => a.id === account.id)
                        if (pending && pending.credentialKey !== account.credentialKey) yield* recoverLocked(account.id)
                        const current = store.config.accounts.find((a) => a.id === account.id)
                        if (
                            !valid() ||
                            current?.generation !== expected?.generation ||
                            current?.credentialKey !== expected?.credentialKey
                        )
                            return yield* Effect.fail(
                                new ProviderAccountError('This account changed. Start sign-in again.')
                            )
                        const old = store.config.accounts.find((a) => a.id === account.id)?.credentialKey
                        yield* native(() => store.prepareProviderAccount(account, journal))
                        yield* native(() => vault.set(account.credentialKey!, secret))
                        yield* native(() => store.activateProviderAccount(account.id, account.generation, journal))
                        yield* Effect.gen(function* () {
                            if (old && old !== account.credentialKey) yield* native(() => vault.set(old, ''))
                            yield* native(() => store.finishProviderAccount(account.id, journal))
                        }).pipe(
                            Effect.catchAll(() =>
                                Effect.logWarning('Credential cleanup will retry on the next launch.')
                            )
                        )
                    })
                )
            )
        const deactivate = (
            id: string,
            status: 'disconnected' | 'reconnect' = 'disconnected',
            rejected?: { generation: number; access: string }
        ) =>
            lock(`mutation:${id}`).withPermits(1)(
                Effect.uninterruptible(
                    Effect.gen(function* () {
                        if (rejected) {
                            const current = store.config.accounts.find((a) => a.id === id)
                            if (
                                !current ||
                                current.generation !== rejected.generation ||
                                !['connected', 'session'].includes(current.status) ||
                                !current.credentialKey
                            )
                                return
                            const secret = yield* native(() =>
                                credentials.parse(JSON.parse(vault.get(current.credentialKey!)))
                            )
                            if (secret.access_token !== rejected.access) return
                        }
                        for (const [key, attempt] of attempts) if (attempt.accountId === id) attempts.delete(key)
                        const keys = yield* native(() => store.disconnectProviderAccount(id, store.generation, status))
                        for (const key of keys) {
                            yield* native(() => vault.set(key, ''))
                            yield* native(() => store.finishCredentialCleanup(key))
                        }
                        yield* native(() => store.finishProviderAccount(id))
                    })
                )
            )
        const recoverLocked = (id: string) =>
            Effect.gen(function* () {
                const pending = store.config.accountPreparations.find((a) => a.id === id)
                if (!pending) return
                const current = store.config.accounts.find((a) => a.id === id)
                if (pending.status === 'disconnected') {
                    for (const key of [pending.credentialKey, pending.predecessorKey])
                        if (key) yield* native(() => vault.set(key, ''))
                    yield* native(() => store.finishProviderAccount(id))
                    return
                }
                if (pending.credentialKey && vault.get(pending.credentialKey)) {
                    if (current?.credentialKey !== pending.credentialKey)
                        yield* native(() => store.activateProviderAccount(id, pending.generation)).pipe(
                            Effect.catchAll((error) =>
                                error instanceof DatabaseError && error.code === 'conflict'
                                    ? native(() => vault.set(pending.credentialKey!, ''))
                                    : Effect.fail(error)
                            )
                        )
                } else if (current && current.credentialKey !== pending.credentialKey) {
                    const keys = yield* native(() => store.disconnectProviderAccount(id, store.generation, 'reconnect'))
                    for (const key of keys) yield* native(() => vault.set(key, ''))
                }
                if (
                    pending.predecessorKey &&
                    pending.predecessorKey !== store.config.accounts.find((a) => a.id === id)?.credentialKey
                )
                    yield* native(() => vault.set(pending.predecessorKey!, ''))
                yield* native(() => store.finishProviderAccount(id))
            })
        const recover = (id: string) => lock(`mutation:${id}`).withPermits(1)(recoverLocked(id))
        const cleanup = () =>
            Effect.uninterruptible(
                Effect.gen(function* () {
                    for (const key of store.config.credentialCleanup) {
                        yield* native(() => vault.set(key, ''))
                        yield* native(() => store.finishCredentialCleanup(key))
                    }
                })
            )
        yield* cleanup()
        for (const pending of store.config.accountPreparations) yield* recover(pending.id)
        yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
                closed = true
                attempts.clear()
                yield* Scope.close(scope, Exit.void)
            })
        )
        const accounts = () =>
            store.config.accounts.map(({ credentialKey: key, ...account }) => ({
                ...account,
                status:
                    key && vault.get(key)
                        ? account.status
                        : account.status === 'disconnected'
                          ? ('disconnected' as const)
                          : ('reconnect' as const)
            }))
        const token = (id: string, rejected?: string): Effect.Effect<string, Error> =>
            lock(`account:${id}`).withPermits(1)(
                Effect.gen(function* () {
                    yield* recover(id)
                    const journal = store.generation
                    const account = store.config.accounts.find((a) => a.id === id)
                    if (
                        closed ||
                        !account ||
                        !['connected', 'session'].includes(account.status) ||
                        !account.credentialKey
                    )
                        return yield* Effect.fail(new ProviderAccountError('Reconnect this account in Settings.'))
                    const stored = yield* native(() =>
                        credentials.parse(JSON.parse(vault.get(account.credentialKey!)))
                    ).pipe(
                        Effect.mapError(
                            (cause) =>
                                new ProviderAccountError(
                                    'Saved credentials could not be read. Reconnect in Settings.',
                                    { cause }
                                )
                        )
                    )
                    if (rejected && rejected !== stored.access_token) return stored.access_token
                    if (
                        !stored.refresh_token ||
                        (!rejected && (!stored.expires || stored.expires > Date.now() + 60000))
                    )
                        return stored.access_token
                    return yield* Effect.uninterruptible(
                        Effect.gen(function* () {
                            const rotated = { ...account, credentialKey: `provider-${randomUUID()}` }
                            yield* lock(`mutation:${id}`).withPermits(1)(
                                Effect.gen(function* () {
                                    yield* recoverLocked(id)
                                    const current = store.config.accounts.find((a) => a.id === id)
                                    if (
                                        current?.generation !== account.generation ||
                                        current.credentialKey !== account.credentialKey
                                    )
                                        return yield* Effect.fail(
                                            new ProviderAccountError('This account changed. Retry the request.')
                                        )
                                    yield* native(() => store.prepareProviderAccount(rotated, journal))
                                })
                            )
                            const response = yield* post(endpoint(account.provider), {
                                client_id: clientId(account.provider),
                                grant_type: 'refresh_token',
                                refresh_token: stored.refresh_token!
                            }).pipe(
                                Effect.tapError((error) =>
                                    error instanceof HttpError && error.status >= 500
                                        ? native(() => store.finishProviderAccount(id, journal))
                                        : deactivate(id, 'reconnect', {
                                              generation: account.generation,
                                              access: stored.access_token
                                          })
                                )
                            )
                            const result = yield* native(() => tokenResponse.parse(response)).pipe(
                                Effect.tapError(() =>
                                    deactivate(id, 'reconnect', {
                                        generation: account.generation,
                                        access: stored.access_token
                                    })
                                )
                            )
                            if (!result.access_token) {
                                yield* deactivate(id, 'reconnect', {
                                    generation: account.generation,
                                    access: stored.access_token
                                })
                                return yield* Effect.fail(
                                    new ProviderAccountError('Connection expired. Reconnect this account in Settings.')
                                )
                            }
                            const secret = JSON.stringify({
                                access_token: result.access_token,
                                refresh_token: result.refresh_token,
                                expires: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined
                            })
                            yield* install(rotated, secret, journal, account)
                            return result.access_token
                        })
                    )
                })
            )
        const request = <A>(
            id: string,
            url: string,
            background = false,
            init: RequestInit = {},
            format: 'json' | 'text' = 'json'
        ): Effect.Effect<A, Error> =>
            Effect.gen(function* () {
                const account = store.config.accounts.find((a) => a.id === id)
                const origin = account?.provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com'
                if (!account || new URL(url).origin !== origin)
                    return yield* Effect.fail(new ProviderAccountError('Unsupported account destination.'))
                const access = yield* token(id)
                return yield* http
                    .request<A>(url, access, { ...init, redirect: 'error' }, format, {
                        background,
                        maxBytes: format === 'text' ? 2_000_000 : undefined
                    })
                    .pipe(
                        Effect.catchAll((error) =>
                            error instanceof HttpError && error.status === 401
                                ? Effect.gen(function* () {
                                      const renewed = yield* token(id, access)
                                      if (renewed === access) {
                                          yield* deactivate(id, 'reconnect', { generation: account.generation, access })
                                          return yield* Effect.fail(
                                              new ProviderAccountError('Reconnect this account in Settings.')
                                          )
                                      }
                                      return yield* http
                                          .request<A>(url, renewed, { ...init, redirect: 'error' }, format, {
                                              background,
                                              maxBytes: format === 'text' ? 2_000_000 : undefined
                                          })
                                          .pipe(
                                              Effect.tapError((error) =>
                                                  error instanceof HttpError && error.status === 401
                                                      ? deactivate(id, 'reconnect', {
                                                            generation: account.generation,
                                                            access: renewed
                                                        })
                                                      : Effect.void
                                              )
                                          )
                                  })
                                : Effect.fail(error)
                        )
                    )
            })
        const begin = (provider: Provider, accountId?: string) =>
            Effect.gen(function* () {
                if (closed) return yield* Effect.fail(new ProviderAccountError('Connections are closed.'))
                const generations = Object.fromEntries(store.config.accounts.map((a) => [a.id, a.generation]))
                const journal = store.generation
                if (!clientId(provider))
                    return yield* Effect.fail(
                        new ProviderAccountError('GitLab sign-in is not configured in this build.')
                    )
                if (accountId && !store.config.accounts.some((a) => a.id === accountId && a.provider === provider))
                    return yield* Effect.fail(new ProviderAccountError('Account not found.'))
                const url =
                    provider === 'github'
                        ? 'https://github.com/login/device/code'
                        : 'https://gitlab.com/oauth/authorize_device'
                const decoded = deviceResponse.safeParse(
                    yield* post(url, {
                        client_id: clientId(provider),
                        scope: provider === 'github' ? 'repo read:user user:email' : 'read_api read_user'
                    })
                )
                if (!decoded.success)
                    return yield* Effect.fail(
                        new ProviderAccountError(
                            `${providerName(provider)} sign-in is unavailable. Check the application registration and try again.`
                        )
                    )
                const device = decoded.data
                const expectedHost = provider === 'github' ? 'github.com' : 'gitlab.com'
                if (new URL(device.verification_uri).origin !== `https://${expectedHost}`)
                    return yield* Effect.fail(new ProviderAccountError('Invalid sign-in destination.'))
                const id = randomUUID()
                attempts.set(id, {
                    ...device,
                    provider,
                    accountId,
                    generations,
                    journal,
                    expires: Date.now() + device.expires_in * 1000,
                    next: Date.now() + device.interval * 1000
                })
                return { id, code: device.user_code, url: device.verification_uri, interval: device.interval }
            })
        const complete = (id: string) =>
            lock(`attempt:${id}`).withPermits(1)(
                Effect.gen(function* () {
                    const attempt = attempts.get(id)
                    if (!attempt || attempt.journal !== store.generation || Date.now() > attempt.expires || closed)
                        return yield* Effect.fail(new ProviderAccountError('Code expired. Start sign-in again.'))
                    if (Date.now() < attempt.next)
                        return {
                            pending: true as const,
                            interval: Math.max(1, Math.ceil((attempt.next - Date.now()) / 1000))
                        }
                    attempt.next = Date.now() + attempt.interval * 1000
                    const response = yield* post(endpoint(attempt.provider), {
                        client_id: clientId(attempt.provider),
                        device_code: attempt.device_code,
                        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                    })
                    const result = yield* native(() => tokenResponse.parse(response))
                    if (result.error === 'slow_down') {
                        attempt.interval += 5
                        attempt.next = Date.now() + attempt.interval * 1000
                    }
                    if (result.error === 'authorization_pending' || result.error === 'slow_down')
                        return { pending: true as const, interval: attempt.interval }
                    if (!result.access_token)
                        return yield* Effect.fail(
                            new ProviderAccountError(
                                result.error === 'access_denied'
                                    ? 'Authorization declined. Start again.'
                                    : 'Sign-in expired. Start again.'
                            )
                        )
                    const provider = attempt.provider
                    const user = yield* http.request<{
                        id: number
                        login?: string
                        username?: string
                        email?: string
                        avatar_url?: string
                    }>(
                        provider === 'github' ? 'https://api.github.com/user' : 'https://gitlab.com/api/v4/user',
                        result.access_token
                    )
                    // Store the bounded image with the identity so revisiting Settings is offline-ready.
                    const avatarUrl = yield* Effect.tryPromise(async () => {
                        if (!user.avatar_url) return undefined
                        const image = await downloadImage(user.avatar_url)
                        const bytes = await sharp(image.bytes)
                            .resize(64, 64, { fit: 'cover' })
                            .webp({ quality: 80 })
                            .toBuffer()
                        return `data:image/webp;base64,${bytes.toString('base64')}`
                    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
                    const userId = String(user.id)
                    if (!Number.isSafeInteger(user.id) || !user.id || !(user.login ?? user.username))
                        return yield* Effect.fail(new ProviderAccountError('The provider returned an invalid account.'))
                    const emails =
                        provider === 'github'
                            ? (yield* http.request<{ email: string; verified: boolean }[]>(
                                  'https://api.github.com/user/emails',
                                  result.access_token,
                                  { redirect: 'error' }
                              ))
                                  .filter((e) => e.verified)
                                  .map((e) => e.email)
                            : (yield* http
                                  .request<{ email: string; confirmed_at: string | null }[]>(
                                      'https://gitlab.com/api/v4/user/emails',
                                      result.access_token,
                                      { redirect: 'error' }
                                  )
                                  .pipe(Effect.catchAll(() => Effect.succeed([]))))
                                  .filter((e) => !!e.confirmed_at)
                                  .map((e) => e.email)
                    return yield* lock(`identity:${provider}:${userId}`).withPermits(1)(
                        Effect.gen(function* () {
                            const accountId =
                                store.config.accounts.find((a) => a.provider === provider && a.userId === userId)?.id ??
                                randomUUID()
                            return yield* lock(`account:${accountId}`).withPermits(1)(
                                Effect.gen(function* () {
                                    const existing = store.config.accounts.find(
                                        (a) => a.provider === provider && a.userId === userId
                                    )
                                    if (
                                        existing &&
                                        ((attempt.generations[existing.id] !== undefined &&
                                            attempt.generations[existing.id] !== existing.generation) ||
                                            (attempt.generations[existing.id] === undefined &&
                                                existing.status === 'disconnected'))
                                    )
                                        return yield* Effect.fail(
                                            new ProviderAccountError('This account changed. Start sign-in again.')
                                        )
                                    if (attempt.accountId && existing?.id !== attempt.accountId)
                                        return yield* Effect.fail(
                                            new ProviderAccountError(
                                                'You signed in to a different account. Retry with the expected account or add it separately.'
                                            )
                                        )
                                    if (attempts.get(id) !== attempt || store.generation !== attempt.journal)
                                        return yield* Effect.fail(new ProviderAccountError('Sign-in was cancelled.'))
                                    const account: ProviderAccount = {
                                        id: accountId,
                                        provider,
                                        host: provider === 'github' ? 'github.com' : 'gitlab.com',
                                        userId,
                                        username: (user.login ?? user.username)!,
                                        avatarUrl: avatarUrl ?? existing?.avatarUrl,
                                        emails,
                                        generation: (existing?.generation ?? 0) + 1,
                                        status: vault.protected() ? 'connected' : 'session',
                                        credentialKey: `provider-${randomUUID()}`
                                    }
                                    yield* install(
                                        account,
                                        JSON.stringify({
                                            access_token: result.access_token,
                                            refresh_token: result.refresh_token,
                                            expires: result.expires_in
                                                ? Date.now() + result.expires_in * 1000
                                                : undefined
                                        }),
                                        attempt.journal,
                                        existing,
                                        () => attempts.get(id) === attempt && store.generation === attempt.journal
                                    )
                                    attempts.delete(id)
                                    return { pending: false as const, accountId: account.id }
                                })
                            )
                        })
                    )
                })
            )
        const resolve = (repositoryId: string, choice?: string) =>
            Effect.gen(function* () {
                const journal = store.generation
                const automatic = choice === 'automatic'
                const repository = store.config.repositories.find((r) => r.id === repositoryId)
                if (!repository) return yield* Effect.fail(new ProviderAccountError('Repository not found.'))
                const remote = providerRemote(repository.remote)
                if (!remote) return undefined
                if (!choice && repository.accountId && repository.providerProjectId) return repository.accountId
                const pinned = !choice ? repository.accountId : undefined
                const candidates = store.config.accounts.filter(
                    (a) =>
                        a.provider === remote.provider &&
                        a.host === remote.host &&
                        ['connected', 'session'].includes(a.status) &&
                        (pinned ? a.id === pinned : !choice || automatic || a.id === choice)
                )
                const evidence: {
                    id: string
                    access: 'allowed' | 'denied' | 'unknown'
                    identity: boolean
                    emailMatch: boolean
                    projectId?: string
                }[] = []
                for (const account of candidates) {
                    const url =
                        remote.provider === 'github'
                            ? `https://api.github.com/repos/${remote.path}`
                            : `https://gitlab.com/api/v4/projects/${encodeURIComponent(remote.path)}`
                    const access = yield* request<{
                        id?: number
                        owner?: { login: string; type: string }
                        namespace?: { kind: string; path: string }
                    }>(account.id, url).pipe(
                        Effect.map((project) => ({ access: 'allowed' as const, project })),
                        Effect.catchAll((error) =>
                            Effect.succeed({
                                access:
                                    error instanceof HttpError && error.status === 404
                                        ? ('denied' as const)
                                        : ('unknown' as const),
                                project: undefined
                            })
                        )
                    )
                    const owner =
                        access.project?.owner?.type === 'User'
                            ? access.project.owner.login
                            : access.project?.namespace?.kind === 'user'
                              ? access.project.namespace.path
                              : ''
                    evidence.push({
                        id: account.id,
                        access: access.access,
                        projectId: access.project?.id ? String(access.project.id) : undefined,
                        emailMatch: account.emails.some((email) =>
                            repository.emails.some((e) => e.toLowerCase() === email.toLowerCase())
                        ),
                        identity:
                            account.emails.some((email) =>
                                repository.emails.some((e) => e.toLowerCase() === email.toLowerCase())
                            ) ||
                            (!!owner && owner.toLowerCase() === account.username.toLowerCase())
                    })
                }
                const selected = pinned
                    ? evidence.find((e) => e.id === pinned && e.access === 'allowed')?.id
                    : choice && !automatic
                      ? evidence.find((e) => e.id === choice && e.access === 'allowed')?.id
                      : chooseAccount(evidence)
                if (choice && !automatic && !selected)
                    return yield* Effect.fail(
                        new ProviderAccountError(
                            `This account could not access the ${providerName(remote.provider)} repository. Check its connection and permissions.`
                        )
                    )
                if (!selected && !automatic) return pinned
                const account = candidates.find((a) => a.id === selected)
                yield* native(() =>
                    store.assignProviderAccount(
                        repositoryId,
                        remoteConfiguration(repository),
                        {
                            accountId: selected,
                            accountGeneration: account?.generation,
                            providerProjectId: evidence.find((e) => e.id === selected)?.projectId,
                            assignment:
                                choice && !automatic
                                    ? 'explicit'
                                    : automatic
                                      ? 'automatic'
                                      : (repository.assignment ?? 'automatic')
                        },
                        journal
                    )
                )
                return selected
            })
        const context = (repository: Repository) => {
            const account = store.config.accounts.find((a) => a.id === repository.accountId)
            const remote = providerRemote(repository.remote)
            return account &&
                remote &&
                account.provider === remote.provider &&
                ['connected', 'session'].includes(account.status)
                ? { account, remote }
                : undefined
        }
        const migrateLegacy = Effect.gen(function* () {
            const journal = store.generation
            const legacy = vault.get('github')
            if (!legacy) return
            const credential = legacy.startsWith('{')
                ? yield* native(() => credentials.parse(JSON.parse(legacy)))
                : { access_token: legacy }
            const user = yield* http.request<{ id: number; login: string }>(
                'https://api.github.com/user',
                credential.access_token,
                { redirect: 'error' }
            )
            if (!Number.isSafeInteger(user.id) || !user.login)
                return yield* Effect.fail(new ProviderAccountError('Reconnect GitHub in Settings to finish upgrading.'))
            yield* lock(`identity:github:${user.id}`).withPermits(1)(
                Effect.gen(function* () {
                    const existing = store.config.accounts.find(
                        (a) => a.provider === 'github' && a.userId === String(user.id)
                    )
                    if (existing) return yield* native(() => vault.set('github', ''))
                    const emails = (yield* http.request<{ email: string; verified: boolean }[]>(
                        'https://api.github.com/user/emails',
                        credential.access_token,
                        { redirect: 'error' }
                    ))
                        .filter((e) => e.verified)
                        .map((e) => e.email)
                    const account: ProviderAccount = {
                        id: randomUUID(),
                        provider: 'github',
                        host: 'github.com',
                        userId: String(user.id),
                        username: user.login,
                        emails,
                        generation: 1,
                        status: vault.protected() ? 'connected' : 'session',
                        credentialKey: `provider-${randomUUID()}`
                    }
                    yield* install(account, JSON.stringify(credential), journal)
                    for (const repository of store.config.repositories.filter(
                        (r) => !r.accountId && providerRemote(r.remote)?.provider === 'github'
                    ))
                        yield* native(() =>
                            store.assignProviderAccount(
                                repository.id,
                                remoteConfiguration(repository),
                                { accountId: account.id, accountGeneration: 1, assignment: 'automatic' },
                                journal
                            )
                        )
                    yield* native(() => vault.set('github', ''))
                })
            )
        })
        return {
            accounts,
            context,
            cleanup: () => own(cleanup()),
            migrateLegacy: own(migrateLegacy),
            token: Effect.fn('ProviderAccounts.token')(token, own),
            request: <A>(...args: Parameters<typeof request<A>>) => own(request<A>(...args)),
            begin: Effect.fn('ProviderAccounts.begin')(begin, own),
            complete: Effect.fn('ProviderAccounts.complete')(complete, own),
            cancel: (id: string) =>
                Effect.sync(() => {
                    attempts.delete(id)
                }),
            disconnect: Effect.fn('ProviderAccounts.disconnect')((id: string) => deactivate(id), own),
            resolve: Effect.fn('ProviderAccounts.resolve')(resolve, own)
        }
    })
}
