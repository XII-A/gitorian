import type { Page } from '@playwright/test'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { test, expect } from './support/desktop'

test.use({ desktopEntry: 'tests/e2e/support/description-images-main.mjs', desktopRepositoryIds: ['fixture'] })

test('HTML and Markdown attachments decode in hub, workspace and detached details', async ({ desktop }, info) => {
    const { page, app, shot } = desktop
    const png = await sharp(resolve('resources/icon.png')).resize(120, 120).png().toBuffer()
    await app
        .context()
        .route(/https:\/\/(?:example.com|github.com)\/.*preview\.png/, (route) =>
            route.fulfill({ contentType: 'image/png', body: png })
        )
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 960))
    const loaded = async (surface: Page) => {
        const image = surface.getByRole('img', { name: 'HTML attachment', exact: true })
        await expect(image).toBeVisible()
        await expect
            .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
            .toBe(true)
        await expect(image).toHaveAttribute(
            'src',
            'https://github.com/example/project/blob/main/docs/preview.png?raw=true'
        )
        await expect(image).toHaveAttribute('width', '120')
        await expect
            .poll(() =>
                surface
                    .getByRole('img', { name: 'Markdown attachment', exact: true })
                    .evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)
            )
            .toBe(true)
    }
    await page.locator('.hub-activity').filter({ hasText: 'Preview HTML images in PR descriptions' }).click()
    await loaded(page)
    await expect(page.locator('.hub-detail-markdown code')).toHaveText('<img src="docs/preview.png">')
    await shot('01-hub-html-image')
    await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
    await loaded(page)
    await shot('02-workspace-html-image')
    const referencePromise = app.waitForEvent('window')
    await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
    const reference = await referencePromise
    await loaded(reference)
    await reference.screenshot({ path: info.outputPath('03-detached-html-image.png') })
})
