import { expect, it } from 'vitest'
import { parsePatch, diffStats, compactDiffIndents, selectedDiffLines } from '../src/renderer/diff-model'

const patch =
    'diff --git a/view.ts b/view.ts\n--- a/view.ts\n+++ b/view.ts\n@@ -1,3 +1,3 @@\n     start\n-        before\n+            after\n     end\n@@ -10 +10 @@\n-  old\n+    new\n'
it('keeps per-hunk indentation, counts and original side coordinates without rewriting source', () => {
    const [file] = parsePatch(patch)
    expect(diffStats(file)).toEqual({ additions: 2, deletions: 2 })
    expect(compactDiffIndents(file).map((hunk) => hunk.columns)).toEqual([4, 2])
    expect(selectedDiffLines(file, { start: 1, end: 3, side: 'additions' })).toBe(
        '    start\n            after\n    end'
    )
    expect(selectedDiffLines(file, { start: 2, end: 2, side: 'deletions' })).toBe('        before')
    expect(file.additionLines[1]).toBe('            after\n')
})
it('recognizes binary and pure rename patches without manufacturing text counts', () => {
    const [binary] = parsePatch('diff --git a/image.bin b/image.bin\nBinary files a/image.bin and b/image.bin differ\n')
    expect(binary.binary).toBe(true)
    expect(diffStats(binary)).toBeNull()
    const [renamed] = parsePatch(
        'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n'
    )
    expect(renamed.name).toBe('new.txt')
    expect(diffStats(renamed)).toEqual({ additions: 0, deletions: 0 })
})

it('preserves quoted paths and a missing final newline, and rejects malformed hunks', () => {
    const [file] = parsePatch(
        'diff --git "a/old name.ts" "b/new name.ts"\nsimilarity index 80%\nrename from old name.ts\nrename to new name.ts\n--- "a/old name.ts"\n+++ "b/new name.ts"\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n'
    )
    expect(file.name).toBe('new name.ts')
    expect(file.prevName).toBe('old name.ts')
    expect(selectedDiffLines(file, { start: 1, end: 1 })).toBe('new')
    expect(parsePatch('diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ broken @@\n+line\n')).toEqual([])
})
