import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'
import { ordinary } from './support/diff-viewer-fixture'
import type { ElectronApplication, Page } from '@playwright/test'

test.use({ desktopEntry: 'tests/e2e/support/diff-viewer-main.mjs', desktopRepositoryIds: ['fixture'] })

test('diff preferences survive activities and restart while filters stay local and reset remains combined', async ({
    desktop
}, info) => {
    let { page, app } = desktop
    const openReview = async () => {
        await page.locator('.hub-activity').filter({ hasText: 'Review continuous changes' }).click()
        await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
        await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    }
    const openDisplay = (target: Page) =>
        target.getByRole('button', { name: 'Diff display options', exact: true }).click()
    const savedReadingChoices = async (target: Page, layout: 'Split' | 'Unified') => {
        await expect(target.getByRole('button', { name: layout, exact: true })).toHaveAttribute('aria-pressed', 'true')
        for (const name of ['Wrap lines', 'Compact indentation', 'Show line counts']) {
            await expect(target.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
        }
    }
    const popOut = async () => {
        const opened = app.waitForEvent('window')
        await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
        const target = await opened
        await resizeReference(app, 1440)
        return target
    }

    await openReview()
    await openDisplay(page)
    await page.getByRole('button', { name: 'Split', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Wrap lines', 'Compact indentation', 'Show line counts']) {
        await page.getByRole('button', { name, exact: true }).click()
        await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
    }
    await page.keyboard.press('Escape')
    await page.locator('.ws-activity-row').filter({ hasText: 'Review highlighted changes' }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    await openDisplay(page)
    await savedReadingChoices(page, 'Split')
    await page.keyboard.press('Escape')
    await page.locator('.ws-activity-row').filter({ hasText: 'Review continuous changes' }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()

    let reference = await popOut()
    await expect(
        reference.evaluate(async () => {
            const reply = await window.journal.invoke({ type: 'state' })
            return window.journal.invoke({ type: 'settings', settings: reply.state.settings })
        })
    ).rejects.toThrow('Reference windows are read-only')
    await openDisplay(reference)
    await savedReadingChoices(reference, 'Split')
    await reference.getByRole('button', { name: 'Unified', exact: true }).click()
    await expect(reference.getByRole('button', { name: 'Unified', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
    )
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.getByRole('radio', { name: 'List view', exact: true }).click()
    await expect(reference.getByRole('radio', { name: 'List view', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
    )
    await reference.getByRole('button', { name: 'Sort files', exact: true }).click()
    await reference.getByRole('menuitem', { name: 'Sort by changes', exact: true }).click()
    await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toContainText('Changes')
    await reference.getByRole('combobox', { name: 'Change type', exact: true }).click()
    await reference.getByRole('option', { name: /^Modified/ }).click()
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'Hide tests', exact: true }).click()
    await reference.getByRole('button', { name: 'Hide docs', exact: true }).click()
    await expect(reference.getByText('3 files of 5', { exact: true })).toBeVisible()
    await reference.screenshot({ path: info.outputPath('preferences-before-restart.png') })

    ;({ page, app } = await desktop.restart())
    await openReview()
    await openDisplay(page)
    await savedReadingChoices(page, 'Split')
    await page.keyboard.press('Escape')
    reference = await popOut()
    await openDisplay(reference)
    await savedReadingChoices(reference, 'Unified')
    await reference.keyboard.press('Escape')
    const tree = reference.getByRole('tree', { name: 'Changed files', exact: true })
    await expect(tree.getByRole('treeitem')).toHaveCount(5)
    await expect(tree.getByRole('treeitem').first()).toContainText('src/components/Toolbar.tsx')
    for (const name of ['Hide tests', 'Hide docs']) {
        await expect(reference.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
    }
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await expect(reference.getByRole('combobox', { name: 'Change type', exact: true })).toContainText('All files')
    await expect(reference.getByRole('radio', { name: 'List view', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
    )
    await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toContainText('Changes')
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'Hide tests', exact: true }).click()
    await reference.getByRole('button', { name: 'Hide docs', exact: true }).click()
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.getByRole('combobox', { name: 'Change type', exact: true }).click()
    await reference.getByRole('option', { name: /^Modified/ }).click()
    await reference.getByRole('button', { name: 'Reset file options', exact: true }).click()
    await expect(reference.getByRole('radio', { name: 'Tree view', exact: true })).toHaveAttribute(
        'aria-checked',
        'true'
    )
    await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toContainText('Path')
    await expect(reference.getByRole('combobox', { name: 'Change type', exact: true })).toContainText('All files')
    await expect(reference.getByRole('button', { name: 'Reset file options', exact: true })).toBeDisabled()
    await reference.keyboard.press('Escape')
    await expect(tree.getByRole('treeitem', { name: /navigation.test.ts/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /review.md/ })).toBeVisible()
    await reference.screenshot({ path: info.outputPath('preferences-after-reset.png') })
    await desktop.close()
    const database = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const settings = database.prepare('SELECT settings FROM journal WHERE id = 1').get()?.settings
        if (typeof settings !== 'string') throw new Error('Missing persisted settings')
        const preferences = JSON.parse(settings).diff
        expect(preferences).toEqual({
            dockedSplit: true,
            detachedSplit: false,
            wrapLines: false,
            originalIndentation: true,
            showLineCounts: false,
            fileList: 'tree',
            order: 'path'
        })
        writeFileSync(info.outputPath('persisted-diff-preferences.json'), JSON.stringify(preferences, null, 2))
    } finally {
        database.close()
    }
})

async function resizeReference(app: ElectronApplication, width: number) {
    await app.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('reference='))!
        window.setMinimumSize(0, 0)
        window.setContentSize(width, 900)
    }, width)
}

async function retainDiffAcrossTabs(page: Page) {
    const viewport = page.getByRole('region', { name: 'All file changes', exact: true })
    await expect(viewport).toBeVisible()
    await page.getByRole('button', { name: 'Collapse all files', exact: true }).click()
    await page.getByRole('button', { name: 'Expand view.ts. Modified file', exact: true }).click()
    await viewport.hover()
    await page.mouse.wheel(0, 500)
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(100)
    const top = await viewport.evaluate((node) => node.scrollTop)
    for (const tab of ['Details', 'Related']) {
        await page.getByRole('tab', { name: tab === 'Related' ? /^Related\b/ : tab, exact: true }).click()
        await expect(viewport).toBeHidden()
        await page.getByRole('tab', { name: 'Diff', exact: true }).click()
        await expect(viewport).toBeVisible()
        await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeCloseTo(top, 0)
    }
    await viewport.hover()
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(page.getByRole('button', { name: 'Expand copy.ts. Modified file', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Collapse view.ts. Modified file', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Collapse all files', exact: true }).click()
    await page.getByRole('button', { name: 'Expand all files', exact: true }).click()
}

test('Atlas: continuous file disclosure, explorer filters and a focused detached reader', async ({ desktop }, info) => {
    const { page, app } = desktop
    await page.locator('.hub-activity').filter({ hasText: 'Review continuous changes' }).click()
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    const reader = page.getByRole('region', { name: 'All file changes', exact: true })
    await expect(reader).toBeVisible()
    const toolbarFile = page.locator('diffs-container[data-diff-file="src/components/Toolbar.tsx"]')
    await toolbarFile
        .getByRole('button', { name: 'Collapse src/components/Toolbar.tsx. Modified file', exact: true })
        .click()
    await expect(toolbarFile.locator('[data-code] [data-line]')).toHaveCount(0)
    await toolbarFile
        .getByRole('button', { name: 'Expand src/components/Toolbar.tsx. Modified file', exact: true })
        .click()
    await expect(toolbarFile.locator('[data-code] [data-line]').first()).toContainText('export function')
    await page.getByRole('button', { name: 'Collapse all files', exact: true }).click()
    await expect(page.locator('diffs-container [data-code] [data-line]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand all files', exact: true }).click()
    await expect(toolbarFile.locator('[data-code] [data-line]').first()).toContainText('export function')
    await desktop.shot('atlas-docked')
    await page.getByRole('button', { name: 'Diff display options', exact: true }).click()
    await desktop.shot('display-options-docked')
    await page
        .getByRole('dialog', { name: 'Diff display options' })
        .screenshot({ path: info.outputPath('display-palette.png') })
    const counts = page.getByRole('button', { name: 'Show line counts', exact: true })
    const totals = page
        .locator('.diff-workspace-summary')
        .getByRole('img', { name: '16 lines added, 10 lines deleted' })
    await expect(totals).toBeVisible()
    await counts.click()
    await expect(totals).toBeHidden()
    await counts.click()
    await expect(totals).toBeVisible()
    await counts.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tooltip', { name: 'Show line counts', exact: true })).toBeVisible()
    await desktop.shot('display-options-hint')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip', { name: 'Show line counts', exact: true })).toBeHidden()
    if (await page.getByRole('dialog', { name: 'Diff display options' }).isVisible())
        await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Diff display options', exact: true })).toBeFocused()

    const opened = app.waitForEvent('window')
    await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
    const reference = await opened
    await expect(reference.getByRole('tab', { name: 'Diff', exact: true })).toHaveAttribute('aria-selected', 'true')
    await resizeReference(app, 1440)
    const tree = reference.getByRole('tree', { name: 'Changed files', exact: true })
    await expect(tree).toBeVisible()
    await expect(reference.getByRole('button', { name: 'Cite in entry', exact: true })).toHaveCount(0)
    await expect(reference.getByRole('button', { name: 'Find a file', exact: true })).toBeVisible()
    const sourceFolder = tree.getByRole('treeitem', { name: /^src / })
    await expect(sourceFolder).toContainText('+12')
    await expect(sourceFolder).toContainText('−7')
    await reference.getByRole('button', { name: 'Find a file', exact: true }).click()
    await reference.getByRole('searchbox', { name: 'Find a file', exact: true }).fill('theme')
    await expect(reference.getByRole('listbox')).toHaveCount(0)
    await expect(tree.getByRole('treeitem', { name: /Toolbar.tsx/ })).toHaveCount(0)
    await tree.getByRole('treeitem', { name: /theme.css/ }).click()
    await expect(
        reference.locator('diffs-container[data-diff-file="src/theme.css"] [data-line]').first()
    ).toBeInViewport()
    await reference.getByRole('searchbox', { name: 'Find a file', exact: true }).press('Escape')
    await expect(reference.getByRole('button', { name: 'Find a file', exact: true })).toBeFocused()

    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.screenshot({ path: info.outputPath('file-options-dark.png') })
    await reference
        .getByRole('dialog', { name: 'File filters and ordering' })
        .screenshot({ path: info.outputPath('file-palette.png') })
    await test.step('File view and ordering are directly selectable by keyboard and reset together', async () => {
        const list = reference.getByRole('radiogroup', { name: 'File list', exact: true })
        await list.getByRole('radio', { name: 'Tree view', exact: true }).focus()
        await reference.keyboard.press('ArrowRight')
        await expect(list.getByRole('radio', { name: 'List view', exact: true })).toBeFocused()
        await reference.keyboard.press('Enter')
        await expect(tree.getByRole('treeitem')).toHaveCount(5)
        await expect(tree.getByRole('treeitem').first()).toContainText('docs/review.md')
        await reference.keyboard.press('Tab')
        await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toBeFocused()
        await reference.keyboard.press('Enter')
        await reference.keyboard.press('End')
        await expect(reference.getByRole('menuitem', { name: 'Sort by changes', exact: true })).toBeFocused()
        await reference.keyboard.press('Enter')
        await expect(reference.getByRole('dialog', { name: 'File filters and ordering' })).toBeVisible()
        await reference.screenshot({ path: info.outputPath('file-options-keyboard.png') })
        await expect(tree.getByRole('treeitem').first()).toContainText('src/components/Toolbar.tsx')
        await reference.getByRole('button', { name: 'Reset file options', exact: true }).click()
        await expect(list.getByRole('radio', { name: 'Tree view', exact: true })).toHaveAttribute(
            'aria-checked',
            'true'
        )
        await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toContainText('Path')
        await expect(reference.getByRole('button', { name: 'Reset file options', exact: true })).toBeDisabled()
    })
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'Hide tests', exact: true }).click()
    await expect(tree.getByRole('treeitem', { name: /navigation.test.ts/ })).toHaveCount(0)
    await reference.getByRole('button', { name: 'Hide docs', exact: true }).click()
    await expect(tree.getByRole('treeitem', { name: /review.md/ })).toHaveCount(0)
    await expect(reference.getByText('3 files of 5', { exact: true })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /Toolbar.tsx/ })).toBeVisible()
    await expect(reference.getByRole('button', { name: 'File filters and ordering', exact: true })).toHaveAttribute(
        'data-active',
        'false'
    )
    await reference.screenshot({ path: info.outputPath('file-options-exclusions.png') })
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.getByRole('button', { name: 'Reset file options', exact: true }).click()
    await reference.getByRole('combobox', { name: 'Change type', exact: true }).click()
    await reference.getByRole('option', { name: /^Binary/ }).click()
    await expect(reference.getByRole('combobox', { name: 'Change type', exact: true })).toContainText('Binary')
    await reference.screenshot({ path: info.outputPath('file-options-change-type.png') })
    await reference.keyboard.press('Escape')
    await expect(tree.getByRole('treeitem', { name: /mark.png/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /theme.css/ })).toHaveCount(0)
    await expect(reference.locator('.diff-stream-file-state').filter({ hasText: 'Binary file' })).toBeVisible()
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.getByRole('button', { name: 'Reset file options', exact: true }).click()
    await reference.keyboard.press('Escape')
    await tree.getByRole('treeitem', { name: /review.md/ }).click()
    await expect(reference.locator('.diff-stream-file-state').filter({ hasText: 'No text changes' })).toBeInViewport()
    await tree.getByRole('treeitem', { name: /Toolbar.tsx/ }).click()
    await reference.screenshot({ path: info.outputPath('atlas-detached-dark.png') })
    await reference.emulateMedia({ reducedMotion: 'reduce' })
    for (const width of [320, 390, 768, 1024, 1440]) {
        await resizeReference(app, width)
        await expect(reference.getByRole('region', { name: 'All file changes', exact: true })).toBeVisible()
        expect(await reference.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await reference.screenshot({ path: info.outputPath(`atlas-${width}.png`) })
        await reference.getByRole('button', { name: 'Diff display options', exact: true }).click()
        await reference.screenshot({ path: info.outputPath(`display-options-${width}.png`) })
        await reference.keyboard.press('Escape')
    }
    await reference.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
        document.documentElement.dataset.accent = 'blue'
    })
    await reference.screenshot({ path: info.outputPath('atlas-detached-light.png') })
    await reference.getByRole('button', { name: 'Diff display options', exact: true }).focus()
    await reference.keyboard.press('Enter')
    await expect(reference.getByRole('group', { name: 'Diff layout', exact: true })).toBeVisible()
    await reference.screenshot({ path: info.outputPath('display-options-light.png') })
    await reference.keyboard.press('Escape')
    await expect(reference.getByRole('button', { name: 'Diff display options', exact: true })).toBeFocused()
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.screenshot({ path: info.outputPath('file-options-light.png') })
    await reference.keyboard.press('Escape')
    await expect(reference.getByRole('button', { name: 'File filters and ordering', exact: true })).toBeFocused()
    await resizeReference(app, 1600)
    await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('reference='))!
            .webContents.setZoomFactor(2)
    })
    // Native capture retains the complete window at Electron zoom factors above one.
    const captureZoom = async (name: string) => {
        const image = await app.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find((item) =>
                item.webContents.getURL().includes('reference=')
            )!
            return (await window.capturePage()).toPNG().toString('base64')
        })
        writeFileSync(info.outputPath(name), Buffer.from(image, 'base64'))
    }
    await reference.getByRole('button', { name: 'Diff display options', exact: true }).click()
    await reference.getByRole('button', { name: 'Show line counts', exact: true }).focus()
    await expect(reference.getByRole('button', { name: 'Show line counts', exact: true })).toBeInViewport()
    await captureZoom('display-options-zoom.png')
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'File filters and ordering', exact: true }).click()
    await reference.getByRole('button', { name: 'Sort files', exact: true }).focus()
    await expect(reference.getByRole('button', { name: 'Sort files', exact: true })).toBeInViewport()
    await reference.keyboard.press('Enter')
    await reference.getByRole('menuitem', { name: 'Sort by changes', exact: true }).click()
    await expect(reference.getByRole('dialog', { name: 'File filters and ordering' })).toBeVisible()
    await captureZoom('file-options-zoom.png')
    await reference.keyboard.press('Escape')
    await reference.getByRole('button', { name: 'Dock back to workspace', exact: true }).click()
    await expect(reader).toBeVisible()
})

