import { test, expect } from './support/desktop'
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

test('legacy recovery: explicit discard or append preserves shared writing through storage failure', async ({
    desktop
}, info) => {
    const { page } = desktop
    const fixture = await page.evaluate(async () => {
        const week = (await window.journal.invoke({ type: 'state' })).state.activityPage!.since
        const created = await window.journal.invoke({ type: 'newDraft', week })
        const original = created.state.drafts.find((draft) => draft.week === week)!
        const saved = await window.journal.invoke({
            type: 'draft',
            draft: { ...original, title: 'Weekly release notes' }
        })
        const recovery = {
            ...original,
            title: 'Recovered release notes',
            body: {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Recovery testing notes from before the app closed.' }]
                    }
                ]
            },
            updatedAt: new Date().toISOString()
        }
        const key = `gitorian:recovery:${saved.state.restoreId}:${week}`
        localStorage.setItem(key, JSON.stringify(recovery))
        return { week, key, recovery, savedVersion: saved.draftSaved!.version }
    })
    writeFileSync(
        info.outputPath('fixture.json'),
        JSON.stringify(
            {
                ...fixture,
                setup: 'Journal-only disposable profile; older synthetic recovery copy and real newer database save. SQLite trigger simulates a failed write.'
            },
            null,
            2
        )
    )
    const url = new URL(page.url())
    url.search = `?workspace=true&week=${fixture.week}`
    await page.goto(url.href)
    const dialog = page.getByRole('dialog', { name: 'Recover previous writing', exact: true })
    const title = page.getByRole('textbox', { name: 'Entry title', exact: true })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await desktop.shot('01-legacy-recovery-choice')
    await dialog.getByRole('button', { name: 'Discard recovery copy' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(title).toHaveText('Weekly release notes')
    await page.evaluate(({ key, recovery }) => localStorage.setItem(key, JSON.stringify(recovery)), fixture)
    await page.reload()
    await expect(dialog).toBeVisible()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'))
    try {
        db.exec(
            "CREATE TRIGGER fail_draft_save BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'Fixture write failure'); END"
        )
        await dialog.getByRole('button', { name: 'Append recovery writing' }).click()
        await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible()
        // The legacy copy has moved into a dependency-complete pending session record.
        expect(
            await page.evaluate(() =>
                Object.values(localStorage).some((value) => value.includes('Recovery testing notes'))
            )
        ).toBe(true)
        await desktop.shot('02-pending-recovered-writing')
    } finally {
        db.exec('DROP TRIGGER IF EXISTS fail_draft_save')
        db.close()
    }
    await page.getByRole('button', { name: 'Retry saving', exact: true }).click()
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await page.reload()
    await expect(dialog).toHaveCount(0)
    await expect(title).toHaveText('Weekly release notes')
    await expect(page.getByRole('textbox', { name: 'Journal body', exact: true })).toContainText(
        'Recovery testing notes'
    )
    await desktop.close()
    const persisted = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const row = persisted.prepare('SELECT title,body FROM drafts').get()!
        expect(row.title).toBe('Weekly release notes')
        expect(String(row.body)).toContain('Recovery testing notes')
        writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(row, null, 2))
    } finally {
        persisted.close()
    }
})
