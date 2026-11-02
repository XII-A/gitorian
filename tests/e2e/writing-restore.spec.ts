import { test, expect } from './support/desktop'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

test.use({ desktopEntry: 'tests/e2e/support/writing-restore-main.mjs' })
test.afterEach(async ({ desktop }) => {
    if (!desktop.page.isClosed())
        await desktop.app.evaluate(({ app }) => {
            app.emit('writing-restore-release', false)
        })
})
for (const fail of [false, true]) {
    test(`successful replacement fences old editors through ${fail ? 'failed' : 'delayed'} credential cleanup`, async ({
        desktop
    }) => {
        const { app, page } = desktop
        const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await body.fill('Writing from the backup')
        await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
        const backup = join(desktop.scratch, 'restore.json')
        await app.evaluate(({ dialog }, path) => {
            dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
        }, backup)
        await page.evaluate(() => window.journal.invoke({ type: 'export' }))
        await body.fill('Writing before replacement')
        await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
        const generation = await page.evaluate(
            async () => (await window.journal.invoke({ type: 'state' })).state.restoreId
        )
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'))
        try {
            db.prepare('INSERT INTO provider_credential_cleanup (key) VALUES (?)').run('fixture-restored-cleanup')
        } finally {
            db.close()
        }
        await desktop.chooseFolder(backup)
        await app.evaluate(({ app, dialog }) => {
            dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false })
            app.emit('writing-restore-hold')
        })
        // Start import without blocking observation of the post-commit cleanup gate.
        await page.evaluate(() => {
            void window.journal.invoke({ type: 'import' }).catch(() => {
                /* fixture failure is expected in one case */
            })
        })
        await expect
            .poll(() =>
                app.evaluate(({ app }) => {
                    const state = { held: false }
                    app.emit('writing-restore-state', state)
                    return state.held
                })
            )
            .toBe(true)
        await expect(body).not.toBeEditable()
        const beforeRelease = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            expect(String(beforeRelease.prepare('SELECT body FROM drafts').get()!.body)).toContain(
                'Writing from the backup'
            )
            expect(beforeRelease.prepare('SELECT generation FROM journal').get()!.generation).not.toBe(generation)
        } finally {
            beforeRelease.close()
        }
        await desktop.shot(fail ? '01-frozen-before-cleanup-failure' : '01-frozen-during-cleanup')
        const loaded = page.waitForEvent('load')
        await app.evaluate(({ app }, failed) => {
            app.emit('writing-restore-release', failed)
        }, fail)
        await loaded
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(body).toHaveText('Writing from the backup')
        await expect(body).toBeEditable()
        await body.press('Control+End')
        await body.pressSequentially(' and new-generation writing')
        await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    })
}
