// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { DiffViewer } from '../src/renderer/DiffViewer'
import { loadDiff } from '../src/renderer/diff-loader'
import type * as Highlighting from '../src/renderer/code-highlighting'

vi.mock('../src/renderer/code-highlighting', async (importOriginal) => ({
    ...(await importOriginal<typeof Highlighting>()),
    loadCodeHighlighting: () => Promise.resolve<Highlighting.CodeHighlighting>({ status: 'unavailable' })
}))
afterEach(cleanup)
it('settles unavailable highlighting to exact raw patch without initializing a second renderer', async () => {
    const patch =
        'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-const old = 1\n+const next = 2\n'
    await loadDiff(patch)
    const { container } = render(createElement(DiffViewer, { text: patch }))
    await screen.findByText('Showing raw patches. Syntax highlighting is unavailable.')
    expect(screen.getByRole('region', { name: 'Raw patch for file.ts' }).textContent).toBe(patch)
    expect(screen.getByRole('button', { name: 'Copy patch' })).toBeDefined()
    expect(screen.queryByRole('radiogroup', { name: 'Diff layout' })).toBeNull()
    expect(container.querySelector('diffs-container')).toBeNull()
})
