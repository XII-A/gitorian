import { writingFixture } from './writing-fixture'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WorkspaceDraft } from '../src/renderer/WorkspaceDraft'
import { sampleState } from './workspace-fixture'
import type { Command, Reply } from '../src/shared/model'

const notifications = vi.hoisted(() => ({ toast: vi.fn(), dismiss: vi.fn(), update: vi.fn() }))
vi.mock('../src/renderer/components/arc/toast-stack/toast-stack', () => ({ useToastStack: () => notifications }))
vi.mock('../src/renderer/components/arc/button/button', () => ({
    Button: ({ children, onClick, loading }: { children: React.ReactNode; onClick: () => void; loading?: boolean }) =>
        createElement('button', { onClick, disabled: loading }, children)
}))

it.each(['hub', 'workspace', 'existing'] as const)(
    'focuses the writing body after the %s writing action',
    async (action) => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
        localStorage.clear()
        const host = document.createElement('div')
        document.body.append(host)
        const root = createRoot(host)
        const state = sampleState('2026-10-05')
        const fixture = await writingFixture(state)
        const created = state.drafts[0]
        if (action !== 'existing') state.drafts = []
        let finish: ((reply: Reply) => void) | undefined
        const run = vi.fn((command: Command) => {
            expect(command).toEqual({ type: 'newDraft', week: '2026-10-05' })
            return new Promise<Reply>((resolve) => {
                finish = resolve
            })
        })
        const update = async (change: () => void) => {
            await act(async () => {
                change()
                await new Promise((resolve) => setTimeout(resolve, 100))
            })
        }
        const props = {
            state,
            week: '2026-10-05',
            notionConnected: true,
            run,
            publishTarget: null,
            onReady: vi.fn(),
            onSettings: vi.fn(),
            initialWrite: action !== 'workspace'
        }
        try {
            await update(() => root.render(createElement(WorkspaceDraft, props)))
            if (action === 'workspace') {
                expect(run).not.toHaveBeenCalled()
                const start = [...host.querySelectorAll('button')].find((button) =>
                    button.textContent?.includes('Start this week')
                )!
                await update(() => start.click())
            }
            if (action !== 'existing') {
                // Polling while creation is in flight must not start a second entry.
                await update(() => root.render(createElement(WorkspaceDraft, { ...props, state: { ...state } })))
                expect(run).toHaveBeenCalledTimes(1)
                await update(() =>
                    finish?.({
                        state: { ...state, drafts: [created] },
                        connections: { remote: false, notion: true, protectedStorage: false }
                    })
                )
            } else expect(run).not.toHaveBeenCalled()
            await update(() => undefined)
            const editor = host.querySelector<HTMLElement>('.tiptap')!
            expect(editor).not.toBeNull()
            expect(document.activeElement).toBe(editor)
            // A subsequent backend update must not steal focus from a title edit.
            const title = host.querySelector<HTMLElement>('[aria-label="Entry title"]')!
            title.focus()
            await update(() => root.render(createElement(WorkspaceDraft, { ...props, state: { ...state } })))
            await update(() => undefined)
            expect(document.activeElement).toBe(title)
        } finally {
            await update(() => root.unmount())
            await fixture.close()
            host.remove()
            vi.useRealTimers()
        }
    }
)
