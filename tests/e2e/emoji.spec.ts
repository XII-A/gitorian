import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'

test('emoji: formatter, colon search, dismissal, persistence', async ({ desktop }, info) => {
    const { page, shot } = desktop
    await page.evaluate(() =>
        localStorage.setItem(
            'gitorian:emoji-history:v1',
            JSON.stringify([{ emoji: '\u{1f1f8}\u{1f1fe}', count: 4, last: Date.now() }])
        )
    )
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await body.click()
    await body.press('Control+A')
    await body.press('Backspace')
    await page.evaluate(() => {
        const samples: { trigger: string; ms: number; peakOptions: number }[] = []
        Object.assign(window, { emojiOpenSamples: samples })
        document.addEventListener(
            'keydown',
            (event) => {
                const target = event.target as HTMLElement
                const formatter = event.key === 'Enter' && target.textContent?.endsWith('/emoji')
                if (event.key !== ':' && !formatter) return
                const start = performance.now()
                let peakOptions = 0
                const sample = () => {
                    peakOptions = Math.max(
                        peakOptions,
                        [...document.querySelectorAll('.journal-emoji-grid')]
                            .filter((row) => row.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }))
                            .reduce((count, row) => count + row.childElementCount, 0)
                    )
                }
                const observer = new MutationObserver(sample)
                observer.observe(document.body, { childList: true, subtree: true })
                const check = () => {
                    sample()
                    const option = document.querySelector('.journal-emoji-grid button')
                    if (option?.getBoundingClientRect().height) {
                        requestAnimationFrame(() => {
                            sample()
                            samples.push({
                                trigger: formatter ? 'formatter' : 'colon',
                                ms: performance.now() - start,
                                peakOptions
                            })
                            observer.disconnect()
                        })
                    } else if (performance.now() - start < 2000) requestAnimationFrame(check)
                    else {
                        observer.disconnect()
                        samples.push({
                            trigger: formatter ? 'formatter' : 'colon',
                            ms: performance.now() - start,
                            peakOptions
                        })
                    }
                }
                requestAnimationFrame(check)
            },
            true
        )
    })
    await body.pressSequentially(':')
    await expect(page.getByRole('option').first()).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Flags', exact: true })).toHaveCount(0)
    await expect(page.getByRole('option', { name: 'syria', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Recent', exact: true }).click()
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(page.getByText('Your picked emoji will appear here.')).toBeVisible()
    await page.getByRole('tab', { name: 'All emoji', exact: true }).click()
    await body.press('Escape')
    await body.press('Backspace')
    await body.pressSequentially('Shipped :rocket')
    await expect(page.getByRole('option', { name: 'rocket', exact: true })).toBeVisible()
    await shot('01-colon-emoji-search')
    await page
        .getByRole('dialog', { name: 'Choose emoji' })
        .screenshot({ path: info.outputPath('colon-picker-detail.png') })
    await body.press('Enter')
    await expect(body).toHaveText('Shipped \u{1f680}')
    await body.press('Enter')
    await body.pressSequentially('/emoji')
    await body.press('Enter')
    await expect(body).toContainText(':')
    await expect(page.getByRole('textbox', { name: 'Search emoji', exact: true })).toHaveCount(0)
    expect(
        await page
            .locator('.journal-emoji-grid')
            .evaluateAll((rows) =>
                rows
                    .filter((row) => row.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }))
                    .reduce((count, row) => count + row.childElementCount, 0)
            )
    ).toBeLessThan(400)
    const viewport = page.getByRole('region', { name: 'Emoji results', exact: true })
    await viewport.hover()
    await page.context().tracing.stop({ path: info.outputPath('before-scroll-trace.zip') })
    await page.context().tracing.start({ screenshots: false, snapshots: false, sources: true })
    const scrollProbe = await page.context().newCDPSession(page)
    await scrollProbe.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('[aria-label="Emoji results"]')!
        const samples: { offset: number; visibleRows: number; time: number }[] = []
        let running = true
        const sample = () => {
            const frame = viewport.getBoundingClientRect()
            const visibleRows = [...viewport.querySelectorAll('.journal-emoji-grid')].filter((row) => {
                const bounds = row.getBoundingClientRect()
                return bounds.bottom > frame.top + 8 && bounds.top < frame.bottom - 8 && row.childElementCount > 0
            }).length
            samples.push({ offset: viewport.scrollTop, visibleRows, time: performance.now() })
            if (running) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        Object.assign(window, {
            emojiScrollProbe: {
                samples,
                stop: () => {
                    running = false
                }
            }
        })
    })
    const wheelTarget = await viewport.boundingBox()
    for (const delta of [800, 1200, 1600, -800, -1200, 2400, -2400]) {
        await scrollProbe.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: wheelTarget!.x + wheelTarget!.width / 2,
            y: wheelTarget!.y + wheelTarget!.height / 2,
            deltaX: 0,
            deltaY: delta
        })
        await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        )
    }
    const scrollSamples = await page.evaluate(() => {
        const probe = (
            window as unknown as {
                emojiScrollProbe: { samples: { offset: number; visibleRows: number; time: number }[]; stop: () => void }
            }
        ).emojiScrollProbe
        probe.stop()
        return probe.samples
    })
    await scrollProbe.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await scrollProbe.detach()
    await page.context().tracing.stop({ path: info.outputPath('scroll-trace.zip') })
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    writeFileSync(info.outputPath('emoji-scroll-frames.json'), JSON.stringify(scrollSamples))
    expect(scrollSamples.some((sample) => sample.offset > 1000)).toBe(true)
    expect(scrollSamples.filter((sample) => sample.visibleRows === 0)).toEqual([])
    const frameGaps = scrollSamples.slice(1).map((sample, index) => sample.time - scrollSamples[index].time)
    expect(Math.max(...frameGaps)).toBeLessThan(150)
    await shot('02-scrolled-emoji')
    await page.getByRole('tab', { name: 'Nature', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Nature', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.journal-emoji-section').first()).toHaveText('Nature')
    await page.getByRole('tab', { name: 'All emoji', exact: true }).click()
    await expect(page.locator('.journal-emoji-section').first()).toHaveText('Recent')
    await expect
        .poll(async () => {
            const heading = await page.locator('.journal-emoji-section').first().boundingBox()
            const frame = await viewport.boundingBox()
            return heading!.y - frame!.y
        })
        .toBeGreaterThanOrEqual(0)
    const categoryLayout = await page.getByRole('tablist', { name: 'Emoji categories' }).evaluate((list) => {
        const tabs = Array.from(list.querySelectorAll('[role="tab"]'))
        const panel = list.closest('.journal-emoji-menu')!.getBoundingClientRect()
        const last = tabs.at(-1)!.getBoundingClientRect()
        return { trailingGap: panel.right - last.right, widths: tabs.map((tab) => tab.getBoundingClientRect().width) }
    })
    writeFileSync(info.outputPath('category-layout.json'), JSON.stringify(categoryLayout))
    writeFileSync(
        info.outputPath('emoji-open-timing.json'),
        JSON.stringify(
            await page.evaluate(
                () =>
                    (window as unknown as { emojiOpenSamples: { trigger: string; ms: number; peakOptions: number }[] })
                        .emojiOpenSamples
            )
        )
    )
    const timings = await page.evaluate(
        () =>
            (window as unknown as { emojiOpenSamples: { trigger: string; ms: number; peakOptions: number }[] })
                .emojiOpenSamples
    )
    expect(timings.some((sample) => sample.trigger === 'formatter')).toBe(true)
    for (const sample of timings) {
        expect(sample.peakOptions).toBeLessThan(400)
        expect(sample.ms).toBeLessThan(200)
    }
    expect(categoryLayout.trailingGap).toBeLessThan(20)
    const natureTab = page.getByRole('tab', { name: 'Nature', exact: true })
    const idleIconColor = await natureTab.evaluate((tab) => getComputedStyle(tab).color)
    await natureTab.hover()
    await expect.poll(() => natureTab.evaluate((tab) => getComputedStyle(tab).color)).not.toBe(idleIconColor)
    await expect(natureTab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page
        .getByRole('dialog', { name: 'Choose emoji' })
        .screenshot({ path: info.outputPath('hover-picker-detail.png') })
    await natureTab.focus()
    await expect(natureTab).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await page.getByRole('tab', { name: 'All emoji', exact: true }).click()
    await shot('02-formatter-emoji-browse')
    await page
        .getByRole('dialog', { name: 'Choose emoji' })
        .screenshot({ path: info.outputPath('formatter-picker-detail.png') })

    await body.pressSequentially('smile')
    await page.getByRole('option', { name: 'smile', exact: true }).hover()
    await page
        .getByRole('dialog', { name: 'Choose emoji' })
        .screenshot({ path: info.outputPath('emoji-hover-detail.png') })
    await shot('02-formatter-emoji-picker')
    await page.getByRole('option', { name: 'smile', exact: true }).click()
    await expect(body).toContainText('\u{1f604}')
    await body.pressSequentially(' :syria')
    await expect(page.getByText('No emoji found. Try another name.')).toBeVisible()
    await body.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Choose emoji' })).toHaveCount(0)
    await body.press('Control+Backspace')
    await shot('03-inserted-emoji')
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await page.reload()
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body).toContainText('\u{1f680}')
    await expect(body).toContainText('\u{1f604}')
    await body.press('Control+End')
    await body.pressSequentially(' :smile')
    await page.getByRole('option', { name: 'smile', exact: true }).click()
    await body.pressSequentially(' :')
    await page.getByRole('tab', { name: 'Recent', exact: true }).click()
    await expect(page.getByRole('option')).toHaveCount(2)
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-label', 'smile')
    await shot('04-recent-emoji')
    await page
        .getByRole('dialog', { name: 'Choose emoji' })
        .screenshot({ path: info.outputPath('recent-picker-detail.png') })
    await expect(page.locator('.ws-writing-footer')).toContainText('Saved on this device')
    await page.reload()
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await body.press('Control+End')
    await body.pressSequentially('r')
    await body.press('Backspace')
    await page.getByRole('tab', { name: 'Recent', exact: true }).click()
    await expect(page.getByRole('option').first()).toHaveAttribute('aria-label', 'smile')
    await expect(page.getByRole('option')).toHaveCount(2)
    for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        const bounds = await page.getByRole('dialog', { name: 'Choose emoji' }).boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2))
    const zoomBounds = await page.getByRole('dialog', { name: 'Choose emoji' }).boundingBox()
    expect(zoomBounds!.x + zoomBounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await expect
        .poll(async () => {
            const option = await page.getByRole('option').first().boundingBox()
            const frame = await viewport.boundingBox()
            return !!option && !!frame && option.y >= frame.y && option.y + option.height <= frame.y + frame.height
        })
        .toBe(true)
    await shot('05-zoom-emoji')
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
    await page.evaluate(() => {
        document.documentElement.dir = 'rtl'
    })
    await shot('05-rtl-emoji')
    await page.evaluate(() => {
        document.documentElement.dir = 'ltr'
    })
})
