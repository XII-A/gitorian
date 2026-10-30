import { run } from './effect-fixtures'
import { journalState } from './database-fixtures'
import { run as execute } from './effect-fixtures'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useWeekHistory } from '../src/renderer/use-week-history'
import { sampleState } from './workspace-fixture'
import { gitConfiguration } from '../src/shared/activity-history'
import { remoteConfiguration } from '../src/shared/provider-accounts'
import type { State } from '../src/shared/model'
import { workspace } from './fixtures'
import * as gitModule from '../src/main/git'
import { rangeActivities } from '../src/renderer/hub-model'
import { Button } from '../src/renderer/components/arc/button/button'
Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true })
it('scopes the button to unfinished sources needed for the selected week across four repositories', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    const root = createRoot(host)
    const command = vi.fn(() => Promise.resolve(undefined))
    const state = sampleState('2026-10-05')
    state.repositories = Array.from({ length: 4 }, (_, index) => ({ ...state.repositories[0], id: `repo-${index}` }))
    state.acquisition = {}
    for (const repository of state.repositories) {
        state.acquisition[`git:${repository.id}`] = {
            status: 'idle',
            historySince: '2026-10-05',
            historyTimezone: state.settings.timezone,
            configuration: gitConfiguration(repository, state)
        }
    }
    let loading = false
    function Harness({ value, since }: { value: State; since: string }) {
        loading = useWeekHistory(value, command, since)
        return null
    }
    const render = (since = '2026-10-05') =>
        act(async () => {
            root.render(createElement(Harness, { value: state, since }))
            await Promise.resolve()
        })
    try {
        // Three repositories have finished; the last is still acquiring this week.
        state.acquisition['git:repo-3'] = { status: 'running' }
        await render()
        expect(loading).toBe(true)
        // Its results cover this week even though more background work is running.
        state.acquisition['git:repo-3'] = {
            status: 'running',
            historySince: '2026-10-05',
            historyTimezone: state.settings.timezone,
            configuration: gitConfiguration(state.repositories[3], state)
        }
        await render()
        expect(loading).toBe(false)
        // A failed missing source and an unrelated active source must not combine
        // into a perpetual week-loading indicator.
        state.acquisition['git:repo-3'] = { status: 'error', error: 'Unavailable' }
        state.acquisition['git:repo-0'].status = 'running'
        await render()
        expect(loading).toBe(false)
        state.acquisition.notion = { status: 'running' }
        await render()
        expect(loading).toBe(false)
        state.acquisition['git:repo-3'] = { status: 'idle', windowEnd: '2026-10-19' }
        await render()
        expect(loading).toBe(true)
        // Navigation to a covered week releases the previous week's indicator.
        state.acquisition['git:repo-3'].historySince = '2026-10-12'
        state.acquisition['git:repo-3'].historyTimezone = state.settings.timezone
        state.acquisition['git:repo-3'].configuration = gitConfiguration(state.repositories[3], state)
        await render('2026-10-12')
        expect(loading).toBe(false)
        for (const status of ['error', 'paused', 'cancelled', 'idle'] as const) {
            state.acquisition['git:repo-3'] = { status }
            await render()
            expect(loading).toBe(false)
        }
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
    }
})
it('shows persisted partial activity while one source is gated and clears loading when it finishes', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const apps = await Promise.all(Array.from({ length: 4 }, () => workspace()))
    const app = apps[0]
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const secondBatch = Promise.withResolvers<undefined>()
    let firstBatch: Awaited<ReturnType<typeof gitModule.indexCommits>> | undefined
    const original = gitModule.indexCommits
    const index = vi.spyOn(gitModule, 'indexCommits').mockImplementation(async (...args) => {
        if (args[0].id !== app.repository.id) return original(...args)
        if (args[3]) {
            secondBatch.resolve(undefined)
            await gate
            return firstBatch!
        }
        firstBatch = await original(...args)
        const partial = firstBatch.items.find((item) => item.title.startsWith('Pending source'))!
        return { refs: firstBatch.refs, items: [partial], history: [partial], nextOffset: 1 }
    })
    let pending: Promise<unknown> | undefined
    try {
        // Native full-page parsing belongs to git.test.ts. This scenario owns
        // partial persisted results and the loading UI through the existing index seam.
        await app.git('commit', '--allow-empty', '--date=2026-10-06T12:00:00Z', '-m', 'Pending source first activity')
        await app.git('commit', '--allow-empty', '--date=2026-10-07T12:00:00Z', '-m', 'Pending source second activity')
        for (const other of apps.slice(1)) {
            await other.git('commit', '--allow-empty', '--date=2026-10-06T12:00:00Z', '-m', 'Small repository work')
            await execute(app.service.addRepository(other.directory))
        }
        pending = execute(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await secondBatch.promise
        await vi.waitFor(
            async () => {
                const saved = await journalState(app.store)
                const completed = saved.repositories.filter(
                    (repository) => saved.acquisition?.[`git:${repository.id}`]?.historySince === '2026-10-05'
                )
                expect(completed).toHaveLength(3)
            },
            { timeout: 5000 }
        )
        const command = (command: Parameters<typeof app.service.handle>[0]) => execute(app.service.handle(command))
        function Harness({ value }: { value: State }) {
            const loading = useWeekHistory(value, command, '2026-10-05')
            const count = rangeActivities(value, '2026-10-05', '2026-10-11').length
            return createElement(
                'div',
                null,
                createElement('p', null, `${count} activities`),
                createElement(Button, { loading, 'aria-label': 'Refresh activity' }, 'Refresh activity')
            )
        }
        const render = () =>
            act(async () => {
                root.render(
                    createElement(Harness, {
                        value: (await run(app.service.reply({}, { since: '2026-10-05', until: '2026-10-11' }))).state
                    })
                )
                await Promise.resolve()
            })
        await render()
        expect(host.querySelector('p')?.textContent).toBe('4 activities')
        expect(host.querySelector('button')?.getAttribute('aria-busy')).toBe('true')
        release()
        await pending
        await render()
        expect(host.querySelector('button')?.hasAttribute('aria-busy')).toBe(false)
        expect(host.querySelector('p')?.textContent).toBe('5 activities')
        expect(
            Object.values((await journalState(app.store)).acquisition ?? {}).every(
                (status) => status.status === 'idle' && !status.windowEnd
            )
        ).toBe(true)
    } finally {
        release()
        await pending
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        host.remove()
        index.mockRestore()
        await Promise.all(apps.map((entry) => entry.close()))
    }
})
it('automatically rehydrates the same week when its journal timezone changes without rereading Git', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const app = await workspace()
    const host = document.createElement('div')
    const root = createRoot(host)
    const command = vi.fn((command: Parameters<typeof app.service.handle>[0]) => execute(app.service.handle(command)))
    const index = vi.spyOn(gitModule, 'indexCommits')
    function Harness({ value }: { value: State }) {
        useWeekHistory(value, command, '2026-10-05')
        return null
    }
    const render = () =>
        act(async () => {
            root.render(createElement(Harness, { value: (await run(app.service.reply())).state }))
            await Promise.resolve()
        })
    try {
        // This scenario owns local Git reprojection, without remote history to acquire.
        await app.store.assignProviderAccount(app.repository.id, remoteConfiguration(app.repository), {
            accountId: undefined,
            accountGeneration: undefined,
            assignment: 'explicit'
        })
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'UTC' })
        await app.git('commit', '--allow-empty', '--date=2026-10-04T22:00:00Z', '-m', 'Timezone boundary')
        await execute(app.service.handle({ type: 'loadWeek', since: '2026-10-05' }))
        await render()
        await Promise.all(command.mock.results.map((result) => result.value))
        expect(command.mock.calls.every(([input]) => input.type === 'view')).toBe(true)
        expect(rangeActivities(await journalState(app.store), '2026-10-05', '2026-10-11')).toHaveLength(0)
        index.mockClear()
        command.mockClear()
        await app.store.saveSettings({ ...app.store.config.settings, timezone: 'Europe/Istanbul' })
        await render()
        await vi.waitFor(() => expect(command).toHaveBeenCalledWith({ type: 'loadWeek', since: '2026-10-05' }))
        await Promise.all(command.mock.results.map((result) => result.value))
        expect(index).not.toHaveBeenCalled()
        expect(
            rangeActivities(await journalState(app.store), '2026-10-05', '2026-10-11').map((activity) => activity.title)
        ).toEqual(['Timezone boundary'])
        expect((await journalState(app.store)).acquisition?.[`git:${app.repository.id}`].historyTimezone).toBe(
            'Europe/Istanbul'
        )
    } finally {
        await act(async () => {
            root.unmount()
            await Promise.resolve()
        })
        index.mockRestore()
        await app.close()
    }
})
