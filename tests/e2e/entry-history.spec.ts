import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/history-main.mjs' })
test('published history: old unlinked entries, pagination, body search and reader', async ({ desktop }, info) => {
    const { page } = desktop
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(50)
    await page.getByRole('button', { name: 'Load more entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(55)
    await desktop.shot('01-paginated-history')
    await page.getByRole('searchbox', { name: 'Search entries', exact: true }).fill('unique archived lesson')
    await expect(page.locator('.history-row')).toHaveCount(1)
    await page.locator('.history-row').click()
    await expect(page.locator('.history-article')).toContainText('A unique archived lesson.')
    await desktop.shot('02-archived-document')
    await page.getByRole('button', { name: 'Close entry', exact: true }).click()
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await expect(page.locator('.history-row')).toHaveCount(50)
    await desktop.close()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const count = db.prepare('SELECT count(*) AS total FROM entries').get()
        expect(count?.total).toBe(55)
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        writeFileSync(info.outputPath('persisted-history.json'), JSON.stringify(count))
    } finally {
        db.close()
    }
})
