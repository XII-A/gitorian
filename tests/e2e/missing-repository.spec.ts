import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'

test('missing repository: quiet pause, locate, hold confirmation and durable stop tracking', async ({
    desktop
}, info) => {
    const { page, scratch, chooseFolder, shot } = desktop
    const original = join(scratch, 'journal-tools')
    const moved = join(scratch, 'moved-journal-tools')
    const move = (from: string, to: string) => {
        for (const path of [from, to]) {
            const child = relative(scratch, path)
            if (!child || child.startsWith('..')) throw new Error('Move must stay inside the owned fixture')
        }
        renameSync(from, to)
    }
    mkdirSync(original)
    for (const args of [
        ['init', '-b', 'main'],
        ['config', 'user.name', 'Journal author'],
        ['config', 'user.email', 'journal@example.com']
    ])
        execFileSync('git', args, { cwd: original, windowsHide: true })
    writeFileSync(join(original, 'notes.txt'), 'Local activity\n')
    for (const args of [
        ['add', '.'],
        ['commit', '-m', 'Keep collected activity']
    ])
        execFileSync('git', args, { cwd: original, windowsHide: true })
    await chooseFolder(original)
    const fixture = await page.evaluate(async () => {
        const reply = await window.journal.invoke({ type: 'addRepository' })
        await window.journal.invoke({ type: 'settings', settings: { ...reply.state.settings, refreshMinutes: 0 } })
        const since = reply.state.repositories[0].trackingStart
        const collected = await window.journal.invoke({ type: 'refresh', source: 'git', since })
        return { repository: collected.state.repositories[0], count: collected.state.activities.length, since }
    })
    expect(fixture.count).toBeGreaterThan(0)
    const url = new URL(page.url())
    url.search = `?workspace=true&week=${fixture.since}`
    await page.goto(url.href)
    const state = () => page.evaluate(async () => (await window.journal.invoke({ type: 'state' })).state)
    const refresh = async () => {
        await page.getByRole('button', { name: 'Refresh activity', exact: true }).click()
        await expect
            .poll(async () => (await state()).acquisition?.[`git:${fixture.repository.id}`].pauseReason)
            .toBe('folder')
    }
    const sources = page.getByRole('button', { name: 'Activity sources', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Activity sources', exact: true })

    await test.step('missing folder is actionable once, without repeated refresh errors', async () => {
        move(original, moved)
        await refresh()
        await expect(page.getByText('1 source needs attention', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
        await refresh()
        await expect(page.getByText('1 source needs attention', { exact: true })).toHaveCount(0)
        await sources.click()
        await expect(dialog.getByText(/Local Git.*Folder not found/)).toBeVisible()
        await expect(dialog.getByText(fixture.repository.path, { exact: true })).toBeVisible()
        await shot('01-missing-folder-desktop')
        await page.setViewportSize({ width: 390, height: 844 })
        await shot('02-missing-folder-narrow')
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await page.setViewportSize({ width: 1200, height: 850 })
        await desktop.app.evaluate(({ dialog }) => {
            dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] })
        })
        await dialog.getByRole('button', { name: 'Locate folder', exact: true }).click()
        await expect(dialog.getByText(/Local Git.*Folder not found/)).toBeVisible()
    })
    await test.step('returning folder resumes; locate also resumes a moved repository', async () => {
        await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
        move(moved, original)
        await page.getByRole('button', { name: 'Refresh activity', exact: true }).click()
        await expect.poll(async () => (await state()).repositories[0].available).toBe(true)
        await expect(sources).toHaveCount(0)
        move(original, moved)
        await refresh()
        await sources.click()
        await page.waitForTimeout(400)
        await shot('03a-locate-folder-before')
        await chooseFolder(moved)
        await dialog.getByRole('button', { name: 'Locate folder', exact: true }).click()
        await expect.poll(async () => (await state()).repositories[0].path).toBe(realpathSync(moved))
        await expect.poll(async () => (await state()).repositories[0].available).toBe(true)
        await expect.poll(async () => (await state()).acquisition?.[`git:${fixture.repository.id}`].status).toBe('idle')
        await expect(dialog.getByText(/Local Git.*Folder not found/)).toHaveCount(0)
        await expect(dialog.getByText('Everything is up to date', { exact: true })).toBeVisible()
        await page.waitForTimeout(400)
        await shot('03-folder-located')
        await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    })
    await test.step('stop tracking can be cancelled, requires a hold and resolves without leftover actions', async () => {
        move(moved, original)
        await refresh()
        await sources.click()
        const stop = dialog.getByRole('button', { name: 'Stop tracking', exact: true })
        const hold = dialog.getByRole('button', { name: 'Confirm', exact: true })
        const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
        await stop.click()
        await expect(hold).toBeFocused()
        await cancel.click()
        await expect(stop).toBeVisible()
        expect((await state()).repositories[0].removed).toBe(false)
        await stop.click()
        await expect(hold).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeVisible()
        await expect(stop).toBeFocused()
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await stop.click()
        await expect(hold).toBeFocused()
        await page.keyboard.down('Space')
        await page.waitForTimeout(250)
        await page.keyboard.up('Space')
        expect((await state()).repositories[0].removed).toBe(false)
        await page.waitForTimeout(400)
        await expect(hold).toBeInViewport({ ratio: 1 })
        await expect(cancel).toBeInViewport({ ratio: 1 })
        await shot('04a-hold-confirmation-narrow')
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await cancel.click()
        await page.setViewportSize({ width: 1200, height: 850 })
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await stop.click()
        await expect(hold).toBeVisible()
        await page.waitForTimeout(400)
        await shot('04b-hold-confirmation')
        const confirmationControl = dialog.getByRole('group', { name: 'Stop tracking', exact: true })
        await confirmationControl.screenshot({ path: info.outputPath('04b-confirmation-control.png') })
        const bounds = await hold.boundingBox()
        if (!bounds) throw new Error('Hold control must be visible')
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(450)
        await shot('04c-holding-to-stop')
        await confirmationControl.screenshot({ path: info.outputPath('04c-holding-control.png') })
        await expect.poll(async () => (await state()).repositories[0].removed).toBe(true)
        await page.mouse.up()
        const row = dialog.getByRole('article', { name: 'journal-tools / Local Git', exact: true })
        await expect(row.getByText(/Local Git.*Tracking stopped/)).toBeVisible()
        await expect(row.getByRole('img', { name: 'Tracking stopped', exact: true })).toBeVisible()
        await expect(dialog.getByRole('progressbar', { name: 'Sources resolved', exact: true })).toHaveAttribute(
            'aria-valuenow',
            '1'
        )
        await expect(dialog.getByText('All issues resolved', { exact: true })).toBeVisible()
        await expect(row).toBeFocused()
        await expect(row.getByRole('button')).toHaveCount(0)
        await expect(row.getByText((await state()).repositories[0].path, { exact: true })).toHaveCount(0)
        await expect(sources).toHaveCount(0)
        expect((await state()).activities.length).toBe(fixture.count)
        await shot('04d-tracking-stopped-clean')
        await page.setViewportSize({ width: 390, height: 844 })
        await shot('04a-stopped-tracking-narrow')
        await page.setViewportSize({ width: 1200, height: 850 })
        // A Settings-style reactivation in the same dialog must start a fresh hold workflow.
        await page.evaluate(async () => {
            const { state } = await window.journal.invoke({ type: 'state' })
            await window.journal.invoke({
                type: 'repository',
                repository: { ...state.repositories[0], removed: false }
            })
        })
        await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
        await page.getByTitle('Refresh activity', { exact: true }).click()
        await sources.click()
        await expect(stop).toBeVisible()
        await stop.click()
        await expect(hold).toBeFocused()
        await page.keyboard.down('Space')
        await expect.poll(async () => (await state()).repositories[0].removed).toBe(true)
        await page.keyboard.up('Space')
        await expect(row).toBeFocused()
        await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
        url.search = ''
        await page.goto(url.href)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Stopped repositories', exact: true })).toHaveAttribute(
            'aria-expanded',
            'false'
        )
        await page.getByRole('button', { name: 'Stopped repositories', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Stopped repositories', exact: true })).toHaveAttribute(
            'aria-expanded',
            'true'
        )
        await expect(page.getByText('journal-tools', { exact: true })).toBeVisible()
        // Screenshot evidence should show the settled disclosure, not its first measured frame.
        await page.waitForTimeout(600)
        await shot('05-stopped-repositories-settings')
        const restarted = await desktop.restart()
        expect(
            (await restarted.page.evaluate(async () => (await window.journal.invoke({ type: 'state' })).state))
                .repositories[0].removed
        ).toBe(true)
        await desktop.close()
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            const repositories = db.prepare('SELECT id, removed FROM repositories').all()
            writeFileSync(info.outputPath('persisted-repositories.json'), JSON.stringify(repositories, null, 2))
            expect(repositories).toEqual([{ id: fixture.repository.id, removed: 1 }])
            expect(db.prepare('SELECT count(*) AS count FROM activities').get()?.count).toBe(fixture.count)
        } finally {
            db.close()
        }
    })
})
