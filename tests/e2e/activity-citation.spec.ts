import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/mermaid-main.mjs', desktopRepositoryIds: ['fixture'] })

test('activity citation: visible React drag overlay, cancellation, invalid drops and saved citation', async ({
    desktop
}) => {
    const { page, shot } = desktop
    const title = 'Mermaid publishing workflow'
    await page.locator('.hub-activity').filter({ hasText: title }).click()
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    if (!(await body.isVisible())) await page.getByRole('button', { name: /^Start this week/ }).click()
    await expect(body).toBeEditable()
    const row = page.locator('.ws-activity-row').filter({ hasText: title })
    const card = page.locator('.activity-citation-card')
    const other = page.locator('.ws-activity-row').filter({ hasText: 'Invalid Mermaid recovery' })
    await other.focus()
    await page.keyboard.press('Enter')
    await expect(other).toHaveAttribute('aria-pressed', 'true')
    const before = await body.innerText()
    const pickup = async () => {
        await row.hover()
        await page.mouse.down()
        await page.mouse.move((await row.boundingBox())!.x + 30, (await row.boundingBox())!.y + 24, { steps: 8 })
        await expect(card).toBeVisible()
        await expect(card).toContainText(title)
        await expect(card).toHaveCSS('opacity', '1')
    }
    const moveTo = async (locator: typeof body) => {
        const box = (await locator.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    }
    await pickup()
    await shot('01-opaque-citation-picked-up')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(card).toHaveCount(0)
    await expect(body).toHaveText(before)
    await expect(other).toHaveAttribute('aria-pressed', 'true')
    await pickup()
    await moveTo(page.getByRole('heading', { name: 'Activity', exact: true }))
    await page.mouse.up()
    await expect(card).toHaveCount(0)
    await expect(body).toHaveText(before)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await pickup()
    await moveTo(body)
    await expect(card).toContainText('Release to cite')
    await shot('02-citation-over-writing')
    await page.mouse.up()
    await expect(body).toContainText(title)
    await expect(card).toHaveCount(0)
    await expect(body.getByText(title, { exact: true })).toHaveCount(1)
    await expect
        .poll(async () => {
            const reply = await page.evaluate(() => window.journal.invoke({ type: 'state' }))
            return JSON.stringify(reply.state.drafts)
        })
        .toContain(title)
    await page.reload()
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body).toContainText(title)
    await shot('03-citation-saved-after-reload')
})
