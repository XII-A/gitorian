import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'
import type { JournalNode } from '../../src/shared/model'

test('slash commands dismiss without interrupting literal writing', async ({ desktop }, info) => {
    const { page, profile, shot } = desktop
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    const menu = page.getByRole('listbox', { name: 'Add blocks', exact: true })
    const close = page.getByRole('option', { name: 'Close menu Esc', exact: true })

    await test.step('embedded slashes stay literal and Escape survives further typing and caret movement', async () => {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await body.click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('Paths like docs/editor and https://example.test stay literal.')
        await expect(menu).toHaveCount(0)
        await page.keyboard.press('Enter')
        await page.keyboard.type('Escape keeps this slash: /')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
        await page.keyboard.type('heading stays in my sentence')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowRight')
        await expect(menu).toHaveCount(0)
        await expect(body).toContainText('/heading stays in my sentence')
    })

    await test.step('space after bare and unmatched slashes preserves literal writing', async () => {
        await page.keyboard.press('Enter')
        await page.keyboard.type('A bare slash: /')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Space')
        await expect(menu).toHaveCount(0)
        await page.keyboard.type('and more writing')
        await expect(menu).toHaveCount(0)
        await page.keyboard.press('Enter')
        await page.keyboard.type('An unknown command: /zzzz')
        await expect(close).toBeVisible()
        await page.keyboard.press('Space')
        await page.keyboard.type('also stays literal')
        await expect(menu).toHaveCount(0)
        await expect(body).toContainText('/zzzz also stays literal')
    })

    await test.step('Close menu works with the pointer and keyboard without removing the query', async () => {
        await page.keyboard.press('Enter')
        await page.keyboard.type('Close with the pointer: /zzzz')
        await expect(close).toBeVisible()
        await expect(close).toHaveAttribute('aria-selected', 'true')
        const optionId = await close.getAttribute('id')
        await expect(body).toHaveAttribute('aria-activedescendant', optionId!)
        await shot('01-unmatched-close-menu')
        await menu.screenshot({ path: info.outputPath('close-menu-detail.png') })
        await close.click()
        await expect(body).toBeFocused()
        await page.keyboard.type(' remains untouched')
        await expect(menu).toHaveCount(0)
        for (const key of ['Enter', 'Tab']) {
            await page.keyboard.press('Enter')
            await page.keyboard.type(`Close with ${key}: /zzzz`)
            await expect(close).toBeVisible()
            await page.keyboard.press(key)
            await expect(menu).toHaveCount(0)
            await expect(body).toBeFocused()
            await page.keyboard.type(' remains untouched')
            await expect(menu).toHaveCount(0)
        }
    })

    await test.step('outside dismissal keeps outside focus and a fresh multiword command still works', async () => {
        await page.keyboard.press('Enter')
        await page.keyboard.type('Outside dismissal: /')
        await expect(menu).toBeVisible()
        const title = page.getByRole('textbox', { name: 'Entry title', exact: true })
        await title.click({ position: { x: 8, y: 8 } })
        await expect(menu).toHaveCount(0)
        await expect(title).toBeFocused()
        await body.click()
        await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.type('still literal')
        await expect(menu).toHaveCount(0)
        await page.keyboard.press('Enter')
        await page.keyboard.type('/heading ')
        await expect(menu).toBeVisible()
        await page.keyboard.type('2')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Commands still work')
        await expect(body.getByRole('heading', { level: 2, name: 'Commands still work' })).toBeVisible()
        await shot('02-dismissed-literal-writing')
    })

    let saved: JournalNode
    await test.step('literal writing autosaves and survives renderer reload', async () => {
        await expect
            .poll(async () => {
                const { state } = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
                saved = state.drafts[0].body
                return JSON.stringify(saved)
            })
            .toContain('Commands still work')
        writeFileSync(info.outputPath('saved-body.json'), JSON.stringify(saved!, null, 2))
        await page.reload()
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(body).toContainText('/heading stays in my sentence')
        await expect(body).toContainText('/ and more writing')
        await expect(body).toContainText('/zzzz also stays literal')
        await expect(body).toContainText('Close with the pointer: /zzzz remains untouched')
        await expect(body).toContainText('Close with Enter: /zzzz remains untouched')
        await expect(body).toContainText('Close with Tab: /zzzz remains untouched')
        await shot('03-reloaded-writing')
    })

    await test.step('independent SQLite read retains the complete saved document', async () => {
        await desktop.close()
        const db = new DatabaseSync(join(profile, 'journal.sqlite'), { readOnly: true })
        try {
            const rows = db.prepare('SELECT body FROM drafts').all()
            const drafts = rows.map((row) => JSON.parse(String(row.body)) as JournalNode)
            writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(drafts, null, 2))
            expect(drafts).toEqual([saved!])
        } finally {
            db.close()
        }
    })
})
