import { test, expect } from './support/desktop'
test.use({ desktopEntry: 'tests/e2e/support/provider-emoji-main.mjs', desktopRepositoryIds: ['fixture'] })
test('provider emoji: PR titles and Markdown preserve code', async ({ desktop }) => {
    const { page, app, shot } = desktop
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 960))
    await page.locator('.hub-activity').filter({ hasText: '\u{1f680} Ship emoji support \u{1f389}' }).click()
    await expect(page.locator('.hub-detail-markdown')).toContainText('Ready to launch \u{1f680}')
    await expect(page.locator('.hub-detail-markdown code').first()).toHaveText(':rocket:')
    await shot('pr-emoji-support')
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await expect(page.locator('.ws-inspector-title')).toHaveText('\u{1f680} Ship emoji support \u{1f389}')
    await expect(page.locator('.hub-detail-markdown')).toContainText('\u{2728} emoji shortcodes')
    const referencePromise = app.waitForEvent('window')
    await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
    const reference = await referencePromise
    await expect(reference.locator('.hub-detail-markdown')).toContainText('Ready to launch \u{1f680}')
})