test('diff viewer: compact source copy, virtualized range selection and detached rendering', async ({
    desktop
}, info) => {
    const { page: main, app } = desktop
    const errors: string[] = []
    await main.locator('.hub-activity').filter({ hasText: 'Review highlighted changes' }).click()
    await expect(main.locator('code.language-ts [data-code-token]').first()).toBeVisible()
    await main.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await main.getByRole('tab', { name: 'Diff', exact: true }).click()
    await test.step('Docked diff retains scroll and file disclosure across Details and Related', () =>
        retainDiffAcrossTabs(main))
    const opened = app.waitForEvent('window')
    await main.getByRole('button', { name: 'Pop out diff', exact: true }).click()
    const page = await opened
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('tab', { name: 'Diff', exact: true }).click()
    await resizeReference(app, 1440)
    await test.step('Detached diff retains scroll and file disclosure across Details and Related', () =>
        retainDiffAcrossTabs(page))
    const navigate = async (name: string) => {
        await page.locator(`[role="treeitem"][title="${name}"]`).click()
    }
    await page.getByRole('button', { name: 'Diff display options', exact: true }).click()
    await page.getByRole('button', { name: 'Unified', exact: true }).click()
    await page.keyboard.press('Escape')
    await navigate('view.ts')
    const file = (name: string) => page.locator(`diffs-container[data-diff-file="${name}"]`)
    let lines = file('view.ts').locator('[data-code] [data-line]')
    const viewport = page.getByRole('region', { name: 'All file changes', exact: true })
    const display = async (choice: string) => {
        await page.getByRole('button', { name: 'Diff display options', exact: true }).click()
        if (choice === 'Original' || choice === 'Scroll' || choice === 'Wrap') {
            const toggle = page.getByRole('button', {
                name: choice === 'Original' ? 'Compact indentation' : 'Wrap lines',
                exact: true
            })
            const pressed = choice === 'Wrap'
            if ((await toggle.getAttribute('aria-pressed')) !== String(pressed)) await toggle.click()
            await expect(toggle).toHaveAttribute('aria-pressed', String(pressed))
        } else await page.getByRole('button', { name: choice, exact: true }).click()
        await page.keyboard.press('Escape')
    }
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
    await navigate('copy.ts')
    lines = file('copy.ts').locator('[data-code] [data-line]')
    const sourcePoint = async (line: number, offset: number) =>
        file('copy.ts')
            .locator(`[data-code] [data-line="${line}"]`)
            .evaluate((node, offset) => {
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
    const copyGutter = file('copy.ts').locator('[data-gutter] [data-column-number]')
    await copyGutter.filter({ hasText: /^10$/ }).click()
    await copyGutter.filter({ hasText: /^20$/ }).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await copyGutter.filter({ hasText: /^20$/ }).click()
    await copyGutter.filter({ hasText: /^10$/ }).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await display('Split')
    await file('copy.ts').locator('[data-deletions] [data-gutter] [data-column-number]').first().click()
    await file('copy.ts')
        .locator('[data-additions] [data-gutter] [data-column-number]')
        .first()
        .click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+C')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('    old\n    new')
    await display('Unified')
    await navigate('view.ts')
    lines = file('view.ts').locator('[data-code] [data-line]')
    await display('Split')
    await expect(file('view.ts').locator('[data-code][data-deletions]')).toBeVisible()
    await display('Original')
    await expect(lines.first()).toHaveCSS('text-indent', '0px')
    await navigate('large.ts')
    lines = file('large.ts').locator('[data-code] [data-line]')
    const largeViewport = viewport
    await expect(lines.first()).toContainText('value0')
    expect(await lines.count()).toBeLessThan(500)
    await largeViewport.hover()
    const scrollToLargeEnd = async () => {
        await navigate('long.ts')
        await largeViewport.hover()
        await page.mouse.wheel(0, -300)
        await expect(lines.last()).toContainText('9999')
    }
    await scrollToLargeEnd()
    const largeEndPosition = await largeViewport.evaluate((node) => node.scrollTop)
    expect(await lines.count()).toBeLessThan(500)
    await desktop.shot('large-diff-final-lines')
    // Real gutter range selection survives DOM recycling; copy uses source rather than mounted rows.
    await navigate('large.ts')
    await expect(lines.first()).toContainText('value0')
    const gutter = file('large.ts').locator('[data-gutter] [data-column-number]').first()
    await expect(gutter).toBeVisible()
    await gutter.click()
    await largeViewport.hover()
    await largeViewport.evaluate((node, top) => {
        node.scrollTop = top
    }, largeEndPosition)
    await expect(lines.last()).toContainText('9999')
    await file('large.ts')
        .locator('[data-gutter] [data-column-number]')
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
    await navigate('long.ts')
    const longViewport = viewport
    await display('Scroll')
    const longColumn = file('long.ts').locator('[data-code][data-deletions]')
    await expect.poll(() => longColumn.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    await longColumn.hover()
    await page.mouse.wheel(600, 0)
    await expect.poll(() => longColumn.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
    await display('Wrap')
    await expect.poll(() => longViewport.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await navigate('view.ts')
    const reference = page
    await expect(file('view.ts').locator('[data-code] [data-line]').first()).toContainText('value0')
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
    await expect(file('view.ts').locator('[data-code] [data-line]').first()).toBeInViewport()
    await reference.screenshot({ path: info.outputPath('detached-light-zoom.png') })
    await reference.getByRole('button', { name: 'Dock back to workspace', exact: true }).click()
    await expect(main.getByRole('region', { name: 'All file changes', exact: true })).toBeVisible()
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
    await page
        .getByRole('region', { name: 'Changes in view.ts', exact: true })
        .getByRole('button', { name: 'Copy patch', exact: true })
        .click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(ordinary)
    await expect(page.locator('diffs-container')).toHaveCount(0)
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name))
    expect(resources.some((name) => /\/shiki-[^/]+\.js/.test(name))).toBe(false)
    writeFileSync(info.outputPath('fallback-resources.json'), JSON.stringify(resources, null, 2))
    await desktop.shot('raw-patch-after-wasm-failure')
})
