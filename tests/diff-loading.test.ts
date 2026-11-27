import { expect, it } from 'vitest'
import { diffSnapshot, loadDiff, subscribeDiff } from '../src/renderer/diff-loader'

const patch = (name: string) =>
    `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-old\n+new\n`

it('shares a pending preparation and returns exact source from both files', async () => {
    const text = patch('first.ts') + patch('second.ts')
    const first = loadDiff(text)
    const second = loadDiff(text)
    expect(second).toBe(first)
    const files = await first
    expect(files.map(({ name, additionLines }) => [name, additionLines])).toEqual([
        ['first.ts', ['new\n']],
        ['second.ts', ['new\n']]
    ])
    expect(diffSnapshot(text)).toMatchObject({ complete: true, files })
})

it('limits background work and releases an abandoned foreground preparation', async () => {
    const first = loadDiff(patch('one.ts'), 'background')
    const second = loadDiff(patch('two.ts'), 'background')
    const skipped = loadDiff(patch('skipped.ts'), 'background')
    const text = patch('clicked.ts')
    const stop = subscribeDiff(text, () => {
        throw new Error('Abandoned work must not notify an unsubscribed reader')
    })
    const clicked = loadDiff(text)
    stop()
    expect(await clicked).toEqual([])
    expect(diffSnapshot(text)).toBeUndefined()
    expect(await skipped).toEqual([])
    await Promise.all([first, second])
    expect((await loadDiff(text)).map((file) => file.name)).toEqual(['clicked.ts'])
})
