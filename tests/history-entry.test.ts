// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../src/shared/model'
import { useHistoryEntry } from '../src/renderer/use-history-entry'

const readEntry = vi.fn<(id: string, restoreId?: string) => Promise<HistoryEntry | undefined>>()
const original = Object.getOwnPropertyDescriptor(window, 'journal')
beforeEach(() => {
    readEntry.mockReset()
    Object.defineProperty(window, 'journal', { configurable: true, value: { readEntry } })
})
afterEach(() => {
    cleanup()
    if (original) Object.defineProperty(window, 'journal', original)
    else Reflect.deleteProperty(window, 'journal')
})
const entry = (title: string): HistoryEntry => ({
    id: 'local:week',
    title,
    date: '2026-10-26',
    week: '2026-10-26',
    excerpt: title,
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] }
})

it.each(['generation', 'version'])('ignores a late document after its %s changes', async (change) => {
    let oldRead!: (entry: HistoryEntry) => void
    let newRead!: (entry: HistoryEntry) => void
    readEntry
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    oldRead = resolve
                })
        )
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    newRead = resolve
                })
        )
    const { result, rerender } = renderHook(
        ({ generation, version }) => useHistoryEntry('local:week', true, generation, version),
        {
            initialProps: { generation: 'before', version: 1 }
        }
    )
    rerender({ generation: change === 'generation' ? 'after' : 'before', version: change === 'version' ? 2 : 1 })
    await act(async () => {
        oldRead(entry('Old writing'))
        await Promise.resolve()
    })
    expect(result.current.entry).toBeUndefined()
    expect(result.current.loading).toBe(true)
    await act(async () => {
        newRead(entry('Current writing'))
        await Promise.resolve()
    })
    await waitFor(() => expect(result.current.entry?.title).toBe('Current writing'))
    expect(result.current.loading).toBe(false)
})

it('retries a failed read when the reader is reopened', async () => {
    readEntry.mockRejectedValueOnce(new Error('Read interrupted')).mockResolvedValueOnce(entry('Recovered writing'))
    const { result, rerender } = renderHook(({ reading }) => useHistoryEntry('local:week', reading, 'journal', 1), {
        initialProps: { reading: true }
    })
    await waitFor(() => expect(result.current.error).toMatch(/Could not open/))
    rerender({ reading: false })
    rerender({ reading: true })
    await waitFor(() => expect(result.current.entry?.title).toBe('Recovered writing'))
    expect(result.current.error).toBeUndefined()
})
