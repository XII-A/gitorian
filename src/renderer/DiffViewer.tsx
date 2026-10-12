import { Button } from './components/arc/button/button'
import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react'
import { Diff, Hunk, type FileData, type HunkTokens } from 'react-diff-view'
import { cachedDiff, cachedDiffTokens, loadDiff, loadDiffTokens } from './diff-loader'
import { DiffSkeleton } from './DiffSkeleton'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { ChangedFilePicker } from './ChangedFilePicker'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { FileDiff, SlidersHorizontal } from 'lucide-react'
import { Switch } from './components/arc/switch/switch'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { presentationTokens, selectedSource } from './diff-presentation'

function DiffEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
    return (
        <ScrollArea className="ws-diff-state" viewportClassName="ws-diff-state-viewport" label="Diff status" fade={0}>
            <EmptyState
                iconVariant="plain"
                icon={<FileDiff size={32} strokeWidth={1.5} aria-hidden="true" />}
                title={title}
                description={description}
                action={action}
            />
        </ScrollArea>
    )
}

export function DiffViewer({
    text,
    initialSplit = false,
    onOpenSource
}: {
    text: string
    initialSplit?: boolean
    onOpenSource?: () => void
}) {
    const [mode, setMode] = useState(initialSplit ? 'split' : 'unified')
    const [selected, setSelected] = useState('')
    const [wrapLines, setWrapLines] = useState(true)
    const [originalIndentation, setOriginalIndentation] = useState(false)
    const [parsed, setParsed] = useState<{ text: string; files: Awaited<ReturnType<typeof loadDiff>> }>()
    const [highlighted, setHighlighted] = useState<{ file: FileData; tokens?: HunkTokens }>()
    const needsParsing = text.startsWith('diff --git') && text.length <= 2_000_000
    const files = useMemo(() => cachedDiff(text) ?? (parsed?.text === text ? parsed.files : []), [text, parsed])
    useEffect(() => {
        if (!needsParsing) return
        let current = true
        void loadDiff(text).then((files) => {
            if (current) setParsed({ text, files })
        })
        return () => {
            current = false
        }
    }, [text, needsParsing])
    const paths = useMemo(
        () => files.map((file) => (file.newPath === '/dev/null' ? file.oldPath : file.newPath)),
        [files]
    )
    const active = useMemo(
        () =>
            files.find((file) => (file.newPath === '/dev/null' ? file.oldPath : file.newPath) === selected) ?? files[0],
        [files, selected]
    )
    useEffect(() => {
        if (!active) return
        let current = true
        void loadDiffTokens(active).then((tokens) => {
            if (current) setHighlighted({ file: active, tokens })
        })
        return () => {
            current = false
        }
    }, [active])
    const tokens = active
        ? (cachedDiffTokens(active) ?? (highlighted?.file === active ? highlighted.tokens : undefined))
        : undefined
    const lineCount = useMemo(
        () => active?.hunks.reduce((total, hunk) => total + hunk.changes.length, 0) ?? 0,
        [active]
    )
    const displayTokens = useMemo(
        () => (active && lineCount <= 4000 ? presentationTokens(active, tokens, !originalIndentation) : undefined),
        [active, tokens, originalIndentation, lineCount]
    )
    const unavailable =
        text.length > 2_000_000 || /^(Diff is too large\.|GitHub could not provide this diff)/.test(text)
    const sourceAction = onOpenSource && (
        <Button variant="secondary" size="sm" onClick={onOpenSource}>
            Open on GitHub
        </Button>
    )
    if (unavailable)
        return (
            <DiffEmptyState
                title={
                    text.includes('406')
                        ? 'GitHub could not provide these changes'
                        : 'These changes are too large to display here'
                }
                description="The activity is retained in your journal. View the changes at the source."
                action={sourceAction}
            />
        )
    if (!text)
        return (
            <DiffEmptyState
                title="No text diff"
                description="Reviews and metadata updates may not include code changes."
                action={sourceAction}
            />
        )
    if (needsParsing && !cachedDiff(text) && parsed?.text !== text) return <DiffSkeleton label="Preparing changes" />
    if (!files.length)
        return (
            <ScrollArea className="ws-diff-scroll" orientation="both" label="Text diff" fade={0}>
                <pre className="diff-fallback">{text.slice(0, 8000)}</pre>
            </ScrollArea>
        )
    if (!active) return null
    const path = active.newPath === '/dev/null' ? active.oldPath : active.newPath
    return (
        <div className="diff-viewer ws-diff-viewer" data-wrap={wrapLines}>
            <div className="ws-diff-tools">
                <ChangedFilePicker value={path} onValueChange={setSelected} paths={paths} />
                <div className="ws-diff-actions">
                    <SegmentedControl
                        className="ws-diff-layout"
                        size="sm"
                        label="Diff layout"
                        value={mode}
                        onValueChange={setMode}
                        options={[
                            { value: 'unified', label: 'Unified' },
                            { value: 'split', label: 'Split' }
                        ]}
                    />
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                className="ws-diff-settings"
                                variant="ghost"
                                size="sm"
                                aria-label="Diff display options"
                                title="Display options"
                            >
                                <SlidersHorizontal size={16} aria-hidden="true" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="ws-diff-options" aria-label="Diff display options">
                            <Switch label="Wrap lines" checked={wrapLines} onCheckedChange={setWrapLines} />
                            <Switch
                                label="Original indentation"
                                checked={originalIndentation}
                                onCheckedChange={setOriginalIndentation}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
            <section
                className="file-diff ws-file-diff"
                aria-label={`Changes in ${path}`}
                onCopy={(event) => {
                    const selection = window.getSelection()
                    if (!selection?.rangeCount || !event.clipboardData) return
                    const source = selectedSource(selection.getRangeAt(0), event.currentTarget)
                    if (source !== undefined) {
                        event.clipboardData.setData('text/plain', source)
                        event.preventDefault()
                    }
                }}
            >
                <div className="ws-file-heading">
                    <code>{path}</code>
                    <span>
                        {files.length} {files.length === 1 ? 'file' : 'files'}
                    </span>
                </div>
                <ScrollArea
                    className="ws-diff-scroll"
                    orientation="both"
                    label={`Scrollable diff for ${path}`}
                    fade={0}
                >
                    {lineCount > 4000 ? (
                        <div className="ws-diff-empty">
                            <p>This file has more than 4,000 diff lines.</p>
                            <span>View the full changes at the source.</span>
                            {sourceAction}
                        </div>
                    ) : active.hunks.length ? (
                        <Diff
                            viewType={mode === 'split' ? 'split' : 'unified'}
                            diffType={active.type}
                            hunks={active.hunks}
                            tokens={displayTokens}
                            renderToken={(token, renderDefault, index) =>
                                token.type === 'source-line' ? (
                                    <span
                                        key={index}
                                        className="ws-diff-source-line"
                                        data-indent-characters={token.indentCharacters}
                                        style={{ '--diff-indent': `${token.indentColumns}ch` } as CSSProperties}
                                    >
                                        {token.children?.map(renderDefault)}
                                    </span>
                                ) : (
                                    renderDefault(token, index)
                                )
                            }
                        >
                            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                        </Diff>
                    ) : (
                        <p>Binary file or metadata change. No text diff.</p>
                    )}
                </ScrollArea>
            </section>
        </div>
    )
}
