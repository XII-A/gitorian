import { useEffect, useMemo, useRef } from 'react'
import { CodeView, type CodeViewOptions } from '@pierre/diffs'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { codeLimits, codeTheme } from './code-highlighting'
import { compactDiffIndents, selectedDiffLines, type DiffFile } from './diff-model'
import { sourceSelection } from './diff-selection'

const surfaceCSS = `
:host { --diffs-font-family:var(--font-mono); --diffs-font-size:var(--text-xs); --diffs-line-height:20px;
 --diffs-font-features:normal; --diffs-tab-size:4; --diffs-bg:var(--surface); --diffs-fg:var(--foreground);
 --diffs-addition-color-override:var(--success); --diffs-deletion-color-override:var(--danger);
 --diffs-bg-addition-override:color-mix(in oklab,var(--success) 7%,var(--surface));
 --diffs-bg-deletion-override:color-mix(in oklab,var(--danger) 6%,var(--surface));
 --diffs-bg-addition-emphasis-override:color-mix(in oklab,var(--success) 16%,var(--surface));
 --diffs-bg-deletion-emphasis-override:color-mix(in oklab,var(--danger) 15%,var(--surface));
 --diffs-fg-number-override:var(--text-secondary); --diffs-bg-separator-override:var(--surface-muted);
 --diffs-bg-selection-override:var(--accent-subtle); }
[data-code] [data-line] { text-indent:calc(-1 * var(--diff-indent,0ch)); overflow:clip; tab-size:4; }
[data-error-wrapper] { display:none; }
`

export function DiffSurface({
    file,
    split,
    wrap,
    originalIndentation,
    onFailure
}: {
    file: DiffFile
    split: boolean
    wrap: boolean
    originalIndentation: boolean
    onFailure: () => void
}) {
    const viewport = useRef<HTMLDivElement>(null)
    const viewerRef = useRef<CodeView | undefined>(undefined)
    const indents = useMemo(() => compactDiffIndents(file), [file])
    const options = useMemo<CodeViewOptions<undefined, undefined>>(
        () => ({
            preferredHighlighter: 'highlights',
            theme: codeTheme,
            diffStyle: split ? 'split' : 'unified',
            overflow: wrap ? 'wrap' : 'scroll',
            disableFileHeader: true,
            hunkSeparators: 'line-info-basic',
            lineDiffType: 'word',
            maxLineDiffLength: codeLimits.inlineDiff,
            tokenizeMaxLineLength: codeLimits.line,
            tokenizeMaxLength: codeLimits.patch,
            enableLineSelection: true,
            onSelectedLinesChange(selection) {
                if (selection) viewport.current?.focus({ preventScroll: true })
            },
            unsafeCSS: surfaceCSS,
            onPostRender(node, _, phase) {
                if (phase === 'unmount') return
                const shadow = node.shadowRoot
                if (shadow?.querySelector('[data-error-message]')) {
                    queueMicrotask(onFailure)
                    return
                }
                for (const line of shadow?.querySelectorAll<HTMLElement>('[data-code] [data-line]') ?? []) {
                    const index = Number(line.dataset.lineIndex?.split(',')[0])
                    const indent = originalIndentation
                        ? undefined
                        : indents.find((hunk) => index >= hunk.start && index < hunk.end)
                    line.style.setProperty('--diff-indent', `${indent?.columns ?? 0}ch`)
                    line.dataset.indentCharacters = String(indent?.characters ?? 0)
                }
            }
        }),
        [split, wrap, originalIndentation, indents, onFailure]
    )
    const latestOptions = useRef(options)
    latestOptions.current = options
    useEffect(() => {
        const root = viewport.current
        if (!root) return
        root.scrollTop = 0
        const viewer = new CodeView(latestOptions.current)
        const copy = (event: ClipboardEvent) => {
            const shadow = root.querySelector('diffs-container')?.shadowRoot
            const native = shadow ? sourceSelection(shadow) : undefined
            const selection = window.getSelection()
            const selected =
                (!selection || selection.isCollapsed) && root.contains(document.activeElement)
                    ? viewer.getSelectedLines()
                    : null
            const source = native ?? (selected ? selectedDiffLines(file, selected.range) : undefined)
            if (source === undefined) return
            event.clipboardData?.setData('text/plain', source)
            event.preventDefault()
            // Chromium normalizes ClipboardEvent text to CRLF on Windows; the native writer preserves source LF.
            void window.journal?.writeClipboardText(source).catch(() => undefined)
        }
        try {
            viewer.setup(root)
            viewer.setItems([{ type: 'diff', id: file.name, fileDiff: file }])
            viewerRef.current = viewer
            // Native text selection may leave focus outside the shadow tree.
            document.addEventListener('copy', copy, true)
        } catch {
            onFailure()
        }
        return () => {
            document.removeEventListener('copy', copy, true)
            viewer.cleanUp()
            viewerRef.current = undefined
        }
    }, [file, onFailure])
    useEffect(() => {
        viewerRef.current?.setOptions(options)
        viewerRef.current?.render(true)
    }, [options])
    return (
        <ScrollArea
            className="ws-diff-scroll"
            viewportClassName="ws-pierre-viewport"
            viewportRef={viewport}
            orientation="both"
            label={`Scrollable diff for ${file.name}`}
            fade={0}
        />
    )
}
