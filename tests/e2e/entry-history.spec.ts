import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/history-main.mjs' })
test('local and published history: pagination, search, exact-week editing and persistence', async ({
    desktop
}, info) => {
    const { page, app } = desktop
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(55)
    await desktop.shot('01-paginated-history')
    await app.evaluate(({ app }) => app.emit('history-hold-search'))
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('unique archived lesson')
    await expect(page.getByRole('status', { name: 'Searching entries', exact: true })).toBeVisible()
    await desktop.shot('02-search-spinner')
    await app.evaluate(({ app }) => app.emit('history-release-search'))
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page.locator('.history-row').click()
    await expect(page.locator('.history-article')).toContainText('A unique archived lesson.')
    await desktop.shot('02-archived-document')
    await page.getByRole('button', { name: 'Close entry', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.history-row')).toBeFocused()
    await expect(page.locator('.history-entry-dialog')).toHaveCount(0)
    await desktop.shot('02-reader-closed')
    await page.keyboard.press('Enter')
    await expect(page.locator('.history-article')).toBeVisible()
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
    await page
        .getByRole('group', { name: 'Entry actions', exact: true })
        .getByRole('button', { name: 'Edit', exact: true })
        .click()
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
        .getByRole('group', { name: 'Entry actions', exact: true })
        .getByRole('button', { name: 'Edit', exact: true })
        .click()
    await expect(title).toHaveValue('Edited older local entry')
    await desktop.close()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const count = db.prepare('SELECT count(*) AS total FROM entries').get()
        expect(count?.total).toBe(55)
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        expect(db.prepare('SELECT week, title FROM drafts').all()).toEqual([
            { week: '2020-01-06', title: 'Edited older local entry' }
        ])
        writeFileSync(info.outputPath('persisted-history.json'), JSON.stringify(count))
    } finally {
        db.close()
    }
})
