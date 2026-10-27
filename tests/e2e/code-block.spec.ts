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
    const language = block.getByRole('combobox', { name: 'Code language', exact: true })
    const viewport = block.getByRole('region', { name: 'Code block', exact: true })
    const search = page.getByRole('combobox', { name: 'Search code language', exact: true })
    const chooseLanguage = async (query: string, label: string) => {
        await language.click()
        await search.fill(query)
        await page.getByRole('option', { name: label, exact: true }).click()
    }
    await test.step('typed language fence creates editable code with horizontal overflow', async () => {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await body.click()
        await body.press('Control+A')
        await body.press('Backspace')
        await body.pressSequentially('```js ')
        await body.pressSequentially('const value = 42;')
        const frame = await block.boundingBox()
        const line = await pre.locator('code').boundingBox()
        expect(Math.abs(line!.y - frame!.y - (frame!.y + frame!.height - line!.y - line!.height))).toBeLessThan(2)
        await block.hover()
        await shot('00-centered-single-line')
        await block.screenshot({ path: info.outputPath('00-single-line-detail.png') })
        await body.press('Home')
        await body.press('Shift+End')
        await body.pressSequentially(code)
        await expect(pre).toHaveText(code)
        await expect(language).toContainText('JavaScript')
        await expect(pre.locator('.hljs-keyword')).toContainText('const')
        const bounds = await block.boundingBox()
        const toolbar = await block.getByRole('toolbar', { name: 'Code actions' }).boundingBox()
        expect(toolbar!.height).toBeLessThanOrEqual(32)
        await expect(block.getByRole('toolbar', { name: 'Code actions' })).toHaveCSS('box-shadow', 'none')
        expect(toolbar!.y).toBeGreaterThan(bounds!.y)
        expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width)
        expect(toolbar!.x).toBeGreaterThan(bounds!.x + bounds!.width / 2)
        await expect.poll(() => viewport.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await expect(viewport).toHaveCSS('scrollbar-width', 'none')
        await expect(pre).toHaveCSS('overflow-x', 'visible')
        await viewport.hover()
        await page.mouse.wheel(-4000, 0)
        await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBe(0)
        await page.mouse.wheel(300, 0)
        await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
        expect((await block.getByRole('toolbar', { name: 'Code actions' }).boundingBox())!.x).toBeCloseTo(toolbar!.x, 0)
        await shot('01-code-overflow')
    })
    await test.step('search and change language with keyboard, dismiss without losing editing position', async () => {
        await chooseLanguage('plain text', 'Plain text')
        await expect(language).toContainText('Plain text')
        await expect(pre.locator('[class*="hljs-"]')).toHaveCount(0)
        await language.click()
        await search.fill('typescript')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await expect(language).toContainText('TypeScript')
        await expect(pre.locator('.hljs-keyword')).toContainText('const')
        await language.click()
        await page.keyboard.press('Escape')
        await expect(language).toBeFocused()
        await pre.click()
        await body.press('End')
        await body.press('Enter')
        await body.pressSequentially('\treturn longValue;')
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
        await expect(pre.locator('.hljs-keyword').last()).toHaveText('return')
    })
    await test.step('copy excludes controls and wrapping changes layout without changing code', async () => {
        await block.getByRole('button', { name: 'Copy code', exact: true }).click()
        await expect
            .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
            .toBe(`${code}\n\treturn longValue;`)
        await expect(body).toBeFocused()
        await expect(block.locator('.journal-code-status')).toHaveCSS('position', 'absolute')
        await block.getByRole('button', { name: 'Wrap lines', exact: true }).press('Enter')
        await expect.poll(() => viewport.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        await shot('02-code-wrapped')
        await block.getByRole('button', { name: 'Unwrap lines', exact: true }).click()
        await expect.poll(() => viewport.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
    })
    await test.step('pasted unknown fence retains its language and code paste remains literal', async () => {
        await pre.click()
        await body.press('Control+End')
        await app.evaluate(({ clipboard }) => clipboard.writeText('```custom-language\n  <raw>\n```'))
        await body.press('Control+V')
        const unknown = page.locator('.journal-code-block').nth(1)
        await expect(unknown.getByRole('combobox', { name: 'Code language', exact: true })).toContainText(
            'Custom-language'
        )
        await expect(unknown.locator('[class*="hljs-"]')).toHaveCount(0)
        await unknown.locator('pre').click()
        await body.press('End')
        await app.evaluate(({ clipboard }) => clipboard.writeText(' **literal** /raw'))
        await body.press('Control+V')
        await expect(unknown.locator('pre')).toHaveText('  <raw> **literal** /raw')
        await expect(unknown.locator('strong')).toHaveCount(0)
    })
    await test.step('autosave and reload retain language and independent raw content', async () => {
        // A multiword provider language must also survive the editor's native HTML clipboard path.
        await chooseLanguage('visual basic', 'Visual basic')
        await pre.click()
        await body.press('Control+A')
        await body.press('Control+C')
        await body.press('Control+V')
        await expect(language).toContainText('Visual basic')
        await expect(page.locator('.journal-code-block')).toHaveCount(2)
        await chooseLanguage('typescript', 'TypeScript')
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
        await expect(language).toContainText('TypeScript')
        await expect(pre).toHaveText(`${code}\n\treturn longValue;`)
        await expect(page.locator('.journal-code-block').nth(1).locator('pre')).toHaveText('  <raw> **literal** /raw')
        await shot('03-code-reloaded')
        await language.click()
        await search.fill('python')
        const picker = page.locator('.journal-code-language[data-open] > div').filter({ has: search })
        await expect.poll(async () => (await picker.boundingBox())?.height ?? Infinity).toBeLessThan(140)
        await shot('04-language-picker')
        await picker.screenshot({ path: info.outputPath('04-language-morph-detail.png') })
        await page.keyboard.press('Escape')
        await pre.click()
        await body.press('Control+End')
        await app.evaluate(({ clipboard }) =>
            clipboard.writeText(
                [
                    '```typescript',
                    '// Turn completed work into a weekly summary.',
                    'type Task = { title: string; completed: boolean };',
                    '',
                    'function summarizeWeek(tasks: Task[]): string {',
                    '  const completed = tasks.filter(task => task.completed);',
                    '  return `${completed.length} tasks completed this week`;',
                    '}',
                    '',
                    'const summary = summarizeWeek([',
                    '  { title: "Polish the editor", completed: true },',
                    '  { title: "Ship the update", completed: false },',
                    ']);',
                    '```'
                ].join('\n')
            )
        )
        await body.press('Control+V')
        const showcase = page.locator('.journal-code-block').last()
        await expect(showcase.locator('pre .hljs-keyword').first()).toHaveText('type')
        await showcase.hover()
        await shot('05-floating-controls-and-highlighting')
        await showcase.screenshot({ path: info.outputPath('06-code-block-detail.png') })
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
