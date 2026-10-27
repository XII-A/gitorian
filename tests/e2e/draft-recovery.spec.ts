import { test, expect } from './support/desktop'
import { writeFileSync } from 'node:fs'

test('draft recovery: visible choices preserve or explicitly replace saved writing', async ({ desktop }, info) => {
    const { page } = desktop
    const fixture = await page.evaluate(async () => {
        const week = (await window.journal.invoke({ type: 'state' })).state.activityPage!.since
        const created = await window.journal.invoke({ type: 'newDraft', week })
        const original = created.state.drafts.find((draft) => draft.week === week)!
        const document = (text: string) => ({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
        })
        const saved = await window.journal.invoke({
            type: 'draft',
            draft: {
                ...original,
                title: 'Weekly release notes',
                body: document(
                    'Finished the database refactor and reviewed the release checklist. This is the latest writing saved on this device.'
                )
            }
        })
        const recovery = {
            ...original,
            title: 'My recovery copy',
            body: document(
                'Finished the database refactor. I also drafted notes about recovery testing, but these edits were still unsaved when the app closed.'
            ),
            updatedAt: new Date().toISOString()
        }
        localStorage.setItem(`gitorian:recovery:${saved.state.restoreId}:${week}`, JSON.stringify(recovery))
        return {
            week,
            savedVersion: saved.draftSaved!.version,
            recoveryVersion: recovery.version,
            setup: 'Synthetic older recovery copy plus newer committed draft; real database and renderer'
        }
    })
    writeFileSync(info.outputPath('fixture.json'), JSON.stringify(fixture, null, 2))
    const url = new URL(page.url())
    url.search = `?workspace=true&week=${fixture.week}`
    await page.goto(url.href)
    await expect(page.getByRole('button', { name: 'Use recovery copy', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keep saved writing', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use recovery copy', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Keep saved writing', exact: true })).toBeInViewport()
    await expect(page.getByRole('textbox', { name: 'Entry title', exact: true })).toHaveJSProperty('readOnly', true)
    await expect(page.getByRole('status').filter({ hasText: 'Saved writing changed elsewhere.' })).toBeVisible()
    await desktop.shot('01-recovery-conflict')
    await page.locator('.ws-writing-footer').screenshot({ path: info.outputPath('recovery-choices.png') })
    const group = page.getByRole('group', { name: 'Resolve writing conflict' })
    const verifyBounds = async () => {
        const footer = await page.locator('.ws-writing-footer').boundingBox()
        for (const name of ['Use recovery copy', 'Keep saved writing']) {
            const button = page.getByRole('button', { name, exact: true })
            await expect(button).toBeInViewport({ ratio: 1 })
            const bounds = await button.boundingBox()
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(footer!.y + footer!.height + 1)
        }
    }
    await verifyBounds()
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 800))
    await verifyBounds()
    await desktop.shot('02-narrow-recovery-conflict')
    await page.getByRole('button', { name: 'Keep saved writing', exact: true }).click()
    await expect(group).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Entry title', exact: true })).toBeEditable()
    const retained = await page.evaluate(async () => {
        const reply = await window.journal.invoke({ type: 'state' })
        const draft = reply.state.drafts[0]
        const key = `gitorian:recovery:${reply.state.restoreId}:${draft.week}`
        return { draft, recovery: localStorage.getItem(key) }
    })
    expect(retained.recovery).toBeNull()
    expect(retained.draft.version).toBe(fixture.savedVersion)
    expect(retained.draft.title).toBe('Weekly release notes')
    // Set up another older recovery copy to exercise the other explicit choice.
    await page.evaluate(async () => {
        const reply = await window.journal.invoke({ type: 'state' })
        const draft = reply.state.drafts[0]
        localStorage.setItem(
            `gitorian:recovery:${reply.state.restoreId}:${draft.week}`,
            JSON.stringify({
                ...draft,
                version: draft.version - 1,
                title: 'Recovered release notes',
                body: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'These recovered edits should be saved only after choosing them.'
                                }
                            ]
                        }
                    ]
                }
            })
        )
    })
    await page.reload()
    await expect(group).toBeVisible()
    await verifyBounds()
    await page.getByRole('button', { name: 'Use recovery copy', exact: true }).click()
    await expect(group).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Entry title', exact: true })).toHaveValue('Recovered release notes')
    await expect
        .poll(() =>
            page.evaluate(async () => {
                const reply = await window.journal.invoke({ type: 'state' })
                return reply.state.drafts[0].version
            })
        )
        .toBe(fixture.savedVersion + 1)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Entry title', exact: true })).toHaveValue('Recovered release notes')
    await expect(group).toHaveCount(0)
    await desktop.close()
})
