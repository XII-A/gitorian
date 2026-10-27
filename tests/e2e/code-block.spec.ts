import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'

test('code blocks: language, exact copy, real wrapping and saved edits', async ({ desktop }, info) => {
    const { page, app, shot } = desktop
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    const code = `  const longValue = "${'abcdefghij'.repeat(32)}";`
    const block = page.locator('.journal-code-block').first()
    const pre = block.locator('pre')
    const language = block.getByRole('combobox', { name: 'Code language' })
    await test.step('typed language fence creates editable code with horizontal overflow', async () => {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await body.click()
        await body.press('Control+A')
        await body.press('Backspace')
        await body.pressSequentially('```js ')
        await body.pressSequentially(code)
        await expect(pre).toHaveText(code)
        await expect(language).toHaveValue('JavaScript')
        await expect.poll(() => pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await shot('01-code-overflow')
    })
    await test.step('search and change language with keyboard, dismiss without losing editing position', async () => {
        await language.click()
        await language.fill('plain text')
        await page.getByRole('option', { name: 'Plain text', exact: true }).click()
        await expect(language).toHaveValue('Plain text')
        await language.click()
        await language.fill('typescript')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await expect(language).toHaveValue('TypeScript')
        await language.click()
        await page.keyboard.press('Escape')
        await expect(language).toBeFocused()
        await pre.click()
        await body.press('End')
        await body.press('Enter')
        await body.pressSequentially('\treturn longValue;')
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
    })
    await test.step('copy excludes controls and wrapping changes layout without changing code', async () => {
        await block.getByRole('button', { name: 'Copy code', exact: true }).click()
        await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe(`${code}\n\treturn longValue;`)
        await expect(body).toBeFocused()
        await block.getByRole('button', { name: 'Wrap lines', exact: true }).press('Enter')
        await expect.poll(() => pre.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        await shot('02-code-wrapped')
        await block.getByRole('button', { name: 'Unwrap lines', exact: true }).click()
        await expect.poll(() => pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
    })
    await test.step('pasted unknown fence retains its language and code paste remains literal', async () => {
        await pre.click()
        await body.press('Control+End')
        await app.evaluate(({ clipboard }) => clipboard.writeText('```custom-language\n  <raw>\n```'))
        await body.press('Control+V')
        const unknown = page.locator('.journal-code-block').nth(1)
        await expect(unknown.getByRole('combobox', { name: 'Code language' })).toHaveValue('Custom-language')
        await unknown.locator('pre').click()
        await body.press('End')
        await app.evaluate(({ clipboard }) => clipboard.writeText(' **literal** /raw'))
        await body.press('Control+V')
        await expect(unknown.locator('pre')).toHaveText('  <raw> **literal** /raw')
        await expect(unknown.locator('strong')).toHaveCount(0)
    })
    await test.step('autosave and reload retain language and independent raw content', async () => {
        // A multiword provider language must also survive the editor's native HTML clipboard path.
        await language.click()
        await language.fill('visual basic')
        await page.getByRole('option', { name: 'Visual basic', exact: true }).click()
        await pre.click()
        await body.press('Control+A')
        await body.press('Control+C')
        await body.press('Control+V')
        await expect(language).toHaveValue('Visual basic')
        await expect(page.locator('.journal-code-block')).toHaveCount(2)
        await language.click()
        await language.fill('typescript')
        await page.getByRole('option', { name: 'TypeScript', exact: true }).click()
        await expect
            .poll(async () =>
                JSON.stringify(
                    (await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.drafts[0]?.body
                )
            )
            .toContain('**literal** /raw')
        await page.reload()
        if (await page.getByRole('button', { name: 'Open journal', exact: true }).isVisible())
            await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(language).toHaveValue('TypeScript')
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
        await expect(page.locator('.journal-code-block').nth(1).locator('pre')).toHaveText('  <raw> **literal** /raw')
        await shot('03-code-reloaded')
        await desktop.close()
        const db = new DatabaseSync(join(desktop.profile, 'gitorian.sqlite'), { readOnly: true })
        try {
            const rows = db.prepare("SELECT json FROM state_records WHERE collection='drafts'").all()
            writeFileSync(info.outputPath('persisted-drafts.json'), JSON.stringify(rows, null, 2))
            expect(rows).toHaveLength(1)
            const saved = JSON.parse(String(rows[0].json))
            expect(saved.body.content[0]).toMatchObject({
                type: 'codeBlock',
                attrs: { language: 'typescript' },
                content: [{ type: 'text', text: `${code}\n\treturn longValue;` }]
            })
            expect(
                saved.body.content.find(
                    (node: { attrs?: { language?: string } }) => node.attrs?.language === 'custom-language'
                )
            ).toMatchObject({ content: [{ type: 'text', text: '  <raw> **literal** /raw' }] })
        } finally {
            db.close()
        }
    })
})
