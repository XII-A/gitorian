import { writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { test, expect } from './support/desktop'

test.use({
    desktopEntry: 'tests/e2e/support/source-activity-main.mjs',
    desktopRepositoryIds: Array.from({ length: 5 }, (_, index) => `repo-${index}`)
})
for (const surface of ['hub', 'workspace'] as const) {
    test(`${surface} source activity distinguishes waits and persists stop with accessible recovery`, async ({
        desktop
    }, info) => {
        const { app, page } = desktop
        await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]
            window.setMinimumSize(0, 0)
            window.setContentSize(1200, 960)
        })
        if (surface === 'workspace') {
            const url = new URL(page.url())
            url.search = '?workspace=true'
            await page.goto(url.href)
        }
        const dismiss = page.getByRole('button', { name: 'Dismiss setup', exact: true })
        if (await dismiss.isVisible()) await dismiss.click()
        await expect(page.getByText('1 source needs attention', { exact: true })).toBeVisible()
        const utilities = page.locator(surface === 'hub' ? '.hub-utility-icons' : '.ws-utilities')
        const sourceButton = page.getByRole('button', { name: 'Activity sources', exact: true })
        await expect(utilities.locator('button').first()).toHaveAccessibleName('Activity sources')
        await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
        await desktop.shot('00-source-error-header')
        await utilities.screenshot({ path: info.outputPath('source-error-actions.png') })
        await page
            .locator(surface === 'hub' ? '.hub-topbar' : '.ws-topbar')
            .screenshot({ path: info.outputPath('source-error-topbar.png') })
        await sourceButton.click()
        const dialog = page.getByRole('dialog', { name: 'Activity sources', exact: true })
        await expect(page.getByRole('button', { name: 'Sample preview', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Preview activity sources', exact: true })).toHaveCount(0)
        const portfolio = dialog.getByRole('article', { name: 'portfolio / GitHub', exact: true })
        const queued = dialog.getByRole('article', { name: 'procurement / GitHub', exact: true })
        await expect(portfolio.getByRole('button', { name: 'Choose account' })).toBeVisible()
        await expect(queued.getByRole('button', { name: 'procurement: Queued. Show reason' })).toBeVisible()
        await expect(queued).not.toContainText('rate limit')
        await expect(dialog.getByRole('progressbar', { name: 'Sources refreshed' })).toHaveAttribute(
            'aria-valuenow',
            '5'
        )
        await expect(dialog.getByText('5 repositories', { exact: true })).toBeVisible()
        await expect(page.getByText('1 source needs attention', { exact: true })).toHaveCount(0)
        await desktop.shot('01-source-activity-desktop')
        await dialog.screenshot({ path: info.outputPath('dialog-overview.png') })
        const contrast = await dialog.evaluate((node) => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d')!
            const rgba = (color: string) => {
                ctx.clearRect(0, 0, 1, 1)
                ctx.fillStyle = color
                ctx.fillRect(0, 0, 1, 1)
                return [...ctx.getImageData(0, 0, 1, 1).data]
            }
            const luminance = (rgb: number[]) =>
                rgb
                    .slice(0, 3)
                    .map((v) => {
                        const n = v / 255
                        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
                    })
                    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0)
            return [...node.querySelectorAll('article p, article h3')].map((element) => {
                let background: Element | null = element
                while (background && rgba(getComputedStyle(background).backgroundColor)[3] < 255)
                    background = background.parentElement
                const foreground = getComputedStyle(element).color
                const surface = getComputedStyle(background!).backgroundColor
                const a = luminance(rgba(foreground)),
                    b = luminance(rgba(surface))
                return {
                    text: element.textContent,
                    foreground,
                    surface,
                    ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
                }
            })
        })
        writeFileSync(info.outputPath('contrast.json'), JSON.stringify(contrast, null, 2))
        expect(Math.min(...contrast.map((item) => item.ratio))).toBeGreaterThanOrEqual(4.5)
        await queued.getByRole('button', { name: 'procurement: Queued. Show reason' }).focus()
        await page.keyboard.press('Enter')
        await expect(
            page.getByText('Starts automatically when another repository finishes.', { exact: true })
        ).toBeVisible()
        await desktop.shot('02-source-wait-reason')
        await page.keyboard.press('Escape')
        await expect(
            page.getByText('Starts automatically when another repository finishes.', { exact: true })
        ).not.toBeVisible()
        await queued.getByRole('button', { name: 'Stop refresh for procurement' }).click()
        await expect(queued.getByRole('img', { name: 'Stopped', exact: true })).toBeVisible()
        await expect(queued.getByRole('button', { name: 'Resume' })).toBeVisible()
        await expect
            .poll(() =>
                page.evaluate(
                    async () =>
                        (await window.journal.invoke({ type: 'state' })).state.acquisition?.['remote:repo-1'].status
                )
            )
            .toBe('cancelled')
        await desktop.shot('03-source-stopped')
        const working = dialog.getByRole('article', { name: 'journal / GitHub', exact: true })
        await working.scrollIntoViewIfNeeded()
        await desktop.shot('03b-source-automatic-waits')
        await dialog.screenshot({ path: info.outputPath('dialog-waits.png') })
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Activity sources', exact: true })).toBeFocused()
        await page.reload()
        await page.getByRole('button', { name: 'Activity sources', exact: true }).click()
        await expect(queued.getByRole('img', { name: 'Stopped', exact: true })).toBeVisible()
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 844))
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expect(portfolio).toBeVisible()
        await desktop.shot('04-source-activity-narrow')
        await dialog.screenshot({ path: info.outputPath('dialog-narrow.png') })
        const overflow = await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1)
        expect(overflow).toBe(false)
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(320, 740))
        await expect(portfolio.getByRole('button', { name: 'Choose account' })).toBeVisible()
        expect(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1)).toBe(false)
        await desktop.shot('05-source-activity-320')
        await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]
            window.setContentSize(768, 1000)
            window.webContents.setZoomFactor(2)
        })
        await expect(portfolio.getByRole('button', { name: 'Choose account' })).toBeVisible()
        expect(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth + 1)).toBe(false)
        await desktop.shot('06-source-activity-zoom')
        await portfolio.getByRole('button', { name: 'Choose account' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('dialog', { name: 'Workspace settings', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
        // Fixture recovery: remove the only error while other sources remain paused/stopped.
        await page.evaluate(async () =>
            window.journal.invoke({ type: 'stopWork', source: 'remote', repositoryId: 'repo-0' })
        )
        await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0]
            window.webContents.setZoomFactor(1)
            window.setContentSize(1200, 960)
        })
        await page.reload()
        await expect(sourceButton).toHaveCount(0)
        await expect(page.getByText('1 source needs attention', { exact: true })).toHaveCount(0)
        await desktop.shot('07-background-waits-header')
        await utilities.screenshot({ path: info.outputPath('source-background-actions.png') })
        await desktop.close()
        const database = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
        try {
            const checkpoint = database
                .prepare("select status, retryAt, cursor from acquisition_checkpoints where key='remote:repo-1'")
                .get()
            expect(checkpoint?.status).toBe('cancelled')
            expect(checkpoint?.retryAt).toBeNull()
            writeFileSync(info.outputPath('persisted-source.json'), JSON.stringify(checkpoint, null, 2))
        } finally {
            database.close()
        }
    })
}
