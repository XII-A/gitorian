import { test, expect } from './support/desktop'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('settings refresh: panels and saved preferences', async ({ desktop }) => {
    const { page, app } = desktop
    await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.setContentSize(1200, 900)
    })
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const output = resolve('.ai-docs/screenshots/settings-refresh', process.env.SETTINGS_CAPTURE ?? 'after')
    mkdirSync(output, { recursive: true })
    for (const name of ['Repositories', 'Connections', 'Preferences', 'Template', 'Backup']) {
        await page.getByRole('tab', { name, exact: true }).click()
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible()
        await expect(page.locator('[role=tabpanel][data-state=inactive]')).toHaveCount(0)
        // Let the shared tab highlight settle before taking visual evidence.
        await page.waitForTimeout(500)
        await page.screenshot({ path: resolve(output, `${name.toLowerCase()}.png`) })
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(390, 844))
    for (const name of ['Preferences', 'Template', 'Backup']) {
        await page.getByRole('tab', { name, exact: true }).click()
        await expect(page.locator('[role=tabpanel][data-state=inactive]')).toHaveCount(0)
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible()
        // Let the shared tab highlight settle before taking visual evidence.
        await page.waitForTimeout(500)
        await page.screenshot({ path: resolve(output, `${name.toLowerCase()}-narrow.png`) })
        expect(await page.locator('.settings-viewport').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
            true
        )
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1200, 900))
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click()
    const interval = page.getByRole('spinbutton', { name: 'Refresh interval' })
    await interval.fill('45')
    await interval.press('Tab')
    await page.getByRole('button', { name: 'Save settings', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click()
    await expect(interval).toHaveValue('45')
    await page.getByRole('button', { name: 'Save settings', exact: true }).click()
})
