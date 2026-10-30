import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/providers-main.mjs' })

test('provider accounts: multiple identities, GitLab, automatic assignment and reconnect isolation', async ({
    desktop
}, info) => {
    let { page, app } = desktop
    const { scratch, chooseFolder, shot, profile } = desktop
    const folder = join(scratch, 'Projects')
    for (const [name, email, remote] of [
        ['work', 'work@example.test', 'https://github.com/team/backend.git'],
        ['lab', 'lab@example.test', 'git@gitlab.com:team/sub/project.git'],
        ['shared', 'unknown@example.test', 'https://github.com/team/shared.git']
    ]) {
        const path = join(folder, name)
        mkdirSync(path, { recursive: true })
        for (const args of [
            ['init', '-b', 'main'],
            ['config', 'user.email', email],
            ['remote', 'add', 'origin', remote]
        ])
            execFileSync('git', args, { cwd: path, windowsHide: true, stdio: 'ignore' })
    }
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    await test.step('import a repository before connecting its provider account', async () => {
        await page.getByRole('tab', { name: 'Repositories', exact: true }).click()
        await chooseFolder(join(folder, 'work'))
        await page.getByRole('button', { name: 'Add repositories from folder', exact: true }).click()
        await page.getByRole('button', { name: 'Import 1 repository', exact: true }).click()
        await expect
            .poll(
                async () =>
                    (await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.repositories.length
            )
            .toBe(1)
        const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(state.repositories[0].accountId).toBeUndefined()
    })
    await page.getByRole('tab', { name: 'Connections', exact: true }).click()
    await test.step('connect personal and work GitHub identities and GitLab through real IPC', async () => {
        await page.getByRole('button', { name: 'Add GitHub account', exact: true }).click()
        await expect(page.locator('.github-signin-code')).toHaveText('GHTX-ABCD')
        await expect(page.locator('.provider-connections')).toContainText('Could not open your browser')
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('GHTX-ABCD')
        await page.getByRole('button', { name: 'Copy code', exact: true }).click()
        expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('GHTX-ABCD')
        await app.evaluate(({ app }) => app.emit('gitorian-provider-browser-ready'))
        await page.getByRole('button', { name: 'Open GitHub', exact: true }).click()
        await shot('01-github-device-authorization')
        await expect(page.locator('.provider-account-row')).toContainText('@alex-work')
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                return state.accounts.find((a) => a.id === state.repositories[0].accountId)?.username
            })
            .toBe('alex-work')
        await app.evaluate(({ app }) => app.emit('gitorian-provider-user', 101))
        await page.getByRole('button', { name: 'Add GitHub account', exact: true }).click()
        await expect(page.locator('.provider-account-row').filter({ hasText: '@alex-personal' })).toBeVisible()
        await page.getByRole('button', { name: 'Add GitLab account', exact: true }).click()
        await expect(page.locator('.github-signin-code')).toHaveText('GLTX-WXYZ')
        await shot('02-gitlab-device-authorization')
        await expect(page.locator('.provider-account-row').filter({ hasText: '@alex-lab' })).toBeVisible()
        await expect(page.locator('.provider-account-row')).toHaveCount(3)
        await shot('03-connected-accounts')
    })
    await test.step('import repositories and automatically match author identity without widening filters', async () => {
        await page.getByRole('tab', { name: 'Repositories', exact: true }).click()
        await chooseFolder(folder)
        await page.getByRole('button', { name: 'Add repositories from folder', exact: true }).click()
        await page.getByRole('button', { name: 'Import 2 repositories', exact: true }).click()
        await expect
            .poll(
                async () =>
                    (await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.repositories.length
            )
            .toBe(3)
        // Refresh is an explicit fixture action; assignment itself runs through production modules.
        await page.evaluate(() => window.journal.invoke({ type: 'refresh' }))
        const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        const work = state.repositories.find((r) => r.name === 'work')!
        const lab = state.repositories.find((r) => r.name === 'lab')!
        const shared = state.repositories.find((r) => r.name === 'shared')!
        expect(state.accounts.find((a) => a.id === work.accountId)?.username).toBe('alex-work')
        expect(state.accounts.find((a) => a.id === lab.accountId)?.provider).toBe('gitlab')
        expect(shared.accountId).toBeUndefined()
        expect(work.emails).toEqual(['work@example.test'])
        await page.getByRole('button', { name: /shared/ }).click()
        await page.getByRole('combobox', { name: 'Account', exact: true }).click()
        await page.getByRole('option', { name: '@alex-work', exact: true }).click()
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                return state.repositories.find((r) => r.id === shared.id)?.assignment
            })
            .toBe('explicit')
        await shot('04-repository-account-matching')
        await page.getByRole('combobox', { name: 'Account', exact: true }).click()
        await page.getByRole('option', { name: 'Automatic matching', exact: true }).click()
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                return state.repositories.find((r) => r.id === shared.id)?.accountId ?? null
            })
            .toBeNull()
        writeFileSync(info.outputPath('assignments.json'), JSON.stringify(state.repositories, null, 2))
    })
    await test.step('GitLab contributions, review-only history, details and writing use the real desktop flow', async () => {
        await page.getByRole('button', { name: 'Save settings', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Dismiss setup', exact: true })).toHaveCount(0)
        await expect(page.locator('.hub-stats')).toBeVisible()
        expect((await page.evaluate(() => window.journal.invoke({ type: 'state' }))).connections.notion).toBe(false)
        await page.getByText('!1 Improve GitLab workflow', { exact: true }).first().click()
        await expect(page.getByRole('link', { name: 'View on GitLab' })).toBeVisible()
        await expect(
            page
                .getByRole('region', { name: 'Changed files', exact: true })
                .getByText('work.ts', { exact: true })
                .first()
        ).toBeVisible()
        await shot('05-gitlab-merge-request-details')
        await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
        await page.getByRole('tab', { name: 'Diff', exact: true }).click()
        await expect(page.locator('.ws-inspector')).toContainText('supported')
        const start = page.getByRole('button', { name: /Start this week/ })
        if (await start.isVisible()) await start.click()
        await page.getByRole('button', { name: 'Cite in entry', exact: true }).click()
        await expect
            .poll(async () =>
                JSON.stringify((await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.drafts)
            )
            .toContain('Improve GitLab workflow')
        const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        const request = state.activities.find((a) => a.kind === 'change-request' && a.remoteSource?.number === 1)!
        expect(
            state.activities.some(
                (a) =>
                    a.kind === 'review' &&
                    a.description === 'Please handle interrupted saves.' &&
                    a.date.startsWith('2026-10-28')
            )
        ).toBe(true)
        expect(state.activities.find((a) => a.sha === 'a'.repeat(40))?.changeRequestId).toBe(request.id)
        // Evidence pinning has a command interface; the citation above is the UI proof.
        await page.evaluate(
            ({ draftId, activityId }) => window.journal.invoke({ type: 'select', draftId, activityId, included: true }),
            { draftId: state.drafts[0].id, activityId: request.id }
        )
        await shot('06-gitlab-diff-and-journal-citation')
        await page.getByRole('button', { name: 'Hub', exact: true }).click()
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await page.getByRole('tab', { name: 'Connections', exact: true }).click()
    })
    await test.step('a held GitLab read cannot write evidence after its repository remote changes', async () => {
        const { state: before } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        const lab = before.repositories.find((r) => r.name === 'lab')!
        const request = before.activities.find(
            (a) => a.repositoryId === lab.id && a.kind === 'change-request' && a.remoteSource?.number === 1
        )!
        await app.evaluate(({ app }) => app.emit('gitorian-provider-hold-diff'))
        const capture = page.evaluate(
            async ({ draftId, activityId }) => {
                try {
                    await window.journal.invoke({ type: 'select', draftId, activityId, included: true })
                    return 'accepted'
                } catch {
                    return 'rejected'
                }
            },
            { draftId: before.drafts[0].id, activityId: request.id }
        )
        await expect
            .poll(() =>
                app.evaluate(({ app }) => {
                    const state = { held: false }
                    app.emit('gitorian-provider-read-state', state)
                    return state.held
                })
            )
            .toBe(true)
        // This command is fixture setup for the race; account selection has separate UI proof above.
        await page.evaluate((repository) => window.journal.invoke({ type: 'repository', repository }), {
            ...lab,
            remote: 'https://github.com/team/other.git'
        })
        await app.evaluate(({ app }) => app.emit('gitorian-provider-release-diff'))
        expect(await capture).toBe('rejected')
        const { state: changed } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(changed.revisions).toEqual(before.revisions)
        expect(changed.drafts[0].selections).toEqual(before.drafts[0].selections)
        expect(changed.activities.find((a) => a.kind === 'review' && a.repositoryId === lab.id)?.previousSource).toBe(
            true
        )
        await page.evaluate((repository) => window.journal.invoke({ type: 'repository', repository }), lab)
        await page.evaluate(
            ({ repositoryId, accountId }) => window.journal.invoke({ type: 'providerAssign', repositoryId, accountId }),
            { repositoryId: lab.id, accountId: lab.accountId! }
        )
        await page.evaluate(() => window.journal.invoke({ type: 'refresh' }))
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                return state.activities.find((a) => a.id === request.id)?.previousSource ?? false
            })
            .toBe(false)
        const { state: restored } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(
            restored.activities
                .filter((a) => a.repositoryId === lab.id)
                .map((a) => a.id)
                .sort()
        ).toEqual(
            before.activities
                .filter((a) => a.repositoryId === lab.id)
                .map((a) => a.id)
                .sort()
        )
    })
    await test.step('account list survives renderer reload and reconnect mismatch does not replace identity', async () => {
        await page.getByRole('button', { name: 'Save settings', exact: true }).click()
        ;({ page, app } = await desktop.restart())
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await page.getByRole('tab', { name: 'Connections', exact: true }).click()
        await expect(page.locator('.provider-account-row')).toHaveCount(3)
        const reopened = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(JSON.stringify(reopened.state.drafts)).toContain('Improve GitLab workflow')
        expect(reopened.state.drafts[0]?.selections).toHaveLength(1)
        await expect(page.getByRole('button', { name: 'Reconnect @alex-work', exact: true })).toHaveCount(0)
        const workAccount = page.locator('.provider-account-row').filter({ hasText: '@alex-work' })
        await app.evaluate(({ app }) => app.emit('gitorian-provider-reject-user', 102))
        await page.evaluate(() => window.journal.invoke({ type: 'refresh' }))
        // Direct IPC refresh does not update renderer state; allow the idle 15s poll plus its 2s tick.
        await expect(workAccount.getByRole('button', { name: 'Reconnect @alex-work', exact: true })).toBeVisible({
            timeout: 20000
        })
        await expect(workAccount.locator('.provider-account-status')).toHaveText('work@example.test')
        await app.evaluate(({ app }) => app.emit('gitorian-provider-reject-user', undefined))
        await app.evaluate(({ app }) => app.emit('gitorian-provider-user', 101))
        await page.getByRole('button', { name: 'Reconnect @alex-work', exact: true }).click()
        await expect(page.locator('.provider-connections')).toContainText('different account')
        await shot('05-wrong-account-reconnect-recovery')
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.locator('.provider-account-row')).toHaveCount(3)
        await app.evaluate(({ app }) => app.emit('gitorian-provider-user', 102))
        await page.getByRole('button', { name: 'Reconnect @alex-work', exact: true }).click()
        await expect(workAccount.getByRole('button', { name: 'Disconnect @alex-work', exact: true })).toBeVisible()
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await shot('06-accounts-narrow')
    await page.setViewportSize({ width: 1280, height: 900 })
    await test.step('disconnect only the named account while keeping cached journal evidence', async () => {
        const lab = page.locator('.provider-account-row').filter({ hasText: '@alex-lab' })
        await lab.getByRole('button', { name: 'Disconnect @alex-lab', exact: true }).click()
        await expect(lab).toContainText('Disconnect @alex-lab?')
        await shot('09-account-specific-disconnect')
        await lab.getByRole('button', { name: 'Disconnect', exact: true }).press('Space', { delay: 1200 })
        await expect(lab).toHaveCount(0)
        const { state, connections } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(connections.remote).toBe(true)
        expect(state.accounts.filter((a) => a.status === 'connected')).toHaveLength(2)
        expect(state.accounts.find((a) => a.username === 'alex-lab')?.status).toBe('disconnected')
        expect(state.drafts[0].selections).toHaveLength(1)
    })
    await test.step('keep explicitly disconnected accounts hidden after reload and reuse their identity when added again', async () => {
        const before = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        const retained = before.state.accounts.find((a) => a.username === 'alex-lab')!
        await page.reload()
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await page.getByRole('tab', { name: 'Connections', exact: true }).click()
        await expect(page.locator('.provider-account-row')).toHaveCount(2)
        await expect(page.getByRole('button', { name: 'Reconnect @alex-lab', exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'Add GitLab account', exact: true }).click()
        await expect(page.locator('.provider-account-row').filter({ hasText: '@alex-lab' })).toBeVisible()
        const after = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(after.state.accounts).toHaveLength(3)
        expect(after.state.accounts.find((a) => a.username === 'alex-lab')?.id).toBe(retained.id)
        expect(after.state.repositories.find((r) => r.name === 'lab')?.accountId).toBe(retained.id)
        expect(after.state.drafts[0].selections).toEqual(before.state.drafts[0].selections)
    })
    await desktop.close()
    const database = new DatabaseSync(join(profile, 'journal.sqlite'), { readOnly: true })
    try {
        expect(database.prepare('SELECT COUNT(*) AS count FROM provider_accounts').get()?.count).toBe(3)
        writeFileSync(
            info.outputPath('persisted-accounts.json'),
            JSON.stringify(database.prepare('SELECT id,identity FROM provider_accounts').all(), null, 2)
        )
    } finally {
        database.close()
    }
    const requests = JSON.parse(readFileSync(join(profile, 'provider-requests.json'), 'utf8')) as {
        host: string
        githubHeaders: boolean
    }[]
    expect(requests.filter((r) => r.host === 'gitlab.com').every((r) => !r.githubHeaders)).toBe(true)
    writeFileSync(info.outputPath('provider-requests.json'), JSON.stringify(requests, null, 2))
})
