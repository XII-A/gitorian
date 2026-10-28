import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { state, flow, description } from './support/mermaid-fixture'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/mermaid-main.mjs', desktopRepositoryIds: ['fixture'] })

test('mermaid: shared details, source, recovery, themes and inert diagrams', async ({ desktop }, info) => {
    const { page, app, shot } = desktop
    await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.setContentSize(1280, 960)
        window.webContents.setBackgroundThrottling(false)
    })
    writeFileSync(info.outputPath('fixture.json'), JSON.stringify(state, null, 2))
    const open = async (title: string) => page.locator('.hub-activity').filter({ hasText: title }).click()
    const blocks = page.getByRole('region', { name: 'Mermaid diagram', exact: true })
    const image = blocks.first().getByRole('img')
    const loaded = async () => {
        await expect(image).toBeVisible()
        await expect
            .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
            .toBe(true)
    }
    await test.step('hub renders independent flowchart and sequence diagrams with surrounding Markdown', async () => {
        await open('Mermaid publishing workflow')
        await expect(blocks).toHaveCount(2)
        await loaded()
        await expect(blocks.nth(1).getByRole('img')).toBeVisible()
        const actions = blocks.first().getByRole('toolbar', { name: 'Diagram actions', exact: true })
        const actualSize = actions.getByRole('button', { name: 'Actual size', exact: true })
        await expect(actualSize).toHaveText('')
        await expect(actions.getByRole('button', { name: 'Copy source', exact: true })).toHaveText('')
        await actualSize.focus()
        await expect(page.getByRole('tooltip')).toHaveText('Actual size')
        await page.keyboard.press('ArrowRight')
        await expect(actions.getByRole('button', { name: 'Copy source', exact: true })).toBeFocused()
        await blocks.nth(1).screenshot({ path: info.outputPath('01-sequence-detail-dark.png') })
        await expect(page.getByRole('table')).toContainText('Author')
        await expect(page.locator('code.language-ts')).toContainText('const draft')
        await expect(page.locator('.hub-detail-diff')).toContainText('+ new')
        await blocks.first().scrollIntoViewIfNeeded()
        await shot('01-hub-diagrams-dark')
        await blocks.first().screenshot({ path: info.outputPath('01-diagram-detail-dark.png') })
    })
    await test.step('keyboard source selection and exact native clipboard preserve authored text', async () => {
        const first = blocks.first()
        await first.getByRole('button', { name: 'Diagram', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        await expect(first.getByRole('region', { name: 'Mermaid source' })).toHaveText(flow + '\n')
        await first.getByRole('button', { name: 'Copy source', exact: true }).click()
        await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(flow + '\n')
        await expect(first.getByRole('status').filter({ hasText: 'Source copied' })).toHaveCount(1)
        await shot('02-source-view')
        const date = page.locator('.hub-detail-meta time').first()
        const previousDate = await date.textContent()
        // Change real state at the IPC boundary, then observe the normal background poll updating the UI.
        await page.evaluate(async () => {
            const reply = await window.journal.invoke({ type: 'state' })
            await window.journal.invoke({
                type: 'settings',
                settings: {
                    ...reply.state.settings,
                    timezone: reply.state.settings.timezone === 'UTC' ? 'Asia/Tokyo' : 'UTC'
                }
            })
        })
        await expect(date).not.toHaveText(previousDate!, { timeout: 20_000 })
        await expect(first.getByRole('region', { name: 'Mermaid source' })).toHaveText(flow + '\n')
        await first.getByRole('button', { name: 'Source', exact: true }).focus()
        await page.keyboard.press('ArrowLeft')
        await loaded()
    })
    await test.step('theme and accent updates regenerate SVG and actual size stays in its scroll viewport', async () => {
        const dark = await image.getAttribute('src')
        const dimensions = await image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])
        await page.evaluate(() => {
            document.documentElement.dataset.theme = 'light'
            document.documentElement.dataset.accent = 'blue'
        })
        await loaded()
        await expect(image).not.toHaveAttribute('src', dark!)
        await shot('03-hub-diagrams-light')
        await blocks.first().screenshot({ path: info.outputPath('03-diagram-detail-light.png') })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const width of [390, 768, 1024, 1440]) {
            await app.evaluate(
                ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 960),
                width
            )
            // Windows DPI conversion can round the content width by one CSS pixel.
            await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(width + 1)
            await expect
                .poll(() => blocks.first().evaluate((node) => node.getBoundingClientRect().right <= innerWidth))
                .toBe(true)
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 960))
        await blocks.first().getByRole('button', { name: 'Actual size', exact: true }).click()
        const viewport = blocks.first().getByRole('region', { name: 'Diagram preview' })
        await expect.poll(() => viewport.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
        await blocks.first().scrollIntoViewIfNeeded()
        await shot('04-narrow-actual-size')
        await blocks.first().getByRole('button', { name: 'Fit diagram', exact: true }).click()
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 960))
        await page.evaluate(() => {
            document.documentElement.dataset.theme = 'dark'
            document.documentElement.dataset.accent = 'neutral'
        })
        await loaded()
        await expect
            .poll(() => image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight]))
            .toEqual(dimensions)
    })
    await test.step('invalid, empty and oversized input preserve source and recover by navigation', async () => {
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
        await open('Invalid Mermaid recovery')
        await expect(blocks).toHaveCount(3)
        await expect(blocks.first().getByRole('status').last()).toContainText('Could not render')
        await expect(blocks.nth(1).getByRole('status').last()).toContainText('empty')
        await expect(blocks.nth(2).getByRole('status').last()).toContainText('too large')
        await blocks.first().getByRole('button', { name: 'Source', exact: true }).click()
        await expect(blocks.first().getByRole('region', { name: 'Mermaid source' })).toContainText('A[')
        await shot('05-invalid-source-recovery')
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
        await open('Untrusted Mermaid content')
        await loaded()
        // Links may exist inside the SVG text, but image rendering makes them inert.
        const url = page.url()
        const windows = app.windows().length
        await image.click()
        await expect(page).toHaveURL(url)
        expect(app.windows()).toHaveLength(windows)
        await expect(blocks.locator('a, iframe, script')).toHaveCount(0)
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
        await open('Mermaid publishing workflow')
        await loaded()
    })
    await test.step('workspace and detached reference use the same renderer, reload retains the source', async () => {
        await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
        await loaded()
        await blocks.first().scrollIntoViewIfNeeded()
        await shot('06-workspace-diagram')
        const referencePromise = app.waitForEvent('window')
        await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
        const reference = await referencePromise
        const referenceImage = reference
            .getByRole('region', { name: 'Mermaid diagram', exact: true })
            .first()
            .getByRole('img')
        await expect(referenceImage).toBeVisible()
        await referenceImage.scrollIntoViewIfNeeded()
        await reference.screenshot({ path: info.outputPath('07-reference-diagram.png') })
        await reference.getByRole('button', { name: 'Dock back to workspace', exact: true }).click()
        await page.reload()
        const reply = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
        expect(reply.state.activities.find((item) => item.id === 'valid')?.description).toBe(description)
        await desktop.close()
        const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            const rows = db.prepare("SELECT description FROM activities WHERE id='valid'").all()
            expect(rows[0]?.description).toBe(description)
            writeFileSync(info.outputPath('persisted-activity.json'), JSON.stringify(rows, null, 2))
        } finally {
            db.close()
        }
    })
})
