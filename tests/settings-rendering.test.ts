// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '../src/renderer/components/arc/button/button'
import { ExpandableCard } from '../src/renderer/components/arc/expandable-card/expandable-card'
import { ImportProgressLabel } from '../src/renderer/import-progress-label'
import { required } from '../src/shared/required'

const renderUpdate = async (update: () => void) => {
    await act(async () => {
        update()
        await Promise.resolve()
    })
}

vi.mock(import('motion/react'), async (original) => ({
    ...(await original()),
    useReducedMotion: () => true
}))

describe('settings-rendering', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    it('defers fields for 24 closed repository cards and keeps them mounted after first expansion', async () => {
        const fields = vi.fn<
            () => import('C:/Users/LENOVO/Documents/GitHub/weekly-j/node_modules/@types/react/index').DetailedReactHTMLElement<
                import('C:/Users/LENOVO/Documents/GitHub/weekly-j/node_modules/@types/react/index').InputHTMLAttributes<HTMLInputElement>,
                HTMLInputElement
            >
        >(() => createElement('input', { defaultValue: 'author@example.com' }))
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        try {
            await renderUpdate(() => {
                root.render(
                    createElement(
                        'div',
                        {},
                        Array.from({ length: 24 }, (_, index) =>
                            createElement(ExpandableCard, {
                                children: fields,
                                description: `C:/projects/repository-${index}`,
                                key: index,
                                title: `Repository ${index}`
                            })
                        )
                    )
                )
            })
            expect([fields.mock.calls.length > 0, host.querySelectorAll('input')?.length]).toStrictEqual([false, 0])
            const trigger = required(host.querySelector('button'))
            await renderUpdate(() => {
                trigger.click()
            })
            expect(host.querySelectorAll('input')).toHaveLength(1)
            const input = required(host.querySelector('input'))
            input.value = 'edited@example.com'
            await renderUpdate(() => {
                trigger.click()
            })
            expect([
                Object.is(host.querySelector('input'), input),
                Object.is(input.value, 'edited@example.com')
            ]).toStrictEqual([true, true])
        } finally {
            await renderUpdate(() => {
                root.unmount()
            })
            host.remove()
        }
    })

    it('keeps the import button sentence mounted when only its progress numbers change', async () => {
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        const render = (completed: number) => {
            root.render(
                createElement(
                    Button,
                    {},
                    createElement(ImportProgressLabel, {
                        progress: { completed, stage: 'processing', total: 24 }
                    })
                )
            )
        }
        try {
            await renderUpdate(() => {
                render(1)
            })
            const sentence = required(host.querySelector('[aria-live="polite"]'))
            const labelPhase = sentence.parentElement
            await renderUpdate(() => {
                render(2)
            })
            expect([
                Object.is(host.querySelector('[aria-live="polite"]'), sentence),
                Object.is(sentence.parentElement, labelPhase),
                Object.is(host.querySelector('.settings-progress-number .settings-sr-only')?.textContent, '2'),
                sentence.textContent?.includes('Processing repositories')
            ]).toStrictEqual([true, true, true, true])
        } finally {
            await renderUpdate(() => {
                root.unmount()
            })
            host.remove()
        }
    })
})
