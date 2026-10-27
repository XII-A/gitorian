import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './support/desktop'
import type { Repository } from '../../src/shared/model'

test.use({ desktopEntry: 'tests/e2e/support/import-main.mjs' })

test('repository import: selection, cancellation, recovery and durable tracking', async ({ desktop }, info) => {
    const { page, app, scratch, profile, chooseFolder, shot } = desktop
    const folder = join(scratch, 'Projects')
    const names = ['api-server', 'archived-tools', 'design-system', 'playground', 'team/website', 'tools/website']
    const expected = ['api-server', 'archived-tools', 'design-system', 'website', 'website']
    const state = () => page.evaluate(() => window.journal.invoke({ type: 'state' }))
    const add = page.getByRole('button', { name: 'Add repositories from folder', exact: true })
    const rows = page.locator('.repository-import-row')
    const review = page.locator('.repository-import-review')
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
    const scan = (status: string) => page.locator(`.repository-scan-status[data-status="${status}"]`)

    await test.step('dark appearance survives light and dark platform preferences', async () => {
        // Let Electron's native platform preference drive matchMedia rather than Playwright's default.
        await page.emulateMedia({ colorScheme: null, reducedMotion: 'no-preference' })
        await expect(page.locator('.window-title-bar-drag')).toHaveText('Gitorian')
        for (const theme of ['light', 'dark', 'light'] as const) {
            await app.evaluate(({ nativeTheme }, value) => {
                nativeTheme.themeSource = value
            }, theme)
            await expect
                .poll(() => page.evaluate((value) => matchMedia(`(prefers-color-scheme: ${value})`).matches, theme))
                .toBe(true)
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
            await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
        }
        await shot('00-dark-theme-light-platform')
    })
    await test.step('prepare real Git folders and existing tracking choices', async () => {
        for (const name of names) {
            const path = join(folder, name)
            mkdirSync(path, { recursive: true })
            execFileSync('git', ['init', '-b', 'main'], { cwd: path, windowsHide: true, stdio: 'ignore' })
        }
        for (let index = 0; index < 300; index++)
            mkdirSync(join(folder, 'scan-fixture', String(index)), { recursive: true })
        for (const name of names.slice(0, 2)) {
            await chooseFolder(join(folder, name))
            await page.evaluate(() => window.journal.invoke({ type: 'addRepository' }))
        }
        await page.evaluate(async () => {
            const { state } = await window.journal.invoke({ type: 'state' })
            await window.journal.invoke({ type: 'settings', settings: { ...state.settings, refreshMinutes: 0 } })
            await window.journal.invoke({ type: 'repository', repository: { ...state.repositories[1], removed: true } })
        })
        writeFileSync(info.outputPath('fixture.json'), JSON.stringify({ folder, names, delayedIO: true }, null, 2))
    })
    await test.step('chooser, discovery and review expose progress', async () => {
        await chooseFolder(folder, 1800)
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await expect(add).toBeVisible()
        await shot('01-choose-folder')
        await add.click()
        await expect(review).toContainText('Waiting for folder selection')
        await shot('02-folder-selection')
        await expect(scan('loading')).toContainText('Scanning')
        await shot('03-scanning')
        await expect(scan('success')).toBeVisible()
        await shot('03b-scan-success')
        await expect(rows).toHaveCount(6)
        await expect(review.getByRole('checkbox', { checked: true })).toHaveCount(5)
        const tracked = rows.filter({ hasText: 'api-server' }).getByRole('checkbox')
        await expect(tracked).toBeDisabled()
        await expect(tracked).not.toBeChecked()
        await shot('04-review-all-selected')
    })
    await test.step('selection survives search and clear; cancellation leaves storage unchanged', async () => {
        await page.getByRole('button', { name: 'Deselect all', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Import 0 repositories', exact: true })).toBeDisabled()
        await page.getByRole('button', { name: 'Select all', exact: true }).click()
        await rows.filter({ hasText: 'playground' }).getByRole('checkbox').uncheck()
        const search = page.getByRole('searchbox', { name: 'Search discovered repositories', exact: true })
        await search.fill('website')
        await expect(rows).toHaveCount(2)
        await expect(rows.filter({ hasText: /team[\\/]website/ })).toHaveCount(1)
        await expect(rows.filter({ hasText: /tools[\\/]website/ })).toHaveCount(1)
        await expect(review).toContainText('4 of 5 eligible repositories selected')
        await shot('05-search-preserves-selection')
        const clear = page.getByRole('button', { name: 'Clear search', exact: true })
        const alignment = () =>
            clear.evaluate((button) => {
                const bounds = button.getBoundingClientRect()
                const icon = button.querySelector('svg')!.getBoundingClientRect()
                return {
                    dx: icon.left + icon.width / 2 - bounds.left - bounds.width / 2,
                    dy: icon.top + icon.height / 2 - bounds.top - bounds.height / 2
                }
            })
        const centered = async () => {
            const value = await alignment()
            return Math.max(Math.abs(value.dx), Math.abs(value.dy))
        }
        await expect(clear).toHaveCSS('opacity', '1')
        await expect.poll(centered).toBeLessThanOrEqual(0.5)
        const rest = await alignment()
        await clear.hover()
        await expect.poll(centered).toBeLessThanOrEqual(0.5)
        const hover = await alignment()
        writeFileSync(info.outputPath('search-clear-alignment.json'), JSON.stringify({ rest, hover }, null, 2))
        await shot('05b-search-clear-hover')
        await clear.click()
        await expect(rows).toHaveCount(6)
        await expect(search).toBeFocused()
        await expect(review).toContainText('4 of 5 eligible repositories selected')
        await cancel.click()
        await expect(add).toBeVisible()
        expect((await state()).state.repositories).toHaveLength(2)
    })
    await test.step('confirmation imports selected paths and resumes stopped tracking', async () => {
        await add.click()
        await expect(rows).toHaveCount(6)
        await rows.filter({ hasText: 'playground' }).getByRole('checkbox').uncheck()
        await shot('06-ready-to-import')
        for (const width of [390, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 })
            await expect
                .poll(() =>
                    review.evaluate(
                        (panel) =>
                            panel.scrollWidth <= panel.clientWidth + 1 &&
                            document.documentElement.scrollWidth <= innerWidth
                    )
                )
                .toBe(true)
        }
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.getByRole('button', { name: 'Import 4 repositories', exact: true }).click()
        await expect(page.locator('.settings-import-button')).toContainText('Processing repositories')
        await shot('07-importing')
        await expect.poll(async () => (await state()).state.repositoryImport?.status).toBe('done')
        await expect(add).toBeVisible()
        await shot('08-complete')
        const imported = await state()
        expect(imported.state.repositories.map((repo) => repo.name).sort()).toEqual(expected)
        expect(imported.state.repositories.every((repo) => !repo.removed)).toBe(true)
        expect(imported.state.repositoryImport?.total).toBe(4)
        writeFileSync(info.outputPath('imported-state.json'), JSON.stringify(imported, null, 2))
    })
    await test.step('single-folder review, Escape, failure and reduced-motion recovery', async () => {
        await chooseFolder(join(folder, 'playground'))
        await add.click()
        await expect(rows).toHaveCount(1)
        await expect(page.getByRole('button', { name: 'Import 1 repository', exact: true })).toBeEnabled()
        await page.keyboard.press('Escape')
        await expect(add).toBeVisible()
        expect((await state()).state.repositories).toHaveLength(5)
        await chooseFolder(join(scratch, 'missing-folder'))
        await add.click()
        await expect(scan('error')).toBeVisible()
        await shot('09-scan-failed')
        await expect(review.getByRole('alert')).toContainText('The folder could not be read')
        await shot('10-error-details')
        await page.getByRole('button', { name: 'Back to Settings', exact: true }).click()
        await expect(add).toBeVisible()
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await chooseFolder(folder)
        await add.click()
        await expect(scan('loading').locator('svg')).toHaveCSS('animation-name', 'none')
        await expect(scan('success')).toBeVisible()
        await cancel.click()
        // Observe past the delayed result transition to catch review reopening after cancellation.
        const cancelled = Date.now()
        await expect
            .poll(async () => {
                await expect(add).toBeVisible()
                await expect(review).toHaveCount(0)
                return Date.now() - cancelled
            })
            .toBeGreaterThan(1000)
    })
    await test.step('post-exit SQLite contains exactly the selected tracking choices', async () => {
        await desktop.close()
        const db = new DatabaseSync(join(profile, 'gitorian.sqlite'), { readOnly: true })
        try {
            const repositories = db
                .prepare("SELECT json FROM state_records WHERE collection='repositories'")
                .all()
                .map((row) => JSON.parse(String(row.json)) as Repository)
            writeFileSync(info.outputPath('persisted-repositories.json'), JSON.stringify(repositories, null, 2))
            expect(repositories.map((repo) => repo.name).sort()).toEqual(expected)
            expect(repositories.every((repo) => !repo.removed)).toBe(true)
            expect(new Set(repositories.map((repo) => repo.path)).size).toBe(5)
        } finally {
            db.close()
        }
    })
})
