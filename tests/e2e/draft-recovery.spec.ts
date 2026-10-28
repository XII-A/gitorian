import { test, expect } from './support/desktop'
import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

test('draft recovery: explicit confirmation, blocked dismissal, failure recovery and stale saves', async ({
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
    const dialog = page.getByRole('dialog', { name: 'Choose which writing to keep', exact: true })
    const savedChoice = dialog.getByRole('radio', { name: 'Saved writing', exact: true })
    const recoveryChoice = dialog.getByRole('radio', { name: 'Recovery copy', exact: true })
    const title = page.getByRole('textbox', { name: 'Entry title', exact: true, includeHidden: true })
    const stored = () =>
        page.evaluate(
            async (key) => ({
                draft: (await window.journal.invoke({ type: 'state' })).state.drafts[0],
                recovery: localStorage.getItem(key)
            }),
            fixture.key
        )

    await test.step('opening blocks dismissal and selection does not resolve the conflict', async () => {
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Close dialog' })).toHaveCount(0)
        await expect(dialog.getByRole('button', { name: 'Keep selected writing' })).toBeDisabled()
        await expect(title).toHaveJSProperty('readOnly', true)
        await page.keyboard.press('Escape')
        await page.mouse.click(8, 200)
        await expect(dialog).toBeVisible()
        await dialog.getByText('Saved writing', { exact: true }).click()
        await expect(dialog).toBeVisible()
        const before = await stored()
        expect(before.draft.title).toBe('Weekly release notes')
        expect(before.draft.version).toBe(fixture.savedVersion)
        expect(JSON.parse(before.recovery!)).toEqual(fixture.recovery)
        for (const direction of ['Tab', 'Shift+Tab']) {
            for (let index = 0; index < 4; index++) {
                await page.keyboard.press(direction)
                expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
            }
        }
        await desktop.shot('01-conflict-dialog')
        await dialog.screenshot({ path: info.outputPath('conflict-dialog.png') })
        for (const width of [1000, 768, 390]) {
            await desktop.app.evaluate(({ BrowserWindow }, width) => {
                const window = BrowserWindow.getAllWindows()[0]
                window.setMinimumSize(390, 600)
                window.setSize(width, 800)
            }, width)
            await expect(dialog).toBeInViewport({ ratio: 1 })
            await expect(dialog.getByRole('button', { name: 'Keep saved writing' })).toBeInViewport({ ratio: 1 })
        }
        await desktop.shot('02-narrow-conflict-dialog')
        await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800))
        await page.reload()
        await expect(dialog).toBeVisible()
        await expect(savedChoice).not.toBeChecked()
        await expect(recoveryChoice).not.toBeChecked()
        expect(JSON.parse((await stored()).recovery!)).toEqual(fixture.recovery)
    })

    await test.step('confirming saved writing preserves the database and clears recovery', async () => {
        await dialog.getByText('Saved writing', { exact: true }).click()
        await dialog.getByRole('button', { name: 'Keep saved writing', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(title).toBeEditable()
        await expect(title).toBeFocused()
        const retained = await stored()
        expect(retained.recovery).toBeNull()
        expect(retained.draft.version).toBe(fixture.savedVersion)
        expect(retained.draft.title).toBe('Weekly release notes')
        await page.reload()
        await expect(dialog).toHaveCount(0)
        await expect(title).toHaveValue('Weekly release notes')
    })

    await test.step('failed recovery save keeps both copies and retries in the dialog', async () => {
        await page.evaluate(({ key, recovery }) => localStorage.setItem(key, JSON.stringify(recovery)), fixture)
        await page.reload()
        await expect(dialog).toBeVisible()
        await dialog.getByText('Recovery copy', { exact: true }).click()
        expect((await stored()).draft.title).toBe('Weekly release notes')
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'))
        try {
            db.exec(
                "CREATE TRIGGER fail_draft_save BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'Fixture write failure'); END"
            )
            await dialog.getByRole('button', { name: 'Use recovery copy', exact: true }).click()
            await expect(dialog.getByRole('alert')).toContainText('Try again')
            await expect(dialog).toBeVisible()
            expect((await stored()).draft.title).toBe('Weekly release notes')
            expect(JSON.parse((await stored()).recovery!)).toEqual(fixture.recovery)
            await desktop.shot('03-failed-save')
            await page.keyboard.press('Escape')
            await expect(dialog).toBeVisible()
        } finally {
            db.exec('DROP TRIGGER IF EXISTS fail_draft_save')
            db.close()
        }
        await expect(dialog).toBeVisible()
        await expect(recoveryChoice).toBeChecked()
        await dialog.getByRole('button', { name: 'Use recovery copy', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(title).toHaveValue('Recovered release notes')
        expect((await stored()).draft.version).toBe(fixture.savedVersion + 1)
        expect((await stored()).recovery).toBeNull()
        await page.reload()
        await expect(title).toHaveValue('Recovered release notes')
        await expect(page.getByRole('textbox', { name: 'Journal body' })).toContainText('Recovery testing notes')
        await expect(dialog).toHaveCount(0)
    })

    await test.step('live stale save opens the same dialog and a second writer requires a new choice', async () => {
        const writeElsewhere = (text: string) =>
            page.evaluate(async (text) => {
                const { state } = await window.journal.invoke({ type: 'state' })
                await window.journal.invoke({ type: 'draft', draft: { ...state.drafts[0], title: text } })
            }, text)
        await writeElsewhere('Saved in another window')
        await title.fill('My unsaved live writing')
        await expect(dialog).toBeVisible()
        expect((await stored()).draft.title).toBe('Saved in another window')
        expect(JSON.parse((await stored()).recovery!).title).toBe('My unsaved live writing')
        await dialog.getByText('Recovery copy', { exact: true }).click()
        await writeElsewhere('Newer writing while choosing')
        await dialog.getByRole('button', { name: 'Use recovery copy', exact: true }).click()
        await expect(dialog.getByRole('alert')).toContainText('changed again')
        await expect(recoveryChoice).not.toBeChecked()
        expect((await stored()).draft.title).toBe('Newer writing while choosing')
        expect(JSON.parse((await stored()).recovery!).title).toBe('My unsaved live writing')
        await desktop.shot('04-live-conflict-changed-again')
        await savedChoice.focus()
        await page.keyboard.press('Space')
        const confirm = dialog.getByRole('button', { name: 'Keep saved writing', exact: true })
        await confirm.focus()
        await page.keyboard.press('Enter')
        await expect(dialog).toHaveCount(0)
        await expect(title).toHaveValue('Newer writing while choosing')
        await page.reload()
        await expect(title).toHaveValue('Newer writing while choosing')
        await expect(dialog).toHaveCount(0)
        expect((await stored()).recovery).toBeNull()
    })

    await test.step('independent post-exit SQLite retains the confirmed writing', async () => {
        const final = (await stored()).draft
        await desktop.close()
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            const row = db.prepare('SELECT title, body, version FROM drafts WHERE id = ?').get(final.id)!
            expect(row.title).toBe(final.title)
            expect(JSON.parse(String(row.body))).toEqual(final.body)
            expect(row.version).toBe(final.version)
            writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(row, null, 2))
        } finally {
            db.close()
        }
    })
})
