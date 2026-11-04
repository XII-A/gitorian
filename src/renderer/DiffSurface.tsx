import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { CodeView, CUSTOM_HEADER_SLOT_ID, type CodeViewOptions, type CodeViewRenderedItem } from '@pierre/diffs'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { codeLimits, codeTheme } from './code-highlighting'
import { compactDiffIndents, selectedDiffLines, type DiffFile } from './diff-model'
import { DiffFileHeader } from './DiffFileHeader'
import { sourceSelection } from './diff-selection'

const surfaceCSS = `
:host { --diffs-font-family:var(--font-mono); --diffs-header-font-family:var(--font-body);
 --diffs-font-size:var(--text-xs); --diffs-line-height:20px;
 --diffs-font-features:normal; --diffs-tab-size:4; --diffs-bg:var(--surface); --diffs-fg:var(--foreground);
 --diffs-addition-color-override:var(--success); --diffs-deletion-color-override:var(--danger);
 --diffs-bg-addition-override:color-mix(in oklab,var(--success) 7%,var(--surface));
 --diffs-bg-deletion-override:color-mix(in oklab,var(--danger) 6%,var(--surface));
 --diffs-bg-addition-emphasis-override:color-mix(in oklab,var(--success) 16%,var(--surface));
 --diffs-bg-deletion-emphasis-override:color-mix(in oklab,var(--danger) 15%,var(--surface));
 --diffs-fg-number-override:var(--text-secondary); --diffs-bg-separator-override:var(--surface);
 --diffs-bg-buffer-override:var(--surface); --diffs-bg-context-override:var(--surface);
 --diffs-bg-context-gutter-override:var(--surface); --diffs-bg-selection-override:var(--accent-subtle); }
[data-code] [data-line] { text-indent:calc(-1 * var(--diff-indent,0ch)); overflow:clip; tab-size:4; }
[data-separator-content] { color:var(--text-muted); font-size:var(--text-xs); }
[data-separator-wrapper], [data-separator-content] { background:var(--surface); }
[data-separator] { border-block:1px solid var(--border-subtle); }
[data-error-wrapper] { display:none; }
`

export interface DiffNavigation {
    name: string
    revision: number
}

