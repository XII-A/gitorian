import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { test, expect } from './support/desktop'

test('quit checkpoints buffered typing in every writing window before closing storage', async ({ desktop }) => {
    await desktop.page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const executable = await desktop.app.evaluate(() => process.execPath)
    const peerWindow = desktop.app.waitForEvent('window')
    const env: NodeJS.ProcessEnv = { ...process.env, GITORIAN_DEV_PROFILE: desktop.profile }
    delete env.ELECTRON_RUN_AS_NODE
    await promisify(execFile)(executable, ['out/main/index.js'], { env, timeout: 20000, windowsHide: true })
    const peer = await peerWindow
    await peer.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = peer.getByRole('textbox', { name: 'Journal body', exact: true })
    await expect(body).toBeEditable()
    // Hold only the transport batching timer; use native input and the real
    // checkpoint/preload/worker path to collect text that has not been dispatched.
    await peer.evaluate(() => {
        const schedule = window.setTimeout.bind(window)
        window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
            schedule(handler, delay === 40 ? 10000 : delay, ...args)) as typeof window.setTimeout
    })
    await body.fill('Buffered peer writing survives an app-wide quit')
    const reopened = await desktop.restart()
    await reopened.page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(reopened.page.getByRole('textbox', { name: 'Journal body', exact: true })).toHaveText(
        'Buffered peer writing survives an app-wide quit'
    )
    await reopened.page
        .getByRole('textbox', { name: 'Journal body', exact: true })
        .fill('Final window-manager close retains this writing')
    // Let the fixture stop tracing, then exercise BrowserWindow.close (the OS
    // close path), rather than its ordinary app.quit teardown.
    reopened.app.close = async () => {
        const exited = new Promise<void>((resolve) => {
            reopened.app.process().once('exit', () => resolve())
        })
        await reopened.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
        await exited
    }
    await desktop.close()
    const persisted = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        expect(String(persisted.prepare('SELECT body FROM drafts').get()!.body)).toContain(
            'Final window-manager close retains this writing'
        )
    } finally {
        persisted.close()
    }
})

test('separate launches share writing, local undo, failure recovery and durable restart', async ({ desktop }, info) => {
    const first = desktop.page
    await first.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = (page: typeof first) => page.getByRole('textbox', { name: 'Journal body', exact: true })
    const title = (page: typeof first) => page.getByRole('textbox', { name: 'Entry title', exact: true })
    await expect(body(first)).toBeEditable()
    await body(first).fill('Shared draft ')
    await title(first).fill('Shared title ')
    const executable = await desktop.app.evaluate(() => process.execPath)
    const secondWindow = desktop.app.waitForEvent('window')
    const env: NodeJS.ProcessEnv = { ...process.env, GITORIAN_DEV_PROFILE: desktop.profile }
    delete env.ELECTRON_RUN_AS_NODE
    await promisify(execFile)(executable, ['out/main/index.js'], { env, timeout: 20000, windowsHide: true })
    const second = await secondWindow
    await second.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body(second)).toHaveText('Shared draft ')
    await expect(title(second)).toHaveText('Shared title ')
    await first.bringToFront()
    await body(first).press('Control+End')
    await body(first).pressSequentially('Alpha ')
    await second.bringToFront()
    await body(second).press('Control+End')
    await body(second).pressSequentially('Beta ')
    await expect(body(first)).toContainText('Alpha')
    await expect(body(first)).toContainText('Beta')
    await expect.poll(async () => body(first).textContent()).toBe(await body(second).textContent())
    await first.bringToFront()
    await body(first).press('Control+z')
    await expect(body(first)).not.toContainText('Alpha')
    await expect(body(first)).toContainText('Beta')
    await expect(body(second)).not.toContainText('Alpha')
    await title(first).press('End')
    await title(first).pressSequentially('One ')
    await second.bringToFront()
    await title(second).press('End')
    await title(second).pressSequentially('Two ')
    await expect(title(second)).toContainText('One')
    await expect(title(first)).toContainText('Two')
    await expect(first.getByRole('dialog')).toHaveCount(0)
    await desktop.shot('01-concurrent-writing')

    const db = new DatabaseSync(join(desktop.profile, 'journal.sqlite'))
    try {
        db.exec(
            "CREATE TRIGGER fail_writing BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'Fixture storage failure'); END"
        )
        await title(second).press('End')
        await title(second).pressSequentially('Recover me ')
        await expect(second.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible()
        await expect
            .poll(() =>
                second.evaluate(() =>
                    Object.entries(localStorage)
                        .filter(([key]) => key.startsWith('gitorian:writing:'))
                        .some(([, value]) => {
                            const record = JSON.parse(value) as { steps?: unknown[] }
                            return !!record.steps?.length
                        })
                )
            )
            .toBe(true)
    } finally {
        db.exec('DROP TRIGGER IF EXISTS fail_writing')
        db.close()
    }
    await second.reload()
    await second.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(title(second)).toContainText('Recover me')
    await expect(title(first)).toContainText('Recover me')
    // The original window can disappear without taking ownership away from peers.
    await first.close()
    await body(second).press('Control+End')
    await body(second).pressSequentially('Last buffered edit')
    await second.getByRole('navigation', { name: 'Journal breadcrumb' }).getByText('Hub', { exact: true }).click()
    await second.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body(second)).toContainText('Last buffered edit')
    const expectedBody = await body(second).textContent()
    const expectedTitle = await title(second).textContent()
    const restarted = await desktop.restart()
    await restarted.page.getByRole('button', { name: 'Open journal', exact: true }).click()
    await expect(body(restarted.page)).toHaveText(expectedBody!)
    await expect(title(restarted.page)).toHaveText(expectedTitle!)
    await desktop.close()
    const persisted = new DatabaseSync(join(desktop.profile, 'journal.sqlite'), { readOnly: true })
    try {
        const rows = persisted.prepare('SELECT title,body FROM drafts').all()
        expect(rows).toHaveLength(1)
        expect(rows[0].title).toBe(expectedTitle)
        expect(String(rows[0].body)).toContain('Last buffered edit')
        writeFileSync(info.outputPath('persisted-writing.json'), JSON.stringify(rows, null, 2))
    } finally {
        persisted.close()
    }
})
