import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/history-main.mjs' })
test('local and published history: pagination, search, exact-week editing and persistence', async ({
    desktop
}, info) => {
    const { page, app } = desktop
    const getReadCount = () =>
        app.evaluate(({ app }) => {
            const state = { reads: 0 }
            app.emit('history-entry-stats', state)
            return state.reads
        })
    const reads = await page.evaluate(async () => {
        const { state } = await window.journal.invoke({ type: 'state' })
        const samples = []
        for (let index = 0; index < 5; index++) {
            const started = performance.now()
            const reply = await window.journal.readEntry('notion:entry-00', state.restoreId)
            samples.push({
                milliseconds: performance.now() - started,
                bytes: new TextEncoder().encode(JSON.stringify(reply)).length,
                includesWorkspace: !!reply && 'state' in reply
            })
        }
        return samples
    })
    writeFileSync(info.outputPath('entry-reads.json'), JSON.stringify(reads, null, 2))
    expect(reads.every((read) => !read.includesWorkspace)).toBe(true)
    await expect(page.evaluate(() => window.journal.readEntry('notion:entry-00', 'old-generation'))).rejects.toThrow(
        /journal changed/i
    )
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(56)
    await desktop.shot('01-paginated-history')
    await app.evaluate(({ app }) => app.emit('history-hold-search'))
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('unique archived lesson')
    await expect(page.getByRole('status', { name: 'Searching entries', exact: true })).toBeVisible()
    await desktop.shot('02-search-spinner')
    await app.evaluate(({ app }) => app.emit('history-release-search'))
    await expect(page.locator('.history-row')).toHaveCount(1)
    const beforeColdRead = await getReadCount()
    await app.evaluate(({ app }) => app.emit('history-hold-entry'))
    await page.locator('.history-row').hover()
    await page.locator('.history-row').click()
    await expect(page.getByRole('status', { name: 'Loading entry', exact: true })).toBeVisible()
    await expect(page.locator('.history-article h2')).toHaveText('Archive entry 0')
    expect(await getReadCount()).toBe(beforeColdRead + 1)
    await page.locator('.history-entry-dialog').evaluate(async (node) => {
        await Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
    })
    await desktop.shot('02-entry-skeleton')
    await app.evaluate(({ app }) => app.emit('history-release-entry'))
    await expect(page.locator('.history-article')).toContainText('A unique archived lesson.')
    await desktop.shot('02-archived-document')
    await page.getByRole('button', { name: 'Close entry', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.history-row')).toBeFocused()
    await expect(page.locator('.history-entry-dialog')).toHaveCount(0)
    await desktop.shot('02-reader-closed')
    const readCount = await getReadCount()
    await page.keyboard.press('Enter')
    await expect(page.locator('.history-article')).toContainText('A unique archived lesson.')
    await expect(page.getByRole('status', { name: 'Loading entry', exact: true })).toHaveCount(0)
    expect(await getReadCount()).toBe(readCount)
    await page.keyboard.press('Escape')
    await expect(page.locator('.history-row')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.history-entry-dialog')).toHaveCount(0)
    await expect(page.locator('.history-row')).toBeFocused()
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(50)
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('unique local lesson')
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page.locator('.history-row').click()
    await expect(page.locator('.history-article')).toContainText('A unique local lesson.')
    await desktop.shot('02-local-reader-actions')
    const originalWindow = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const size = window.getContentSize()
        const minimum = window.getMinimumSize()
        window.setMinimumSize(320, 400)
        window.setContentSize(390, 900)
        return { size, minimum }
    })
    await page.locator('.history-entry-dialog').evaluate(async (node) => {
        await Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
    })
    await desktop.shot('02-reader-actions-narrow')
    await app.evaluate(({ BrowserWindow }, original) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(original.minimum[0], original.minimum[1])
        window.setContentSize(original.size[0], original.size[1])
    }, originalWindow)

    const actions = page.getByRole('toolbar', { name: 'Entry actions', exact: true })
    await actions.getByRole('button', { name: 'Edit', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(actions.getByRole('button', { name: 'Open in Notion', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect
        .poll(() =>
            app.evaluate(({ app }) => {
                const state = { opened: [] as string[] }
                app.emit('history-entry-stats', state)
                return state.opened
            })
        )
        .toEqual(['https://example.invalid/'])
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    const title = page.getByRole('textbox', { name: 'Entry title', exact: true })
    await expect(title).toHaveValue('Local autosaved entry')
    await expect(page.getByRole('button', { name: /Publish|Set up Notion publishing|Connect Notion/ })).toHaveCount(0)
    await expect(page.locator('.ws-writing-footer')).not.toContainText('Connect Notion')
    await title.fill('Edited older local entry')
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await desktop.shot('03-local-autosave')
    await page.reload()
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('Edited older local entry')
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page.locator('.history-row').click()
    await page
        .getByRole('toolbar', { name: 'Entry actions', exact: true })
        .getByRole('button', { name: 'Edit', exact: true })
        .click()
    await expect(title).toHaveValue('Edited older local entry')
    await page.getByRole('button', { name: 'Hub', exact: true }).click()
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('unpublished local lesson')
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page.locator('.history-row').click()
    await expect(page.locator('.history-article')).toContainText('A unique unpublished local lesson.')
    await expect(page.getByRole('toolbar', { name: 'Entry actions', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open in Notion', exact: true })).toHaveCount(0)
    await page.locator('.history-entry-dialog').evaluate(async (node) => {
        await Promise.allSettled(node.getAnimations().map((animation) => animation.finished))
    })
    await desktop.shot('04-local-only-edit-button')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(title).toHaveValue('Local-only entry')
    await desktop.close()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const count = db.prepare('SELECT count(*) AS total FROM entries').get()
        expect(count?.total).toBe(55)
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(db.prepare('SELECT week, title FROM drafts ORDER BY week').all()).toEqual([
            { week: '2020-01-06', title: 'Edited older local entry' },
            { week: '2020-01-13', title: 'Local-only entry' }
        ])
        writeFileSync(info.outputPath('persisted-history.json'), JSON.stringify(count))
    } finally {
        db.close()
    }
})