/** Arc owns the scroll viewport; CodeView coordinates React header slots and virtualized source in that same viewport. */
export function DiffSurface({
    files,
    split,
    wrap,
    originalIndentation,
    collapsed,
    onToggleFile,
    showLineCounts,
    initialFile,
    navigation,
    onActiveFileChange,
    onFailure
}: {
    files: DiffFile[]
    split: boolean
    wrap: boolean
    originalIndentation: boolean
    collapsed: ReadonlySet<string>
    onToggleFile: (name: string) => void
    showLineCounts: boolean
    initialFile: string
    navigation?: DiffNavigation
    onActiveFileChange: (name: string) => void
    onFailure: () => void
}) {
    const viewport = useRef<HTMLDivElement>(null)
    const viewerRef = useRef<CodeView | undefined>(undefined)
    const [rendered, setRendered] = useState<CodeViewRenderedItem<undefined, undefined>[]>([])
    const inEffect = useRef(false)
    const initial = useRef(initialFile)
    initial.current = initialFile
    const activeCallback = useRef(onActiveFileChange)
    activeCallback.current = onActiveFileChange
    const latestCollapsed = useRef(collapsed)
    latestCollapsed.current = collapsed
    const versions = useRef(new Map<string, { collapsed: boolean; version: number }>())
    const fileMap = useMemo(() => new Map(files.map((file) => [file.name, file])), [files])
    const indents = useMemo(() => new Map(files.map((file) => [file.name, compactDiffIndents(file)])), [files])
    const options = useMemo<CodeViewOptions<undefined, undefined>>(
        () => ({
            preferredHighlighter: 'highlights',
            theme: codeTheme,
            diffStyle: split ? 'split' : 'unified',
            overflow: wrap ? 'wrap' : 'scroll',
            stickyHeaders: true,
            pointerEventsOnScroll: true,
            itemMetrics: { diffHeaderHeight: 48 },
            layout: { paddingTop: 0, paddingBottom: 16, gap: 0 },
            hunkSeparators: 'line-info-basic',
            lineDiffType: 'word',
            maxLineDiffLength: codeLimits.inlineDiff,
            tokenizeMaxLineLength: codeLimits.line,
            tokenizeMaxLength: codeLimits.patch,
            enableLineSelection: true,
            // The slot coordinator mounts real Arc disclosure controls in the custom header slot.
            renderCustomHeader: () => undefined,
            onSelectedLinesChange(selection) {
                if (selection) {
                    window.getSelection()?.removeAllRanges()
                    viewport.current?.focus({ preventScroll: true })
                }
            },
            unsafeCSS: surfaceCSS,
            onPostRender(node, _, phase, context) {
                if (phase === 'unmount') return
                node.dataset.diffFile = context.item.id
                const shadow = node.shadowRoot
                if (shadow?.querySelector('[data-error-message]')) {
                    queueMicrotask(onFailure)
                    return
                }
                const hunks = indents.get(context.item.id) ?? []
                for (const line of shadow?.querySelectorAll<HTMLElement>('[data-code] [data-line]') ?? []) {
                    const index = Number(line.dataset.lineIndex?.split(',')[0])
                    const indent = originalIndentation
                        ? undefined
                        : hunks.find((hunk) => index >= hunk.start && index < hunk.end)
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
        inEffect.current = true
        let current = true
        let active = initial.current
        const viewer = new CodeView(latestOptions.current, undefined, true)
        const copy = (event: ClipboardEvent) => {
            let native: string | undefined
            for (const node of root.querySelectorAll('diffs-container')) {
                if (node.shadowRoot) native = sourceSelection(node.shadowRoot)
                if (native !== undefined) break
            }
            const selection = window.getSelection()
            const selected =
                (!selection || selection.isCollapsed) && root.contains(document.activeElement)
                    ? viewer.getSelectedLines()
                    : null
            const file = selected ? files.find((file) => file.name === selected.id) : undefined
            const source =
                native ??
                (selected && file
                    ? selectedDiffLines(file, selected.range, latestOptions.current.diffStyle === 'split')
                    : undefined)
            if (source === undefined) return
            event.clipboardData?.setData('text/plain', source)
            event.preventDefault()
            void window.journal?.writeClipboardText(source).catch(() => undefined)
        }
        let unsubscribe: (() => void) | undefined
        try {
            viewer.setup(root)
            viewer.setSlotCoordinator({
                hasHeaderRenderers: true,
                hasAnnotationRenderer: false,
                hasGutterRenderer: false,
                onSnapshotChange(snapshot) {
                    if (!current) return
                    const publish = () => setRendered(snapshot?.items ?? [])
                    // CodeView must release React's slots before recycling a host. Effects already commit synchronously.
                    if (inEffect.current) publish()
                    else flushSync(publish)
                }
            })
            versions.current.clear()
            viewer.setItems(
                files.map((file) => ({
                    type: 'diff',
                    id: file.name,
                    fileDiff: file,
                    collapsed: latestCollapsed.current.has(file.name),
                    version: 0
                }))
            )
            viewerRef.current = viewer
            if (files.some((file) => file.name === initial.current))
                viewer.scrollTo({ type: 'item', id: initial.current, align: 'start', behavior: 'instant' })
            unsubscribe = viewer.subscribeToScroll((top) => {
                let low = 0,
                    high = files.length - 1
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2)
                    if ((viewer.getTopForItem(files[middle].name) ?? Infinity) <= top + 48) low = middle
                    else high = middle - 1
                }
                const next = files[low]?.name
                if (next && next !== active) {
                    active = next
                    activeCallback.current(next)
                }
            })
            document.addEventListener('copy', copy, true)
        } catch {
            onFailure()
        } finally {
            inEffect.current = false
        }
        return () => {
            current = false
            unsubscribe?.()
            document.removeEventListener('copy', copy, true)
            viewer.cleanUp()
            viewerRef.current = undefined
        }
    }, [files, onFailure])
    useEffect(() => {
        inEffect.current = true
        try {
            viewerRef.current?.setOptions(options)
            viewerRef.current?.render(true)
        } catch {
            onFailure()
        } finally {
            inEffect.current = false
        }
    }, [options, onFailure])
    useEffect(() => {
        const viewer = viewerRef.current
        if (!viewer) return
        inEffect.current = true
        try {
            const selection = viewer.getSelectedLines()
            if (selection && collapsed.has(selection.id)) viewer.clearSelectedLines()
            viewer.setItems(
                files.map((file) => {
                    const isCollapsed = collapsed.has(file.name)
                    const previous = versions.current.get(file.name)
                    const version = previous ? previous.version + Number(previous.collapsed !== isCollapsed) : 0
                    versions.current.set(file.name, { collapsed: isCollapsed, version })
                    return { type: 'diff', id: file.name, fileDiff: file, collapsed: isCollapsed, version }
                })
            )
            viewer.render(true)
        } catch {
            onFailure()
        } finally {
            inEffect.current = false
        }
    }, [files, collapsed, onFailure])
    useEffect(() => {
        if (!navigation || !fileMap.has(navigation.name)) return
        const viewer = viewerRef.current
        inEffect.current = true
        try {
            viewer?.clearSelectedLines()
            window.getSelection()?.removeAllRanges()
            viewer?.scrollTo({ type: 'item', id: navigation.name, align: 'start', behavior: 'instant' })
        } catch {
            onFailure()
        } finally {
            inEffect.current = false
        }
    }, [navigation, fileMap, onFailure])
    return (
        <>
            <ScrollArea
                className="ws-diff-scroll diff-stream"
                viewportClassName="ws-pierre-viewport"
                viewportRef={viewport}
                orientation="both"
                label="All file changes"
                fade={0}
            />
            {rendered.map((item) => {
                const file = fileMap.get(item.id)
                return file
                    ? createPortal(
                          <div slot={CUSTOM_HEADER_SLOT_ID}>
                              <DiffFileHeader
                                  file={file}
                                  collapsed={item.item.collapsed ?? false}
                                  onToggle={() => onToggleFile(file.name)}
                                  showLineCounts={showLineCounts}
                              />
                          </div>,
                          item.element,
                          item.id
                      )
                    : null
            })}
        </>
    )
}
