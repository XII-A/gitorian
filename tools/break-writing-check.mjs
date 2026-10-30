import { _electron as electron } from '@playwright/test'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
mkdirSync('.ai-docs/verification/break-writing', { recursive: true })
const profile = mkdtempSync(resolve(tmpdir(), 'gitorian-break-writing-'))
const env = { ...process.env, BREAK_WRITING_PROFILE: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [resolve('tools/break-writing-electron.cjs')], env })
const results = []
try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const width of [320, 500, 760])
        for (const mode of ['demo', 'worst', 'empty', 'one', 'huge']) {
            const start = Date.now()
            await page.setViewportSize({ width: Math.max(width, 800), height: 900 })
            await page.goto(`http://127.0.0.1:4197/break-writing.html?data=${mode}&width=${width}`)
            await page.getByRole('region', { name: 'Entry writing space' }).waitFor()
            if (mode !== 'empty') await page.locator('.tiptap').waitFor()
            await page.screenshot({ path: `.ai-docs/verification/break-writing/${width}-${mode}.png` })
            results.push({
                width,
                mode,
                loadMs: Date.now() - start,
                ...(await page.evaluate(() => ({
                    footer: document.querySelector('footer')?.innerText,
                    titleHeight: document.querySelector('textarea')?.clientHeight,
                    titleScroll: document.querySelector('textarea')?.scrollHeight,
                    blocks: document.querySelector('.tiptap')?.children.length,
                    overflow: [...document.querySelectorAll('.ws-writing *')]
                        .filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible')
                        .map((e) => ({
                            tag: e.tagName,
                            cls: e.className,
                            scroll: e.scrollWidth,
                            client: e.clientWidth
                        }))
                        .slice(0, 12)
                })))
            })
            const result = results.at(-1)
            if (mode === 'worst') {
                assert.equal(typeof result.titleHeight, 'number')
                assert.ok(result.titleScroll <= Number(result.titleHeight) + 2, 'Title must grow to show all text')
            }
            if (mode === 'one') assert.ok(result.footer.startsWith('1 word\n'), 'Singular count must read 1 word')
            if (mode === 'huge')
                assert.ok(result.footer.startsWith('14,000 words\n'), 'Large count must use locale grouping')
        }
    for (const variant of ['rtl', 'zoom', 'phone', 'wide']) {
        await page.setViewportSize({ width: variant === 'phone' ? 320 : variant === 'wide' ? 2560 : 800, height: 900 })
        await page.goto(
            `http://127.0.0.1:4197/break-writing.html?data=worst&width=${variant === 'wide' ? 760 : 320}&rtl=${variant === 'rtl' ? 1 : 0}`
        )
        await page.locator('.tiptap').waitFor()
        if (variant === 'zoom') await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
        await page.screenshot({ path: `.ai-docs/verification/break-writing/${variant}.png` })
    }
    await page.locator('.journal-image').scrollIntoViewIfNeeded()
    await page.getByText('Image unavailable. Restore it from a backup.').waitFor()
    await page.screenshot({ path: '.ai-docs/verification/break-writing/missing-image.png' })
    await page.setViewportSize({ width: 1000, height: 1000 })
    await page.goto('http://127.0.0.1:4197/break-writing.html?data=worst&width=760')
    await page.locator('.tiptap').waitFor()
    await page.screenshot({ path: '.ai-docs/verification/break-writing/fixed-writing.png' })
    assert.deepEqual(errors, [], 'Fixture must not throw JavaScript errors')
    writeFileSync('.ai-docs/verification/break-writing/results.json', JSON.stringify({ results, errors }, null, 2))
    console.info(JSON.stringify({ results, errors }))
} finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
}
