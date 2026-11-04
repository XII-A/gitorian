import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'
import { ordinary } from './support/diff-viewer-fixture'

test.use({ desktopEntry: 'tests/e2e/support/diff-viewer-main.mjs', desktopRepositoryIds: ['fixture'] })

test('diff viewer: compact source copy, virtualized range selection and detached rendering', async ({
    desktop
}, info) => {
    const { page, app } = desktop
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('.hub-activity').filter({ hasText: 'Review highlighted changes' }).click()
    await expect(page.locator('code.language-ts [data-code-token]').first()).toBeVisible()
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    const lines = page.locator('diffs-container [data-code] [data-line]')
    const viewport = page.getByRole('region', { name: 'Scrollable diff for view.ts', exact: true })
    await expect(lines.first()).toContainText('const value0')
    await expect(lines.first()).toHaveCSS('text-indent', /-/)
    await lines.first().click({ clickCount: 3 })
    await page.keyboard.press('Control+C')
    await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toContain('    const value0 = "before 0";')
    await lines.first().click()
    const word = await lines.first().evaluate((node) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        let text = walker.nextNode()
        while (text && !text.textContent?.includes('value0')) text = walker.nextNode()
        const start = text!.textContent!.indexOf('value0') + 1
        const range = document.createRange()
        range.setStart(text!, start)
        range.setEnd(text!, start + 3)
        const rect = range.getBoundingClientRect()
        return { left: rect.left, right: rect.right, y: rect.y + rect.height / 2 }
    })
    await page.mouse.move(word.left, word.y)
    await page.mouse.down()
    await page.mouse.move(word.right, word.y, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('alu')
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('alu')
    await page.getByRole('combobox', { name: 'Changed file', exact: true }).click()
    await page.getByRole('treeitem', { name: 'copy.ts', exact: true }).click()
    const sourcePoint = async (line: number, offset: number) =>
        page.locator(`diffs-container [data-code] [data-line="${line}"]`).evaluate((node, offset) => {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
            let text = walker.nextNode()!
            while (offset > text.textContent!.length) {
                offset -= text.textContent!.length
                text = walker.nextNode()!
            }
            const range = document.createRange()
            range.setStart(text, offset)
            range.collapse(true)
            const rect = range.getBoundingClientRect()
            return { x: rect.x, y: rect.y + rect.height / 2 }
        }, offset)
    await expect(lines.first()).toContainText('old')
    const start = await sourcePoint(20, 4)
    const end = await sourcePoint(22, 8)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    new\n\n    tail')
    // Endpoints deliberately have different old/new line numbers.
    const copyGutter = page.locator('diffs-container [data-gutter] [data-column-number]')
    await copyGutter.filter({ hasText: /^10$/ }).click()
    await copyGutter.filter({ hasText: /^20$/ }).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await copyGutter.filter({ hasText: /^20$/ }).click()
    await copyGutter.filter({ hasText: /^10$/ }).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await page.locator('diffs-container [data-deletions] [data-gutter] [data-column-number]').first().click()
    await page
        .locator('diffs-container [data-additions] [data-gutter] [data-column-number]')
        .first()
        .click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await page.getByRole('button', { name: 'Unified', exact: true }).click()
    await page.getByRole('combobox', { name: 'Changed file', exact: true }).click()
    await page.getByRole('treeitem', { name: 'view.ts', exact: true }).click()
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(page.locator('diffs-container [data-code][data-deletions]')).toBeVisible()
    await page.getByRole('button', { name: 'Diff display options' }).click()
    await page.getByRole('switch', { name: 'Original indentation' }).click()
    await page.keyboard.press('Escape')
    await expect(lines.first()).toHaveCSS('text-indent', '0px')
    await page.getByRole('combobox', { name: 'Changed file', exact: true }).click()
    await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click()
    const largeViewport = page.getByRole('region', { name: 'Scrollable diff for large.ts', exact: true })
    await expect(lines.first()).toContainText('value0')
    expect(await lines.count()).toBeLessThan(500)
    await largeViewport.hover()
    await page.mouse.wheel(0, 500000)
    await expect(lines.last()).toContainText('9999')
    expect(await lines.count()).toBeLessThan(500)
    await desktop.shot('large-diff-final-lines')
    // Real gutter range selection survives DOM recycling; copy uses source rather than mounted rows.
    await largeViewport.evaluate((node) => {
        node.scrollTop = 0
    })
    const gutter = page.locator('diffs-container [data-gutter] [data-column-number]').first()
    await expect(gutter).toBeVisible()
    await gutter.click()
    await largeViewport.hover()
    await page.mouse.wheel(0, 500000)
    await page
        .locator('diffs-container [data-gutter] [data-column-number]')
        .last()
        .click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('value0')
    expect(copied).toContain('value9999')
    expect(copied).not.toContain('\r')
    await page.getByRole('heading', { name: 'Review highlighted changes', exact: true }).click({ clickCount: 3 })
    await page.keyboard.press('Control+C')
    await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toContain('Review highlighted changes')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).not.toContain('value0')
    await page.getByRole('combobox', { name: 'Changed file', exact: true }).click()
    await page.getByRole('treeitem', { name: 'long.ts', exact: true }).click()
    const longViewport = page.getByRole('region', { name: 'Scrollable diff for long.ts', exact: true })
    await page.getByRole('button', { name: 'Diff display options' }).click()
    await page.getByRole('switch', { name: 'Wrap lines' }).click()
    await page.keyboard.press('Escape')
    const longColumn = page.locator('diffs-container [data-code][data-deletions]')
    await expect.poll(() => longColumn.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    await longColumn.hover()
    await page.mouse.wheel(600, 0)
    await expect.poll(() => longColumn.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Diff display options' }).click()
    await page.getByRole('switch', { name: 'Wrap lines' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => longViewport.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    const referencePromise = app.waitForEvent('window')
    await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
    const reference = await referencePromise
    await reference.getByRole('tab', { name: 'Diff', exact: true }).click()
    await expect(reference.locator('diffs-container [data-code] [data-line]').first()).toContainText('value0')
    await reference.screenshot({ path: info.outputPath('detached-diff.png') })
    for (const width of [390, 768, 1024, 1440]) {
        await app.evaluate(({ BrowserWindow }, width) => {
            const window = BrowserWindow.getAllWindows().find((item) =>
                item.webContents.getURL().includes('reference=')
            )!
            window.setMinimumSize(0, 0)
            window.setContentSize(width, 900)
        }, width)
        await expect(reference.locator('diffs-container [data-code] [data-line]').first()).toBeVisible()
        expect(await reference.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    const keyword = reference.locator('diffs-container [data-code] [style*="--code-token-keyword"]').first()
    const darkColor = await keyword.evaluate((node) => getComputedStyle(node).color)
    await reference.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
    })
    await expect.poll(() => keyword.evaluate((node) => getComputedStyle(node).color)).not.toBe(darkColor)
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
            .find((item) => item.webContents.getURL().includes('reference='))!
            .webContents.setZoomFactor(2)
    })
    await expect(reference.locator('diffs-container [data-code] [data-line]').first()).toBeInViewport()
    await reference.screenshot({ path: info.outputPath('detached-light-zoom.png') })
    await reference.getByRole('button', { name: 'Dock back to workspace', exact: true }).click()
    await expect(viewport).toBeVisible()
    writeFileSync(
        info.outputPath('diff-observations.json'),
        JSON.stringify({ errors, copiedLines: copied.split('\n').length }, null, 2)
    )
    expect(errors).toEqual([])
})

test('diff highlighting failure retains exact raw patch and native copy without another engine', async ({
    desktop
}, info) => {
    const { page, app } = desktop
    await page.addInitScript(() => {
        Object.defineProperty(WebAssembly, 'Module', {
            value: function blockedModule() {
                throw new Error('Fixture WASM initialization failure')
            }
        })
        WebAssembly.compile = () => Promise.reject(new Error('Fixture WASM compilation failure'))
        Object.defineProperty(WebAssembly, 'instantiate', {
            value: () => Promise.reject(new Error('Fixture WASM initialization failure'))
        })
    })
    await page.reload()
    await page.locator('.hub-activity').filter({ hasText: 'Review highlighted changes' }).click()
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Raw patch for view.ts' })).toHaveText(ordinary)
    await page.getByRole('button', { name: 'Copy patch', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(ordinary)
    await expect(page.locator('diffs-container')).toHaveCount(0)
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    expect(resources.some((name) => /\/shiki-[^/]+\.js/.test(name))).toBe(false)
    writeFileSync(info.outputPath('fallback-resources.json'), JSON.stringify(resources, null, 2))
    await desktop.shot('raw-patch-after-wasm-failure')
})
