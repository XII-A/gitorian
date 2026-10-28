import { test, expect } from './support/desktop'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

test.use({ desktopEntry: 'tests/e2e/support/workspace-errors-main.mjs' })
test('failed autosave offers one retry toast and preserves writing', async ({ desktop }, info) => {
    const { page, app } = desktop
    const title = 'Writing that could not be saved'
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Entry title', exact: true })
    await expect(input).toBeVisible()
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', 'draft')
    })
    await input.fill(title)
    const error = page.getByText('Could not save writing', { exact: true })
    await expect(error).toBeVisible()
    await expect(page.locator('.ws-writing-footer')).not.toContainText('Could not')
    await expect(page.locator('.ws-writing-footer').getByRole('button', { name: 'Retry saving' })).toHaveCount(0)
    await desktop.shot('01-save-failure-toast')
    await input.fill(title + '.')
    await expect
        .poll(() =>
            page.evaluate(() => Object.values(localStorage).some((v) => v.includes('Writing that could not be saved.')))
        )
        .toBe(true)
    await expect(error).toHaveCount(1)
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click()
    await expect(error).toBeVisible()
    await app.evaluate(({ app }) => {
        app.emit('workspace-error-fixture', '')
    })
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click()
    await expect(error).toHaveCount(0)
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await desktop.shot('02-retry-saved')
    await page.reload()
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(input).toHaveValue(title + '.')
    await desktop.shot('03-reloaded-writing')
    await desktop.close()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const rows = db.prepare('SELECT title, version FROM drafts').all()
        writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(rows, null, 2))
        expect(rows).toHaveLength(1)
        expect(rows[0].title).toBe(title + '.')
    } finally {
        db.close()
    }
})
