import { test, expect } from './support/desktop'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { themes } from '../../src/shared/themes'

test('appearance: every palette is readable, durable and follows the selected mode', async ({ desktop }, info) => {
    const { page, app, profile, shot } = desktop
    await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click()
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Dark', exact: true }).press('ArrowLeft')
    await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeFocused()
    const root = page.locator('html')
    const report: unknown[] = []
    for (const mode of ['light', 'dark'] as const) {
        await page.getByRole('radio', { name: mode === 'light' ? 'Light' : 'Dark', exact: true }).press('Space')
        await expect(root).toHaveAttribute('data-theme', mode)
        for (const theme of themes) {
            await page.getByRole('radio', { name: theme.name, exact: true }).press('Space')
            await expect(root).toHaveAttribute('data-palette', theme.id)
            if (theme.id === 'neutral') {
                // Independent release contract: original achromatic OKLCH roles, not the new theme definition.
                const releaseDifferences = await page.evaluate((mode) => {
                    const release =
                        mode === 'light'
                            ? {
                                  '--background': 100,
                                  '--surface': 100,
                                  '--surface-raised': 100,
                                  '--surface-muted': 97.8,
                                  '--foreground': 15,
                                  '--text-secondary': 46,
                                  '--border': 93.5,
                                  '--border-subtle': 96.5,
                                  '--border-strong': 82,
                                  '--accent': 33,
                                  '--primary-background': 15,
                                  '--primary-foreground': 100,
                                  '--control-on': 23,
                                  '--control-glyph': 100,
                                  '--control-thumb-on': 100
                              }
                            : {
                                  '--background': 19,
                                  '--surface': 21.5,
                                  '--surface-raised': 24,
                                  '--surface-muted': 26,
                                  '--foreground': 96,
                                  '--text-secondary': 77,
                                  '--border': 29,
                                  '--border-subtle': 25,
                                  '--border-strong': 40,
                                  '--accent': 80,
                                  '--primary-background': 96,
                                  '--primary-foreground': 19,
                                  '--control-on': 93,
                                  '--control-glyph': 19,
                                  '--control-thumb-on': 19
                              }
                    const context = document.createElement('canvas').getContext('2d')!
                    const rgb = (color: string) => {
                        context.fillStyle = color
                        context.fillRect(0, 0, 1, 1)
                        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                    }
                    return Object.entries(release).map(([role, lightness]) => {
                        const expected = rgb(`oklch(${lightness}% 0 0)`)
                        const actual = rgb(getComputedStyle(document.documentElement).getPropertyValue(role).trim())
                        return {
                            role,
                            difference: Math.max(...actual.map((v, index) => Math.abs(v - expected[index])))
                        }
                    })
                }, mode)
                for (const { role, difference } of releaseDifferences)
                    expect(difference, `${mode} Original ${role} must preserve release colors`).toBeLessThanOrEqual(1)
            }
            const pairs = await page.evaluate((original) => {
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = 1
                const context = canvas.getContext('2d')!
                const color = (token: string) => {
                    context.clearRect(0, 0, 1, 1)
                    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
                    context.fillRect(0, 0, 1, 1)
                    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
                }
                const luminance = (rgb: number[]) =>
                    rgb
                        .map((v) => {
                            const s = v / 255
                            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
                        })
                        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
                const pairs = []
                for (const foreground of [
                    '--foreground',
                    '--text-secondary',
                    '--text-muted',
                    '--accent-text',
                    '--success',
                    '--warning',
                    '--danger'
                ]) {
                    for (const background of ['--background', '--surface', '--surface-raised', '--surface-muted']) {
                        const fg = color(foreground),
                            bg = color(background)
                        const a = luminance(fg),
                            b = luminance(bg)
                        pairs.push({
                            foreground,
                            background,
                            fg,
                            bg,
                            minimum: 4.5,
                            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
                        })
                    }
                }
                const hex = (value: string) => [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
                for (const foreground of ['--border', '--border-subtle', '--border-strong'] as const) {
                    for (const background of [
                        '--background',
                        '--surface',
                        '--surface-raised',
                        '--surface-muted'
                    ] as const) {
                        const a = luminance(color(foreground)),
                            b = luminance(color(background))
                        const baselineA = luminance(hex(original[foreground])),
                            baselineB = luminance(hex(original[background]))
                        pairs.push({
                            foreground,
                            background,
                            fg: color(foreground),
                            bg: color(background),
                            minimum:
                                (Math.max(baselineA, baselineB) + 0.05) / (Math.min(baselineA, baselineB) + 0.05) -
                                0.000001,
                            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
                        })
                    }
                }
                const a = luminance(color('--primary-foreground')),
                    b = luminance(color('--primary-background'))
                pairs.push({
                    minimum: 4.5,
                    foreground: '--primary-foreground',
                    background: '--primary-background',
                    fg: color('--primary-foreground'),
                    bg: color('--primary-background'),
                    ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
                })
                const glyph = luminance(color('--control-thumb-on')),
                    track = luminance(color('--control-on'))
                pairs.push({
                    minimum: 3,
                    foreground: '--control-thumb-on',
                    background: '--control-on',
                    fg: color('--control-thumb-on'),
                    bg: color('--control-on'),
                    ratio: (Math.max(glyph, track) + 0.05) / (Math.min(glyph, track) + 0.05)
                })
                return pairs
            }, themes[0][mode])
            report.push({ mode, theme: theme.id, pairs })
            for (const pair of pairs)
                expect(pair.ratio, `${mode}/${theme.id}: ${JSON.stringify(pair)}`).toBeGreaterThanOrEqual(pair.minimum)
            if (['neutral', 'violet', 'green', 'rose'].includes(theme.id)) await shot(`${mode}-${theme.id}-settings`)
        }
    }
    await info.attach('contrast-pairs', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    await mkdir(join(profile, 'appearance.json.tmp'))
    await page.getByRole('radio', { name: 'Light', exact: true }).press('Space')
    await expect(page.getByText('Could not save appearance. Try choosing it again.')).toBeVisible()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await rm(join(profile, 'appearance.json.tmp'), { recursive: true })
    await page.getByRole('radio', { name: 'Light', exact: true }).press('Space')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(page.getByText('Could not save appearance. Try choosing it again.')).toHaveCount(0)
    await page.getByRole('radio', { name: 'System', exact: true }).press('Space')
    for (const mode of ['light', 'dark', 'light'] as const) {
        await app.evaluate(({ nativeTheme }, value) => {
            nativeTheme.themeSource = value
        }, mode)
        await expect(root).toHaveAttribute('data-theme', mode)
    }
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await app.evaluate(({ nativeTheme }) => {
        nativeTheme.themeSource = 'light'
    })
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Open settings', exact: true })).toBeVisible()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-accent', 'rose')
    expect(JSON.parse(await readFile(join(profile, 'appearance.json'), 'utf8'))).toEqual({
        mode: 'dark',
        theme: 'rose'
    })
    await expect(page.locator('.header-atmosphere')).toHaveAttribute('data-phase', /night|dawn|day|dusk/)
    await expect
        .poll(() => page.locator('.header-atmosphere').evaluate((node) => getComputedStyle(node).opacity))
        .toBe('1')
    await shot('dark-rose-hub')
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click()
    await page.emulateMedia({ colorScheme: null, reducedMotion: 'no-preference' })
    await page.getByRole('radio', { name: 'Light', exact: true }).click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).not.toHaveAttribute('data-appearance-switching', '')
    await shot('light-rose-reveal-finished')
})

