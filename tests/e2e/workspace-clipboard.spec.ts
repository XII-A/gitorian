import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'

test('workspace clipboard: native rich text, title, keyboard, read-only and persistence', async ({ desktop }, info) => {
    const { page, app, shot } = desktop
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    const title = page.getByRole('textbox', { name: 'Entry title', exact: true })
    const menu = page.getByRole('menu', { name: 'Clipboard actions' })
    const item = (name: string) => menu.getByRole('menuitem', { name, exact: true })
    const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())

    await test.step('start a real journal-only draft and keep primary clicks available', async () => {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(body).toBeEditable()
        await body.click()
        await body.press('Control+A')
        await body.press('Backspace')
        await body.press('Control+B')
        await body.pressSequentially('Clipboard sentence')
        await body.press('Control+B')
        await expect(menu).toHaveCount(0)
        await body.press('Control+A')
        await body.click({ button: 'right' })
        await expect(item('Copy')).toBeEnabled()
        await expect(item('Cut')).toBeEnabled()
        await shot('01-selected-text-menu')
        await item('Copy').click()
        await expect.poll(clipboardText).toBe('Clipboard sentence')
        await expect(body).toBeFocused()
    })
    await test.step('cut and paste preserve rich text and native undo', async () => {
        await body.click({ button: 'right' })
        await item('Cut').click()
        await expect(body).not.toContainText('Clipboard sentence')
        await body.press('Control+Z')
        await expect(body).toContainText('Clipboard sentence')
        await body.press('Control+End')
        await body.press('Enter')
        await body.click({ button: 'right' })
        await expect(item('Cut')).toBeDisabled()
        await expect(item('Copy')).toBeDisabled()
        await item('Paste').click()
        await expect(body.locator('strong')).toHaveCount(2)
        await expect(body).toHaveText('Clipboard sentenceClipboard sentence')
        await shot('02-rich-text-pasted')
    })
    await test.step('title selection survives menu focus and keyboard dismissal', async () => {
        await title.fill('Weekly clipboard title')
        await title.press('Control+A')
        await title.click({ button: 'right' })
        await item('Cut').click()
        await expect(title).toHaveValue('')
        await expect.poll(clipboardText).toBe('Weekly clipboard title')
        await title.press('Shift+F10')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(title).toBeFocused()
        await title.press('Shift+F10')
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await expect(title).toHaveValue('Weekly clipboard title')
        await expect(title).toBeFocused()
    })
    await test.step('read-only workspace text offers only copy, and outside press dismisses', async () => {
        const heading = page.getByRole('heading', { name: 'Activity', exact: true })
        await heading.dblclick()
        await heading.click({ button: 'right' })
        await expect(item('Cut')).toBeDisabled()
        await expect(item('Paste')).toBeDisabled()
        await expect(item('Copy')).toBeEnabled()
        await shot('03-read-only-menu')
        await item('Copy').click()
        await expect.poll(clipboardText).toContain('Activity')
        await heading.click({ button: 'right' })
        await title.click()
        await expect(menu).toHaveCount(0)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await title.press('Shift+F10')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
    })
    await test.step('autosave survives reload and independent post-exit storage read', async () => {
        await expect
            .poll(async () => {
                const reply = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                return reply.state.drafts[0]?.title
            })
            .toBe('Weekly clipboard title')
        await page.reload()
        // Reopen if navigation returns to the hub after reload.
        if (await page.getByRole('button', { name: 'Open journal', exact: true }).isVisible())
            await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(title).toHaveValue('Weekly clipboard title')
        await expect(body.locator('strong')).toHaveCount(2)
        await shot('04-reloaded-draft')
        await desktop.close()
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            const rows = db
                .prepare(
                    "SELECT json_object('id',id,'title',title,'body',json(body),'week',week,'version',version,'updatedAt',updatedAt) AS json FROM drafts"
                )
                .all()
            writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(rows, null, 2))
            expect(rows).toHaveLength(1)
            const saved = JSON.parse(String(rows[0].json))
            expect(saved.title).toBe('Weekly clipboard title')
            expect(JSON.stringify(saved.body).match(/Clipboard sentence/g)).toHaveLength(2)
        } finally {
            db.close()
        }
    })
})
