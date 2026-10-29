import { test, expect } from './support/desktop'

test.use({
    desktopEntry: 'tests/e2e/support/hub-repositories-main.mjs',
    desktopRepositoryIds: Array.from({ length: 256 }, (_, index) => `repo-${index}`)
})

test('hub repositories: bounded summary, linked highlighting and virtual keyboard navigation', async ({ desktop }) => {
    const { page, app, shot } = desktop
    await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setMinimumSize(0, 0)
        window.setContentSize(1440, 1000)
    })
    const chart = page.locator('.repository-chart')
    const rows = page.locator('.hub-activity')
    const first = rows.first()
    const firstLegend = chart.locator('li button').first()
    const secondRow = rows.nth(1).locator('.activity-row-content')
    const opacity = () => secondRow.evaluate((node) => Number(getComputedStyle(node).opacity))
    await test.step('summary retains tiny named shares without preview or breakdown controls', async () => {
        await expect(chart.locator('li')).toHaveCount(7)
        await expect(chart).toContainText('Other (250)')
        await expect(firstLegend).toContainText('0.4%')
        await expect(
            page.getByRole('button', { name: /Show sample data|Show real data|View all .* repositor/ })
        ).toHaveCount(0)
        await shot('01-repository-summary')
    })
    await test.step('legend hover, keyboard focus and selection dim other repositories', async () => {
        await firstLegend.hover()
        await expect.poll(opacity).toBe(0.4)
        await page.mouse.move(0, 0)
        await firstLegend.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(firstLegend).toBeFocused()
        await expect.poll(opacity).toBe(0.4)
        await firstLegend.click()
        await page.mouse.move(0, 0)
        await page.getByRole('button', { name: 'Open settings', exact: true }).focus()
        await expect.poll(opacity).toBe(0.4)
        await firstLegend.click()
        await page.mouse.move(0, 0)
        await page.getByRole('button', { name: 'Open settings', exact: true }).focus()
        await expect.poll(opacity).toBe(1)
    })
    await test.step('large-day expansion keeps a bounded DOM and supports sequential keyboard focus', async () => {
        await page.getByRole('button', { name: /Show 1019 more activities/ }).click()
        await expect(page.locator('[data-virtual-count="1024"]')).toHaveCount(1)
        await expect.poll(() => rows.count()).toBeLessThan(80)
        await first.focus()
        for (let index = 1; index <= 30; index++) {
            await page.keyboard.press('Tab')
            await expect(page.locator(`[data-index="${index}"] .hub-activity`)).toBeFocused()
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 900))
        await expect(page.locator('[data-index="30"] .hub-activity')).toBeFocused()
        await shot('02-virtual-keyboard-focus')
        const collapse = page.getByRole('button', { name: /Show fewer activities/ })
        await collapse.click()
        await expect(page.locator('[data-virtual-count="5"]')).toHaveCount(1)
        await expect(rows).toHaveCount(5)
        await shot('03-collapsed-timeline')
    })
    await test.step('a formerly large day stays usable when filtered down to four activities', async () => {
        await page.getByRole('combobox', { name: 'Projects', exact: true }).click()
        await page.getByRole('option', { name: 'platform-service-001', exact: true }).click()
        await expect(rows).toHaveCount(4)
        await expect(page.getByRole('button', { name: /Show fewer activities|Show \d+ more activities/ })).toHaveCount(
            0
        )
        await rows.first().focus()
        await page.keyboard.press('Tab')
        await expect(rows.nth(1)).toBeFocused()
        await shot('04-small-filtered-day')
    })
})
