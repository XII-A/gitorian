import { test, expect } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAppearance } from '../src/main/appearance'
import { normalizeAppearance, resolveAppearance } from '../src/shared/appearance'

test('appearance normalization and explicit/system resolution', () => {
    expect(normalizeAppearance({ mode: 'sepia', theme: 'red' })).toEqual({ mode: 'dark', theme: 'neutral' })
    expect(resolveAppearance({ mode: 'light', theme: 'blue' }, true)).toBe('light')
    expect(resolveAppearance({ mode: 'system', theme: 'blue' }, false)).toBe('light')
    expect(resolveAppearance({ mode: 'system', theme: 'blue' }, true)).toBe('dark')
})
test('device appearance is durable, ordered, and retains its saved value after a failed write', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gitorian-appearance-'))
    const path = join(folder, 'appearance.json')
    try {
        const store = await openAppearance(path)
        expect(store.get()).toEqual({ mode: 'dark', theme: 'neutral' })
        await Promise.all([
            store.select({ mode: 'light', theme: 'violet' }),
            store.select({ mode: 'system', theme: 'green' })
        ])
        expect((await openAppearance(path)).get()).toEqual({ mode: 'system', theme: 'green' })
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(store.get())
        await mkdir(`${path}.tmp`)
        await expect(store.select({ mode: 'dark', theme: 'blue' })).rejects.toThrow()
        expect(store.get()).toEqual({ mode: 'system', theme: 'green' })
        await rm(`${path}.tmp`, { recursive: true })
        await store.select({ mode: 'light', theme: 'rose' })
        expect((await openAppearance(path)).get()).toEqual({ mode: 'light', theme: 'rose' })
        await rm(path)
        await mkdir(path)
        const unreadable = await openAppearance(path)
        expect(unreadable.get()).toEqual({ mode: 'dark', theme: 'neutral' })
        await expect(unreadable.select({ mode: 'light', theme: 'blue' })).rejects.toThrow()
        await rm(path, { recursive: true })
        await writeFile(path, '{broken')
        expect((await openAppearance(path)).get()).toEqual({ mode: 'dark', theme: 'neutral' })
    } finally {
        await rm(folder, { recursive: true, force: true })
    }
})
