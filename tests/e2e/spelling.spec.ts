import { test, expect } from './support/desktop'

test('spelling menu corrects writing, learns words and toggles spell check', async ({ desktop }) => {
    const { page, app } = desktop
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.evaluate(({ session }) => {
        session.defaultSession.setSpellCheckerLanguages(['en-US'])
        session.defaultSession.setSpellCheckerEnabled(true)
    })
    await page.getByRole('button', { name: 'Open journal', exact: true }).click()
    const body = page.getByRole('textbox', { name: 'Journal body', exact: true })
    const item = (name: string) => page.getByRole('menuitem', { name, exact: true })
    const typeWord = async (word: string) => {
        await body.click()
        await body.press('Control+A')
        await body.pressSequentially(word + ' ', { delay: 50 })
        // Let the native spellchecker mark the typed word before the menu takes focus.
        await page.waitForTimeout(1000)
    }
    const openMenu = async () => {
        const point = await body
            .locator('p')
            .first()
            .evaluate((p) => {
                const range = document.createRange()
                range.setStart(p.firstChild!, 0)
                range.setEnd(p.firstChild!, 5)
                const rect = range.getBoundingClientRect()
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
            })
        await page.mouse.click(point.x, point.y, { button: 'right' })
    }

    await typeWord('Spellling')
    await openMenu()
    await expect(item('Spelling')).toBeVisible()
    await desktop.shot('spelling-context-menu')
    await item('Spelling').click()
    await expect(body).toContainText('Spelling')
    await expect(page.getByRole('toolbar', { name: 'Text formatting', exact: true })).toBeHidden()
    await expect
        .poll(() =>
            page.evaluate(async () => JSON.stringify((await window.journal.invoke({ type: 'state' })).state.drafts))
        )
        .toContain('Spelling')

    await typeWord('mispelled')
    await openMenu()
    try {
        await item('Add to dictionary').click()
        await expect
            .poll(() => app.evaluate(({ session }) => session.defaultSession.listWordsInSpellCheckerDictionary()))
            .toContain('mispelled')
    } finally {
        await app.evaluate(({ session }) => session.defaultSession.removeWordFromSpellCheckerDictionary('mispelled'))
    }

    await typeWord('Spellling')
    await openMenu()
    await item('Disable spell check').click()
    await expect.poll(() => app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(false)
    await openMenu()
    await item('Enable spell check').click()
    await expect.poll(() => app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(true)
})
