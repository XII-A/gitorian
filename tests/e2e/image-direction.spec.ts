import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './support/desktop'

test('caption direction targets the image and preserves native caption focus and paragraph policy', async ({
    desktop
}) => {
    const { page, scratch } = desktop
    const file = join(scratch, 'caption.svg')
    writeFileSync(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="gray"/></svg>'
    )
    await desktop.chooseFolder(file)
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await page.getByRole('textbox', { name: 'Entry title', exact: true }).fill('Caption example')
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await body.click()
    await body.press('Control+A')
    await page.keyboard.type('Keep paragraph')
    await body.press('Enter')
    await page.keyboard.type('/image')
    await page.getByRole('option', { name: 'Image', exact: true }).click()
    const image = page.locator('.journal-image').first()
    await expect(image.locator('img')).toBeVisible()
    await image.hover()
    await image.getByRole('button', { name: /^Caption direction:/ }).click()
    await page.getByText('Right to left', { exact: true }).click()
    const caption = image.getByRole('textbox', { name: 'Image caption', exact: true })
    await expect(caption).toBeFocused()
    await page.keyboard.insertText('وصف عربي\nTurkish caption')
    await expect(caption).toHaveAttribute('dir', 'rtl')
    await expect(body.locator('p').first()).toHaveAttribute('dir', 'auto')
    await image.getByRole('button', { name: /^Caption direction:/ }).click()
    await page.getByText('Automatic', { exact: true }).click()
    await expect(caption).toBeFocused()
    await expect(caption).toHaveAttribute('dir', 'auto')
    await expect(caption).toHaveValue('وصف عربي\nTurkish caption')
    await caption.press('Escape')
    await expect(image.getByRole('button', { name: /^Enlarge image:/ })).toBeFocused()
    await desktop.shot('caption-direction')
    await expect
        .poll(async () =>
            JSON.stringify((await page.evaluate(() => window.journal.invoke({ type: 'state' }))).state.drafts[0]?.body)
        )
        .toContain('Turkish caption')
    await page.getByRole('button', { name: 'Hub', exact: true }).click()
    await page.getByRole('button', { name: 'Previous entries', exact: true }).click()
    await page
        .getByRole('dialog', { name: 'Previous entries', exact: true })
        .getByRole('button', { name: /Caption example/ })
        .click()
    const article = page.locator('.history-article')
    await expect(article.getByRole('textbox', { name: 'Journal entry', exact: true })).toHaveAttribute(
        'contenteditable',
        'false'
    )
    await expect(article.locator('p.journal-image-caption')).toHaveText('وصف عربي\nTurkish caption')
    await expect(article.locator('p.journal-image-caption')).toHaveCSS('unicode-bidi', 'plaintext')
    await expect(article.getByRole('button', { name: /Caption direction/ })).toHaveCount(0)
    await desktop.shot('read-only-multilingual-caption')
})
