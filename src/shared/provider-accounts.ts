import { z } from 'zod'

export const providerSchema = z.enum(['github', 'gitlab'])
export type Provider = z.infer<typeof providerSchema>
export const providerAccountSchema = z.object({
    id: z.uuid(),
    provider: providerSchema,
    host: z.enum(['github.com', 'gitlab.com']),
    userId: z.string().min(1),
    username: z.string().min(1),
    emails: z.array(z.string()),
    avatarUrl: z.string().optional(),
    generation: z.number().int().nonnegative(),
    status: z.enum(['connected', 'session', 'disconnected', 'reconnect']),
    credentialKey: z
        .string()
        .regex(/^provider-[a-f0-9-]+$/)
        .optional()
})
export type ProviderAccount = z.infer<typeof providerAccountSchema>
export type ProviderPreparation = ProviderAccount & { predecessorKey?: string; previousGeneration: number }
export type AccountSummary = Omit<ProviderAccount, 'credentialKey'>
export interface ProviderRemote {
    provider: Provider
    host: 'github.com' | 'gitlab.com'
    path: string
}

export function providerRemote(value: string): ProviderRemote | undefined {
    const match =
        /^(?:https:\/\/|ssh:\/\/git@)(github\.com|gitlab\.com)\/([^?#\s]+)$/.exec(value) ??
        /^git@(github\.com|gitlab\.com):([^?#\s]+)$/.exec(value)
    if (!match) return
    const host = match[1] as ProviderRemote['host']
    const path = match[2].replace(/\/$/, '').replace(/\.git$/, '')
    const parts = path.split('/')
    if (
        parts.length < 2 ||
        (host === 'github.com' && parts.length !== 2) ||
        parts.some((p) => !/^[\w.-]+$/.test(p) || p === '.' || p === '..')
    )
        return
    return { provider: host === 'github.com' ? 'github' : 'gitlab', host, path }
}

export function chooseAccount(
    candidates: { id: string; access: 'allowed' | 'denied' | 'unknown'; identity: boolean; emailMatch?: boolean }[]
): string | undefined {
    const emails = candidates.filter((c) => c.access === 'allowed' && c.emailMatch)
    if (emails.length === 1) return emails[0].id
    if (emails.length > 1) return undefined
    const matched = candidates.filter((c) => c.access === 'allowed' && c.identity)
    if (matched.length === 1) return matched[0].id
    const possible = candidates.filter((c) => c.access !== 'denied')
    return possible.length === 1 && possible[0].access === 'allowed' ? possible[0].id : undefined
}

export function providerName(provider: Provider) {
    return provider === 'github' ? 'GitHub' : 'GitLab'
}
export function remoteConfiguration(repository: {
    remote: string
    emails: string[]
    accountId?: string
    accountGeneration?: number
}) {
    return JSON.stringify([repository.remote, repository.emails, repository.accountId ?? ''])
}
