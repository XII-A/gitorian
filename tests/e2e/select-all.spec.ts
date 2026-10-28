import { test, expect } from './support/desktop'
import type { Editor } from '@tiptap/react'

test('select all: block-first selection, empty blocks, escalation and editing', async ({ desktop }) => {
    const { page, app, shot } = desktop
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await body.click()
    await body.press('Control+A')
    await body.press('Control+A')
    await body.press('Backspace')
    await app.evaluate(({ clipboard }) =>
        clipboard.writeText(
            'Alpha paragraph\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n- Parent item\n  - Nested item'
        )
    )
    await body.press('Control+V')
    const selected = () => page.evaluate(() => window.getSelection()?.toString())
    const paragraph = body.locator('p').filter({ hasText: 'Alpha paragraph' })
    await paragraph.click()
    await body.press('Control+A')
    await expect.poll(selected).toBe('Alpha paragraph')
    await body.press('Control+A')
    await expect.poll(selected).toContain('const b = 2;')
    await body.press('Control+A')
    await expect.poll(selected).toContain('Nested item')
    await body.locator('pre').click()
    await body.press('Control+A')
    await expect.poll(selected).toBe('const a = 1;\nconst b = 2;')
    await body.press('ArrowLeft')
    await body.press('Control+A')
    await expect.poll(selected).toBe('const a = 1;\nconst b = 2;')
    await body.press('Control+A')
    await expect.poll(selected).toContain('Alpha paragraph')
    await expect(body.locator('li li p')).toHaveText('Nested item')
    await paragraph.click()
    await body.press('Home')
    await body.press('ArrowRight')
    await body.press('Control+Shift+End')
    await expect.poll(selected).not.toContain('Alpha paragraph')
    await body.press('Control+A')
    await expect.poll(selected).toContain('Alpha paragraph')
    await expect.poll(selected).toContain('Nested item')
    await body.locator('li li p').click()
    await body.press('Control+A')
    await expect.poll(selected).toBe('Nested item')
    await body.press('End')
    // Native caret movement reaches the editor asynchronously via selectionchange.
    // Wait for the editing precondition before Enter can replace the old selection.
    await expect
        .poll(() =>
            body.evaluate((element) => {
                const { selection } = (element as HTMLElement & { editor: Editor }).editor.state
                return {
                    empty: selection.empty,
                    offset: selection.$from.parentOffset,
                    text: selection.$from.parent.textContent
                }
            })
        )
        .toEqual({ empty: true, offset: 'Nested item'.length, text: 'Nested item' })
    await body.press('Enter')
    await body.press('Enter')
    await body.press('Control+A')
    await expect.poll(selected).toContain('Alpha paragraph')
    await expect.poll(selected).toContain('Nested item')
    await shot('01-document-from-empty-block')
    await body.pressSequentially('Replacement')
    await expect(body).toHaveText('Replacement')
    await body.press('Control+Z')
    await expect(body).toContainText('Alpha paragraph')
    await expect(body).toContainText('const b = 2;')
})
