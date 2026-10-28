import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/workspace-errors-main.mjs' })
for (const destination of ['hub', 'workspace']) {
    test(`startup failure and recovery to ${destination}`, async ({ desktop }) => {
        const { page, app } = desktop
        await app.evaluate(({ app }) => app.emit('workspace-error-fixture', 'state'))
        const url = new URL(page.url())
        if (destination === 'workspace') url.search = '?workspace=true'
        await page.goto(url.href)
        await expect(page.getByRole('heading', { name: "Couldn't open your journal" })).toBeVisible()
        await expect(page.getByText('Fixture: repository is unavailable', { exact: false })).not.toBeVisible()
        await desktop.shot('01-startup-recovery')
        await app.evaluate(({ app }) => app.emit('workspace-error-fixture-delay', 1000))
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await expect(page.getByRole('button', { name: /^Retrying/ })).toHaveAttribute('aria-disabled', 'true')
        await desktop.shot('02-retrying')
        await expect(page.getByRole('status')).toHaveText(
            "Still couldn't open your journal. Try again or view technical details."
        )
        await page.getByRole('button', { name: 'Technical details', exact: true }).click()
        await expect(page.getByText('Fixture: repository is unavailable', { exact: false })).toBeVisible()
        const diagnostics = page.locator('.startup-diagnostics')
        await expect
            .poll(() =>
                diagnostics.evaluate((node) => {
                    const bottom = node.getBoundingClientRect().bottom
                    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                        if (
                            getComputedStyle(parent).overflowY === 'hidden' &&
                            bottom > parent.getBoundingClientRect().bottom + 1
                        )
                            return false
                    }
                    return true
                })
            )
            .toBe(true)
        await page.getByRole('button', { name: 'Copy details', exact: true }).click()
        const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
        expect(copied).toBe(await diagnostics.textContent())
        await desktop.shot('02-repeated-failure-details')
        await page.setViewportSize({ width: 390, height: 740 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await desktop.shot('03-narrow-recovery')
        await app.evaluate(({ app }) => app.emit('workspace-error-fixture', ''))
        await page.getByRole('button', { name: 'Retry', exact: true }).focus()
        await page.keyboard.press('Enter')
        if (destination === 'workspace')
            await expect(page.getByRole('main', { name: 'Writing workspace' })).toBeVisible()
        else await expect(page.getByRole('heading', { name: 'Weekly overview', exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: "Couldn't open your journal" })).toHaveCount(0)
        await expect(page.locator('main h1, main h2, main h3').first()).toBeFocused()
        await desktop.shot('04-recovered')
    })
}
