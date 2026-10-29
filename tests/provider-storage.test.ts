import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { JournalDatabase } from '../src/main/journal-database'

// Independent outcomes: durable account activation, stale credential writes rejected,
// secrets/credential keys absent from exports, restored accounts require reconnection.
it('activates accounts durably and fences superseded sessions without exporting credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gitorian-provider-'))
    let db = await JournalDatabase.open(join(directory, 'journal.sqlite'))
    try {
        const id = randomUUID(),
            key = `provider-${randomUUID()}`
        const account = {
            id,
            provider: 'github' as const,
            host: 'github.com' as const,
            userId: '42',
            username: 'work',
            emails: ['work@example.test'],
            generation: 1,
            status: 'connected' as const,
            credentialKey: key
        }
        await db.prepareProviderAccount(account)
        await db.activateProviderAccount(id, 1)
        expect(db.config.accounts[0]?.username).toBe('work')
        await db.close()
        db = await JournalDatabase.open(join(directory, 'journal.sqlite'))
        expect(db.config.accounts[0]?.credentialKey).toBe(key)
        await db.disconnectProviderAccount(id)
        await expect(db.activateProviderAccount(id, 1)).rejects.toThrow()
        const replacement = `provider-${randomUUID()}`
        await db.prepareProviderAccount({ ...account, generation: 3, credentialKey: replacement })
        await db.activateProviderAccount(id, 3)
        await db.saveRepository({
            id: 'repo',
            name: 'Repo',
            path: '',
            remote: 'https://github.com/team/repo',
            base: 'main',
            trackingStart: '2026-10-01',
            emails: [],
            branches: [],
            branchBases: {},
            removed: false,
            available: false,
            accountId: id,
            accountGeneration: 3,
            providerProjectId: '10',
            assignment: 'explicit'
        })
        const captured = {
            ...db.config.repositories[0],
            accountId: undefined,
            accountGeneration: undefined,
            providerProjectId: undefined
        }
        await db.saveRepository(captured)
        expect(db.config.repositories[0].accountId).toBe(id)
        expect(db.config.repositories[0].providerProjectId).toBe('10')
        await db.updateRepositorySettings({ ...captured, path: 'stale-folder', name: 'Renamed' })
        expect(db.config.repositories[0]).toMatchObject({
            accountId: id,
            providerProjectId: '10',
            path: '',
            name: 'Renamed'
        })
        const { remoteConfiguration } = await import('../src/shared/provider-accounts')
        const staleNative = {
            ...captured,
            remote: 'https://gitlab.com/other/repo',
            path: 'located-folder',
            available: true
        }
        await db.updateRepositoryLocation(staleNative)
        expect(db.config.repositories[0]).toMatchObject({
            accountId: id,
            providerProjectId: '10',
            remote: 'https://github.com/team/repo',
            path: 'located-folder',
            name: 'Renamed'
        })
        await db.assignProviderAccount('repo', remoteConfiguration(db.config.repositories[0]), {
            accountId: undefined,
            accountGeneration: undefined,
            providerProjectId: undefined,
            assignment: 'automatic'
        })
        expect(db.config.repositories[0].accountId).toBeUndefined()
        expect(db.config.repositories[0].providerProjectId).toBeUndefined()
        expect(await db.disconnectProviderAccount(id)).toEqual(expect.arrayContaining([key, replacement]))
        const backup = await db.export()
        expect(backup).not.toContain(key)
        expect(backup).not.toContain(replacement)
        await db.restore(backup)
        expect(db.config.accounts[0]?.status).toBe('disconnected')
        await db.close()
        db = await JournalDatabase.open(join(directory, 'journal.sqlite'))
        expect(db.config.credentialCleanup).toEqual(expect.arrayContaining([key, replacement]))
    } finally {
        await db.close()
        await rm(directory, { recursive: true, force: true })
    }
})
