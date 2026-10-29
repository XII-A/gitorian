// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
afterEach(cleanup)
import type { Appearance } from '../src/shared/appearance'

test('appearance interface merges rapid choices, reconciles remote changes and survives transition failure', async () => {
    const saves: { value: Appearance; resolve: (value: Appearance) => void }[] = []
    let receive: (value: Appearance) => void = () => {
        /* Assigned by initialization. */
    }
    const bridge = {
        initial: { mode: 'dark', theme: 'neutral' },
        select: (value: Appearance) => new Promise<Appearance>((resolve) => saves.push({ value, resolve })),
        onChange: (listener: typeof receive) => {
            receive = listener
            return () => {
                /* Document lifetime. */
            }
        }
    }
    Object.defineProperty(window, 'journal', { configurable: true, value: { appearance: bridge } })
    const { initializeAppearance, selectAppearance, useAppearance } = await import('../src/renderer/appearance')
    initializeAppearance()
    Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: () => {
            throw new Error('Unsupported transition')
        }
    })
    const light = selectAppearance({ mode: 'light' })
    const blue = selectAppearance({ theme: 'blue' }, document.documentElement)
    expect(saves.map(({ value }) => value)).toEqual([
        { mode: 'light', theme: 'neutral' },
        { mode: 'light', theme: 'blue' }
    ])
    receive(saves[0].value)
    saves[0].resolve(saves[0].value)
    receive(saves[1].value)
    saves[1].resolve(saves[1].value)
    await Promise.all([light, blue])
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.palette).toBe('blue')
    expect(document.documentElement.dataset.appearanceSwitching).toBeUndefined()

    render(
        createElement(function ThemeLabel() {
            return createElement('p', null, `Mode: ${useAppearance().resolved}`)
        })
    )
    let finish: () => void = () => {
        /* Set by the transition fixture. */
    }
    const finished = new Promise<void>((resolve) => {
        finish = resolve
    })
    const animate = vi.fn()
    Object.defineProperty(document.documentElement, 'animate', { configurable: true, value: animate })
    Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: (update: () => void | Promise<void>) => {
            const committed = update()
            expect(screen.getByText('Mode: dark')).toBeTruthy()
            return { ready: Promise.resolve(committed), finished, skipTransition: finish }
        }
    })
    const local = selectAppearance({ mode: 'dark' }, document.documentElement)
    receive(saves[2].value)
    saves[2].resolve(saves[2].value)
    await vi.waitFor(() => expect(animate).toHaveBeenCalled())
    receive({ mode: 'light', theme: 'green' })
    finish()
    await local
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.palette).toBe('green')
})

test('appearance cards retain a return to the original scheme and theme while a save is pending', async () => {
    vi.resetModules()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined })
    const saves: { value: Appearance; resolve: (value: Appearance) => void }[] = []
    Object.defineProperty(window, 'journal', {
        configurable: true,
        value: {
            appearance: {
                initial: { mode: 'dark', theme: 'neutral' },
                select: (value: Appearance) => new Promise<Appearance>((resolve) => saves.push({ value, resolve })),
                onChange: () => () => {
                    /* No broadcasts in this local-save fixture. */
                }
            }
        }
    })
    const { initializeAppearance } = await import('../src/renderer/appearance')
    const { AppearanceSettings } = await import('../src/renderer/AppearanceSettings')
    initializeAppearance()
    const user = userEvent.setup()
    render(createElement(AppearanceSettings))
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    await user.click(screen.getByRole('radio', { name: 'Ocean' }))
    await user.click(screen.getByRole('radio', { name: 'Original' }))
    expect(saves.map(({ value }) => value)).toEqual([
        { mode: 'light', theme: 'neutral' },
        { mode: 'dark', theme: 'neutral' },
        { mode: 'dark', theme: 'blue' },
        { mode: 'dark', theme: 'neutral' }
    ])
    await act(async () => {
        for (const save of saves) save.resolve(save.value)
        await Promise.resolve()
    })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.palette).toBe('neutral')
})
