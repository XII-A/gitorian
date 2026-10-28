import { test, expect } from './support/desktop'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

test.use({ desktopEntry: 'tests/e2e/support/workspace-errors-main.mjs' })
test('workspace refresh rejection and toast recovery', async ({ desktop }, info) => {
    const { page, app } = desktop
    const repo = join(desktop.scratch, 'error-audit')
    mkdirSync(repo)
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Audit'],
        ['config', 'user.email', 'audit@example.com']
    ])
        execFileSync('git', args, { cwd: repo, windowsHide: true })
    writeFileSync(join(repo, 'example.txt'), 'audit\n')
    for (const args of [
        ['add', '.'],
        ['commit', '-m', 'Workspace error example']
    ])
        execFileSync('git', args, { cwd: repo, windowsHide: true })
    await desktop.chooseFolder(repo)
    await page.evaluate(async () => {
        await window.journal.invoke({ type: 'addRepository' })
        await window.journal.invoke({ type: 'refresh' })
    })
    await expect
        .poll(() => page.evaluate(async () => (await window.journal.invoke({ type: 'state' })).state.activities.length))
        .toBeGreaterThan(0)
    const fixture = await page.evaluate(async () => {
        const { state } = await window.journal.invoke({ type: 'state' })
        return { week: state.activityPage!.since, activity: state.activities[0].id }
    })
    writeFileSync(
        info.outputPath('fixture.json'),
        JSON.stringify(
            { ...fixture, failures: 'IPC command rejection at existing Electron seam; real renderer/Git/store' },
            null,
            2
        )
    )
    const url = new URL(page.url())
    url.search = `?workspace=true&week=${fixture.week}`
    await page.goto(url.href)
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', 'refresh')
    })
    await page.getByRole('button', { name: 'Refresh activity', exact: true }).click()
    await expect(page.getByText('Could not refresh activity', { exact: true })).toBeVisible()
    await expect(page.getByText('Activity could not be refreshed', { exact: true })).toHaveCount(0)
    await desktop.shot('01-refresh-error-toast')
    await page.getByRole('button', { name: 'Retry refresh', exact: true }).click()
    await expect(page.getByText('Could not refresh activity', { exact: true })).toHaveCount(1)
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', '')
    })
    await page.getByRole('button', { name: 'Retry refresh', exact: true }).click()
    await expect(page.getByText('Could not refresh activity', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Workspace error example', { exact: true })).toBeVisible()
    await desktop.shot('02-refresh-recovered')
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', 'details')
    })
    await page.getByText('Workspace error example', { exact: true }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    await expect(page.getByText("Changes couldn't be loaded", { exact: true })).toBeVisible()
    await expect(page.getByText('Could not complete action', { exact: true })).toHaveCount(0)
    await desktop.shot('03-inspector-error-stays-inline')
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', 'view')
    })
    await page.goto(url.href)
    await expect(page.getByText('Could not complete action', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Retry refresh', exact: true })).toHaveCount(0)
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', '')
    })
    await page.getByRole('button', { name: 'Retry action', exact: true }).click()
    await expect(page.getByText('Could not complete action', { exact: true })).toHaveCount(0)
})
