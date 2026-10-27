import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'
import type { JournalNode } from '../../src/shared/model'

test('checklists retain editable text, keyboard behavior and saved state', async ({ desktop }, info) => {
    const { page, profile, shot } = desktop
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    const items = body.locator('ul[data-type="taskList"] > li')
    const text = (index: number) => items.nth(index).locator(':scope > div > p').first()
    writeFileSync(
        info.outputPath('fixture.json'),
        JSON.stringify({ journalOnly: true, repositories: [], providers: [] })
    )

    await test.step('start a real draft and insert a checklist with the pointer formatter', async () => {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await body.click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('/checklist')
        await page.getByRole('option', { name: 'Checklist', exact: true }).click()
        await shot('01-inserted-empty-checklist')
        writeFileSync(
            info.outputPath('inserted-dom.json'),
            JSON.stringify(
                await body.evaluate((element) => ({
                    html: element.innerHTML,
                    selection: window.getSelection()?.anchorNode?.parentElement?.outerHTML
                })),
                null,
                2
            )
        )
        await page.keyboard.type('First task')
        await expect(text(0)).toHaveText('First task')
        await expect(items).toHaveCount(1)
        const checkbox = await items.nth(0).getByRole('checkbox').boundingBox()
        const paragraph = await text(0).boundingBox()
        expect(checkbox).not.toBeNull()
        expect(paragraph).not.toBeNull()
        expect(paragraph!.x).toBeGreaterThan(checkbox!.x + checkbox!.width)
        expect(checkbox!.y + checkbox!.height / 2).toBeGreaterThanOrEqual(paragraph!.y)
        expect(checkbox!.y + checkbox!.height / 2).toBeLessThanOrEqual(paragraph!.y + paragraph!.height)
        await shot('02-immediate-typing')
    })

    await test.step('Enter continues; an empty text area accepts a real pointer and Backspace edits text', async () => {
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(2)
        await expect(text(1)).toBeEmpty()
        await page.getByRole('textbox', { name: 'Entry title', exact: true }).click()
        await text(1).click({ position: { x: 60, y: 8 } })
        await page.keyboard.type('Second task!')
        await page.keyboard.press('Backspace')
        await expect(text(1)).toHaveText('Second task')
        await expect(items).toHaveCount(2)
        await items.nth(0).getByRole('checkbox').check()
        await shot('03-click-type-backspace-and-toggle')
        await text(1).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(3)
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(2)
        await page.keyboard.type('Outside checklist')
        await expect(body.locator(':scope > p').filter({ hasText: 'Outside checklist' })).toHaveText(
            'Outside checklist'
        )
        await shot('04-empty-enter-exits')
    })

    await test.step('keyboard formatter and task shortcut recover from Backspace at an empty item start', async () => {
        await page.keyboard.press('Enter')
        await page.keyboard.type('/checklist')
        await page.keyboard.press('Enter')
        await expect(items).toHaveCount(3)
        await page.keyboard.press('Backspace')
        await expect(items).toHaveCount(2)
        await page.keyboard.type('Recovered paragraph')
        await expect(body.locator(':scope > p').filter({ hasText: 'Recovered paragraph' })).toHaveText(
            'Recovered paragraph'
        )
        await page.keyboard.press('Enter')
        await page.keyboard.type('[ ] ')
        await page.keyboard.type('Markdown task')
        await expect(items).toHaveCount(3)
        await expect(text(2)).toHaveText('Markdown task')
        await page.keyboard.press('Home')
        await page.keyboard.press('Backspace')
        await expect(items).toHaveCount(2)
        await expect(body.locator(':scope > p').filter({ hasText: 'Markdown task' })).toHaveText('Markdown task')
        await page.keyboard.press('ControlOrMeta+z')
        await expect(items).toHaveCount(3)
        await expect(text(2)).toHaveText('Markdown task')
        await shot('05-backspace-and-undo-recovery')
    })

    let saved: JournalNode
    await test.step('autosave and renderer reload preserve task text and checked state', async () => {
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                saved = state.drafts[0].body
                return JSON.stringify(saved)
            })
            .toContain('Markdown task')
        writeFileSync(info.outputPath('saved-body.json'), JSON.stringify(saved!, null, 2))
        await page.reload()
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(text(0)).toHaveText('First task')
        await expect(text(1)).toHaveText('Second task')
        await expect(text(2)).toHaveText('Markdown task')
        await expect(items.nth(0).getByRole('checkbox')).toBeChecked()
        await expect(items.nth(1).getByRole('checkbox')).not.toBeChecked()
        await shot('06-reloaded-checklist')
    })

    await test.step('independent post-exit SQLite matches the saved document', async () => {
        await desktop.close()
        const db = new DatabaseSync(join(profile, 'journal.sqlite'), { readOnly: true })
        try {
            const rows = db
                .prepare(
                    "SELECT json_object('id',id,'title',title,'body',json(body),'week',week,'version',version,'updatedAt',updatedAt) AS json FROM drafts"
                )
                .all()
            const drafts = rows.map((row) => JSON.parse(String(row.json)) as { body: JournalNode })
            writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(drafts, null, 2))
            expect(drafts).toHaveLength(1)
            expect(drafts[0].body).toEqual(saved!)
        } finally {
            db.close()
        }
    })
})
