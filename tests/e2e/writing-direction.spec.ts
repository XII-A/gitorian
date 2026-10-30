import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'

test('nested quote borders follow their first prose independently', async ({ desktop }) => {
    const { page, app } = desktop
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await app.evaluate(({ clipboard, ClipboardItem }) =>
        clipboard.write([
            new ClipboardItem({
                'text/html':
                    '<div data-pm-slice="0 0 []"><blockquote><ul><li><p dir="auto">العربية</p></li></ul></blockquote><blockquote><p dir="ltr">English</p><blockquote><p dir="rtl">Nested</p></blockquote></blockquote></div>'
            })
        ])
    )
    await body.click()
    await body.press('Control+A')
    await body.press('Control+V')
    const quotes = body.locator('blockquote')
    await expect(quotes.nth(0)).toHaveCSS('direction', 'rtl')
    expect(await quotes.nth(0).evaluate((el) => parseFloat(getComputedStyle(el).borderRightWidth))).toBeGreaterThan(0)
    await expect(quotes.nth(0)).toHaveCSS('border-left-width', '0px')
    await expect(quotes.nth(1)).toHaveCSS('direction', 'ltr')
    expect(await quotes.nth(1).evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth))).toBeGreaterThan(0)
    await expect(quotes.nth(1)).toHaveCSS('border-right-width', '0px')
    await expect(quotes.nth(2)).toHaveCSS('direction', 'rtl')
    await desktop.shot('nested-quotes')
})

test('multilingual writing keeps direction, native editing and policy across a full restart', async ({
    desktop
}, info) => {
    let page = desktop.page
    const body = () => page.getByRole('textbox', { name: 'Journal body', exact: true })
    const direction = (selector: string) =>
        body()
            .locator(selector)
            .first()
            .evaluate((el) => getComputedStyle(el).direction)
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await body().click()
    await body().press('Control+A')
    await page.keyboard.insertText('العَرَبِيَّة مع Turkish 123')
    await expect.poll(() => direction('p')).toBe('rtl')
    await page.getByRole('textbox', { name: 'Entry title', exact: true }).fill('كتابة Türkçe')
    await expect(page.getByRole('textbox', { name: 'Entry title', exact: true })).toHaveCSS('direction', 'rtl')
    await body().press('Control+End')
    await body().press('Enter')
    await page.keyboard.insertText('Türkçe: ç ğ ı İ ö ş ü')
    await expect(body().locator('p').nth(1)).toHaveCSS('direction', 'ltr')
    await expect(body().locator('p').nth(1)).toHaveCSS('direction', 'ltr')
    await body().press('Enter')
    await page.keyboard.type('/checklist')
    await page.getByRole('option', { name: 'Checklist', exact: true }).click()
    await page.keyboard.insertText('مهمة عربية')
    const item = body().locator('[data-type="taskItem"]').first()
    await expect(item).toHaveCSS('direction', 'rtl')
    const checkbox = await item.getByRole('checkbox').boundingBox()
    const text = await item.locator('p').boundingBox()
    expect(checkbox!.x).toBeGreaterThan(text!.x + text!.width)
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('Turkish task')
    await expect(body().locator('[data-type="taskItem"]').nth(1)).toHaveCSS('direction', 'ltr')
    await desktop.shot('01-mixed-writing')
    await expect(page.getByRole('button', { name: /^(Document|Block) direction:/ })).toHaveCount(0)
    // Wait for the latest text checkpoint, then prove a real process restart.
    await expect
        .poll(async () =>
            JSON.stringify((await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.drafts[0]?.body)
        )
        .toContain('Turkish task')
    ;({ page } = await desktop.restart())
    if (await page.getByRole('button', { name: 'Open journal', exact: true }).isVisible())
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body()).toContainText('العَرَبِيَّة مع Turkish 123')
    await expect(body()).toContainText('Türkçe: ç ğ ı İ ö ş ü')
    await expect(body().locator('[data-type="taskItem"]').first()).toHaveCSS('direction', 'rtl')
    await desktop.shot('02-restarted-writing')
    await desktop.close()
    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const rows = db.prepare('SELECT body FROM drafts').all()
        writeFileSync(info.outputPath('persisted-writing.json'), JSON.stringify(rows, null, 2))
        const saved = JSON.parse(String(rows[0].body))
        expect(saved.attrs.direction).toBeNull()
        expect(saved.content[1].attrs.direction).toBeNull()
    } finally {
        db.close()
    }
})
