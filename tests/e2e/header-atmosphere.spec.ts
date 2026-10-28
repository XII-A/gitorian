import { test, expect } from './support/desktop'

function sampleSkyEntry() {
    const frames: number[] = []
    Object.assign(window, { skyEntryFrames: frames })
    // Capture the real CSS transition as soon as the ready canvas enters style
    // calculation. Sampling its timeline avoids imposing a frame-rate floor on CI.
    const observer = new MutationObserver(() => {
        const canvas = document.querySelector('.hub-header-sky canvas[data-ready="true"]')
        if (!canvas) return
        const animation = canvas
            .getAnimations()
            .find((animation) => animation instanceof CSSTransition && animation.transitionProperty === 'opacity')
        if (!animation) return
        animation.pause()
        const duration = Number(animation.effect!.getComputedTiming().duration)
        for (const fraction of [0.25, 0.75]) {
            animation.currentTime = duration * fraction
            frames.push(Number(getComputedStyle(canvas).opacity))
        }
        animation.play()
        observer.disconnect()
    })
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] })
}

test('header sky follows local time, respects reduced motion and survives route changes', async ({ desktop }) => {
    const { page, shot } = desktop
    const sky = page.locator('.header-atmosphere')
    await page.addInitScript(sampleSkyEntry)
    await page.clock.setFixedTime(new Date('2026-10-28T12:00:00'))
    await page.reload()
    await expect(sky).toHaveAttribute('data-phase', 'day')
    await expect(sky).toHaveAttribute('aria-hidden', 'true')
    await expect(sky.locator('canvas')).toBeVisible()
    await expect(sky).toHaveAttribute('data-renderer', 'animated')
    await expect
        .poll(
            async () => {
                const frames = await page.evaluate<number[]>('window.skyEntryFrames')
                return frames.filter((opacity) => opacity > 0 && opacity < 1).length
            },
            { message: 'Startup sky transition must interpolate opacity' }
        )
        .toBeGreaterThan(1)
    expect(await page.evaluate<boolean>('window.skyEntryFrames[1] > window.skyEntryFrames[0]')).toBe(true)
    await expect(sky.locator('canvas')).toHaveCSS('opacity', '1')
    await expect(sky).toHaveCSS('height', '400px')
    await shot('00-hub-day-sky')
    // Compare downsampled rendered pixels: subpixel shader grain cannot pass as cloud motion.
    const skyPixels = async () => {
        const png = await sky.screenshot({ animations: 'disabled' })
        return page.evaluate(async (base64) => {
            const image = new Image()
            image.src = `data:image/png;base64,${base64}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = 96
            canvas.height = 8
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0, 96, 8)
            return Array.from(context.getImageData(0, 0, 96, 8).data)
        }, png.toString('base64'))
    }
    const before = await skyPixels()
    await page.waitForTimeout(4000)
    const after = await skyPixels()
    const motion = before.reduce((sum, value, i) => sum + Math.abs(value - after[i]), 0) / before.length
    console.info(`Visible sky change over four seconds: ${motion}`)
    expect(motion, 'Cloud motion must be visible after downsampling away shader grain').toBeGreaterThan(1)
    await expect(page.getByRole('toolbar', { name: 'Sky preview' })).toHaveCount(0)
    const setHour = async (hour: number) => {
        await page.clock.setFixedTime(new Date(2026, 9, 28, hour))
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    }
    await setHour(23)
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(sky).toHaveAttribute('data-phase', 'night')
    await expect(sky).toHaveCSS('height', '110px')
    await expect(sky).toHaveAttribute('data-renderer', 'static')
    await expect(sky.locator('canvas')).toBeVisible()
    await skyPixels() // Let initial drawing and breadcrumb entry settle.
    const workspaceDraws = await sky.locator('canvas').evaluate(
        (canvas: HTMLCanvasElement) =>
            new Promise<number>((resolve) => {
                const gl = canvas.getContext('webgl')!
                const original = gl.drawArrays.bind(gl)
                let draws = 0
                gl.drawArrays = (...args) => {
                    draws++
                    original(...args)
                }
                setTimeout(() => {
                    gl.drawArrays = original
                    resolve(draws)
                }, 1200)
            })
    )
    expect(workspaceDraws, 'Workspace must schedule no continuous shader draws').toBe(0)
    for (const [hour, phase] of [
        [6, 'dawn'],
        [12, 'day'],
        [19, 'dusk'],
        [23, 'night']
    ] as const) {
        await setHour(hour)
        await expect(sky).toHaveAttribute('data-phase', phase)
        await expect(sky).toHaveAttribute('data-renderer', 'static')
        await page.getByRole('button', { name: 'Hub', exact: true }).hover()
        await shot(`workspace-${phase}-breadcrumb`)
    }
    await expect(page.getByRole('toolbar', { name: 'Sky preview' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Hub', exact: true }).click()
    for (const [hour, phase] of [
        [3, 'night'],
        [6, 'dawn']
    ] as const) {
        await page.clock.setFixedTime(new Date(2026, 9, 28, hour))
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await expect(sky).toHaveAttribute('data-phase', phase)
    }
    await page.clock.setFixedTime(new Date('2026-10-28T19:00:00'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(sky).toHaveAttribute('data-phase', 'dusk')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(sky).toHaveAttribute('data-renderer', 'static')
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(sky).toHaveCount(1)
    await expect(sky).toHaveAttribute('data-phase', 'dusk')
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    await body.click()
    await body.pressSequentially('A calm sky leaves writing responsive.')
    await expect(body).toContainText('A calm sky leaves writing responsive.')
    await shot('01-workspace-dusk-static')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(sky).toHaveAttribute('data-renderer', 'static')
    await expect(sky.locator('canvas')).toBeVisible()
    const dimensions = await sky.locator('canvas').evaluate((canvas: HTMLCanvasElement) => ({
        pixels: canvas.width * canvas.height,
        width: canvas.width,
        cssWidth: canvas.clientWidth
    }))
    expect(dimensions.pixels).toBeLessThanOrEqual(600_000)
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.cssWidth)
    await page.evaluate(() => {
        document.querySelector('canvas')!.getContext('webgl')!.getExtension('WEBGL_lose_context')!.loseContext()
    })
    await expect(sky.locator('canvas')).toHaveCount(0)
    await expect(sky).toHaveAttribute('data-renderer', 'static')
    await expect(body).toContainText('A calm sky leaves writing responsive.')
    await page.evaluate(sampleSkyEntry)
    await page.getByRole('button', { name: 'Hub', exact: true }).click()
    await expect(sky).toHaveCount(1)
    await expect(sky).toHaveAttribute('data-renderer', 'animated')
    await expect
        .poll(
            async () => {
                const frames = await page.evaluate<number[]>('window.skyEntryFrames')
                return frames.filter((opacity) => opacity > 0 && opacity < 1).length
            },
            { message: 'Returning hub transition must interpolate opacity' }
        )
        .toBeGreaterThan(1)
    expect(await page.evaluate<boolean>('window.skyEntryFrames[1] > window.skyEntryFrames[0]')).toBe(true)
    await shot('02-return-hub')
    for (let visit = 0; visit < 30; visit++) {
        await page.getByRole('button', { name: 'Open journal', exact: true }).click()
        await expect(sky).toHaveAttribute('data-renderer', 'static')
        await expect(sky.locator('canvas')).toHaveCount(1)
        await page.getByRole('button', { name: 'Hub', exact: true }).click()
        await expect(sky).toHaveAttribute('data-renderer', 'animated')
        await expect(sky.locator('canvas')).toHaveCount(1)
    }
})
