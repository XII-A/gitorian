import { test, expect } from './support/desktop'
import { readFileSync } from 'node:fs'
import type { JournalNode } from '../../src/shared/model'
import { plainText } from '../../src/shared/notion-format'

test('oversized paste offers an intact rejected copy while ordinary writing keeps saving', async ({
    desktop
}, info) => {
    const { app, page } = desktop
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await body.fill('Safe writing')
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await page.evaluate(() => window.journal.writeClipboardText('x'.repeat(2_000_010)))
    await body.press('Control+a')
    await body.press('Control+a')
    await body.press('Control+v')
    await expect(body).toHaveText('Safe writing')
    await expect(page.getByText('Could not add this edit', { exact: true })).toBeVisible()
    const path = info.outputPath('rejected-writing.json')
    await app.evaluate(({ session }, path) => {
        session.defaultSession.on('will-download', (_event, item) => item.setSavePath(path))
    }, path)
    await page.getByRole('button', { name: 'Download rejected copy', exact: true }).click()
    await expect
        .poll(() => {
            try {
                return plainText((JSON.parse(readFileSync(path, 'utf8')) as { body: JournalNode }).body).length
            } catch {
                return 0
            }
        })
        .toBe(2_000_010)
    await body.press('Control+End')
    await body.pressSequentially(' continues normally')
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await page.reload()
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body).toHaveText('Safe writing continues normally')
})