test.describe('personal workspace palettes', () => {
    test.use({ desktopEntry: 'tests/e2e/support/mermaid-main.mjs', desktopRepositoryIds: ['fixture'] })
    test('themes color populated hub, writer and details while preserving the sky and draft', async ({ desktop }) => {
        const { page, app, shot } = desktop
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000))
        const canvases = new Set<string>()
        for (const theme of themes) {
            await page.evaluate(async (theme) => {
                await window.journal.appearance!.select({ mode: 'dark', theme })
            }, theme.id)
            await expect(page.locator('html')).toHaveAttribute('data-palette', theme.id)
            const color = await page.locator('.weekly-hub').evaluate((node) => getComputedStyle(node).backgroundColor)
            canvases.add(color)
        }
        expect(canvases.size).toBe(8)
        await page.evaluate(async () => {
            await window.journal.appearance!.select({ mode: 'dark', theme: 'blue' })
        })
        await expect(page.locator('html')).toHaveAttribute('data-palette', 'blue')
        await expect(page.locator('.header-atmosphere')).toHaveAttribute('data-phase', /night|dawn|day|dusk/)
        await shot('ocean-dark-populated-hub')
        await page.locator('.hub-activity').filter({ hasText: 'Mermaid publishing workflow' }).click()
        await expect(
            page.getByRole('region', { name: 'Mermaid diagram', exact: true }).first().getByRole('img')
        ).toBeVisible()
        await shot('ocean-dark-activity-details')
        await page.getByRole('button', { name: 'Open in workspace', exact: true }).click()
        await page.getByRole('button', { name: /Start this week.s entry/ }).click()
        const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
        await expect(body).toBeVisible()
        await body.fill('A personal workspace keeps my writing safe.')
        await page.evaluate(async () => {
            await window.journal.appearance!.select({ mode: 'light', theme: 'amber' })
        })
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
        await expect(body).toContainText('A personal workspace keeps my writing safe.')
        await shot('sandstone-light-writing-workspace')
        const referencePromise = app.waitForEvent('window')
        await page.getByRole('button', { name: 'Pop out diff', exact: true }).click()
        const reference = await referencePromise
        await expect(reference.locator('html')).toHaveAttribute('data-palette', 'amber')
        await expect(reference.locator('html')).toHaveAttribute('data-theme', 'light')
        await page.evaluate(async () => {
            await window.journal.appearance!.select({ mode: 'dark', theme: 'green' })
        })
        await expect(reference.locator('html')).toHaveAttribute('data-palette', 'green')
        await expect(reference.locator('html')).toHaveAttribute('data-theme', 'dark')
        await shot('forest-dark-writing-workspace')
        await reference.getByRole('button', { name: 'Dock back to workspace', exact: true }).click()
    })
})
