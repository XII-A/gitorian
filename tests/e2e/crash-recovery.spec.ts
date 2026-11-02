import { test, expect } from './support/desktop'
import { readFile, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

test.use({ desktopEntry: 'tests/e2e/support/recovery-main.mjs' })

test.describe('forced recovery restart', () => {
    test.use({ desktopEntry: 'tests/e2e/support/recovery-force-main.mjs' })
    test('restarts the blocked desktop with saved writing and its recovery copy intact', async ({ desktop }, info) => {
        test.skip(process.platform !== 'win32', 'Native restart currently verified on Windows')
        test.setTimeout(90000)
        const { page, app, profile } = desktop
        await page.evaluate(async () => {
            const current = await window.journal.invoke({ type: 'state' })
            const week = current.state.activityPage!.since
            const created = await window.journal.invoke({ type: 'newDraft', week })
            const draft = created.state.drafts.find((draft) => draft.week === week)!
            const acknowledged = await window.journal.invoke({
                type: 'draft',
                draft: { ...draft, title: 'Acknowledged test writing' }
            })
            const saved = acknowledged.state.drafts.find((item) => item.id === draft.id)!
            localStorage.setItem(
                `gitorian:recovery:${acknowledged.state.restoreId}:${week}`,
                JSON.stringify({ ...saved, title: 'Unsaved recovery test copy' })
            )
        })
        await desktop.shot('01-before-force-restart')
        await desktop.prepareForTermination()
        await app.evaluate(({ app }) => {
            app.emit('gitorian-block-main')
        })
        await expect
            .poll(
                async () => {
                    try {
                        return JSON.parse(await readFile(join(profile, 'restarted-proof.json'), 'utf8'))
                    } catch {
                        return undefined
                    }
                },
                { timeout: 65000 }
            )
            .toMatchObject({
                diagnostics: { recovery: true },
                titles: ['Acknowledged test writing'],
                recoveryCopies: ['Unsaved recovery test copy']
            })
        await expect
            .poll(
                async () => {
                    try {
                        await readFile(join(profile, 'restarted-exit.json'))
                        return true
                    } catch {
                        return false
                    }
                },
                { timeout: 10000 }
            )
            .toBe(true)
        await copyFile(join(profile, 'restarted-proof.json'), info.outputPath('restarted-proof.json'))
        await copyFile(join(profile, 'diagnostics', 'report.txt'), info.outputPath('force-restart-report.txt'))
    })
})
test('recovery: unexpected exit, native report copy/export and explicit normal admission', async ({
    desktop
}, info) => {
    const { page, app, profile } = desktop
    await expect(page.getByRole('region', { name: 'Recovery mode' })).toBeVisible()
    const notice = page.getByRole('region', { name: 'Recovery mode' })
    await notice.getByRole('button', { name: 'Copy diagnostic report' }).click()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(copied).incident).toBe('unexpected-exit')
    expect(copied).not.toContain(profile)
    await notice.getByRole('button', { name: 'Save report' }).click()
    await expect(notice.getByText('Diagnostic report saved')).toBeVisible()
    expect(await readFile(join(profile, 'report-export.txt'), 'utf8')).toBe(copied)
    await desktop.shot('01-recovery-mode')
    await page.setViewportSize({ width: 390, height: 740 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await notice.getByRole('button', { name: 'Continue normally' }).focus()
    await page.keyboard.press('Enter')
    await expect(notice).toHaveCount(0)
    await desktop.shot('02-normal-admission')
    await copyFile(join(profile, 'report-export.txt'), info.outputPath('diagnostic-report.txt'))
})

test('recovery: independent native controls and report remain available while main is blocked', async ({
    desktop
}, info) => {
    test.skip(process.platform !== 'win32', 'Independent live watchdog is currently verified on Windows')
    test.setTimeout(70000)
    const { app, profile, page } = desktop
    expect(await page.evaluate(() => window.journal.diagnostics!.state())).toMatchObject({ liveRecovery: true })
    await app.evaluate(({ app }) => {
        app.emit('gitorian-block-main')
    })
    await expect
        .poll(
            async () => {
                try {
                    return JSON.parse(await readFile(join(profile, 'recovery-dialog.json'), 'utf8')).buttons
                } catch {
                    return []
                }
            },
            { timeout: 37000 }
        )
        .toContain('Restart in recovery')
    let copied = ''
    try {
        await expect
            .poll(
                async () => {
                    try {
                        copied = await readFile(join(profile, 'recovery-copy.txt'), 'utf8')
                        return copied
                    } catch {
                        return ''
                    }
                },
                { timeout: 5000 }
            )
            .toContain('main-hang')
    } finally {
        await writeFile(info.outputPath('helper-copy.txt'), copied)
        try {
            await copyFile(join(profile, 'recovery-copy-write.txt'), info.outputPath('helper-copy-write.txt'))
        } catch {
            /* diagnostic */
        }
    }
    await page.evaluate(() => window.journal.invoke({ type: 'state' }))
    await desktop.shot('03-responsive-after-controlled-loop')
    await copyFile(join(profile, 'recovery-copy.txt'), info.outputPath('hung-main-report.txt'))
})
