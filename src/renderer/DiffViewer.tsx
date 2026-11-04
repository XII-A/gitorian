import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FileDiff } from 'lucide-react'
import { Button } from './components/arc/button/button'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { cachedDiff, loadDiff } from './diff-loader'
import { DiffSkeleton } from './DiffSkeleton'
import { providerName, type Provider } from '../shared/provider-accounts'
import { codeLimits, loadCodeHighlighting } from './code-highlighting'
import { diffStats, type DiffFile } from './diff-model'
import { DiffSurface, type DiffNavigation } from './DiffSurface'
import { DiffWorkspace } from './DiffWorkspace'
import { DiffFileHeader } from './DiffFileHeader'
import { matchesDiffFilter, type DiffFileFilter, type DiffFileList, type DiffFileOrder } from './diff-file-presentation'
import './diff-viewer.css'

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

function RawDiffStream({
    files,
    navigation,
    sourceAction,
    collapsed,
    onToggleFile,
    showLineCounts
}: {
    files: DiffFile[]
    navigation?: DiffNavigation
    sourceAction: ReactNode
    collapsed: ReadonlySet<string>
    onToggleFile: (name: string) => void
    showLineCounts: boolean
}) {
    const viewport = useRef<HTMLDivElement>(null)
    const [copyStatus, setCopyStatus] = useState<{ file: DiffFile; status: 'copied' | 'error' }>()
    useEffect(() => {
        const root = viewport.current
        if (!root || !navigation) return
        const section = [...root.querySelectorAll<HTMLElement>('[data-raw-file]')].find(
            (node) => node.dataset.rawFile === navigation.name
        )
        if (section) root.scrollTop += section.getBoundingClientRect().top - root.getBoundingClientRect().top
    }, [navigation])
    return (
        <ScrollArea
            className="ws-diff-scroll diff-raw-stream"
            viewportRef={viewport}
            label="All file patches"
            fade={0}
            orientation="both"
        >
            {files.map((file) => (
                <section
                    className="diff-raw-file"
                    data-raw-file={file.name}
                    key={file.name}
                    aria-label={`Changes in ${file.name}`}
                >
                    <DiffFileHeader
                        file={file}
                        collapsed={collapsed.has(file.name)}
                        onToggle={() => onToggleFile(file.name)}
                        showLineCounts={showLineCounts}
                    />
                    {!collapsed.has(file.name) && (
                        <>
                            <div className="diff-raw-actions">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            await window.journal.writeClipboardText(file.raw)
                                            setCopyStatus({ file, status: 'copied' })
                                        } catch {
                                            setCopyStatus({ file, status: 'error' })
                                        }
                                    }}
                                >
                                    {copyStatus?.file === file
                                        ? copyStatus.status === 'copied'
                                            ? 'Patch copied'
                                            : 'Copy failed. Try again'
                                        : 'Copy patch'}
                                </Button>
                                {sourceAction}
                            </div>
                            <pre className="diff-fallback" role="region" aria-label={`Raw patch for ${file.name}`}>
                                {file.raw}
                            </pre>
                        </>
                    )}
                </section>
            ))}
            <span className="sr-only" role="status">
                {copyStatus?.status === 'copied'
                    ? 'Patch copied'
                    : copyStatus?.status === 'error'
                      ? 'Copy failed. Try again'
                      : ''}
            </span>
        </ScrollArea>
    )
}

export function DiffViewer({
    text,
    initialSplit = false,
    detached = false,
    provider,
    onOpenSource
}: {
    text: string
    initialSplit?: boolean
    detached?: boolean
    provider?: Provider
    onOpenSource?: () => void
}) {
    const [split, setSplit] = useState(initialSplit)
    const [selected, setSelected] = useState('')
    const [navigation, setNavigation] = useState<DiffNavigation>()
    const [wrapLines, setWrapLines] = useState(true)
    const [originalIndentation, setOriginalIndentation] = useState(false)
    const [showLineCounts, setShowLineCounts] = useState(true)
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
    const [filter, setFilter] = useState<DiffFileFilter>('all')
    const [fileList, setFileList] = useState<DiffFileList>('tree')
    const [order, setOrder] = useState<DiffFileOrder>('path')
    const [parsed, setParsed] = useState<{ text: string; files: DiffFile[] }>()
    const [runtime, setRuntime] = useState<'ready' | 'unavailable'>()
    const [failed, setFailed] = useState<string>()
    const needsParsing = text.startsWith('diff --git') && text.length <= codeLimits.patch
    const files = useMemo(() => cachedDiff(text) ?? (parsed?.text === text ? parsed.files : []), [text, parsed])
    const visibleFiles = useMemo(
        () =>
            files
                .filter((file) => matchesDiffFilter(file, filter))
                .sort((a, b) => {
                    if (order === 'changes') {
                        const first = diffStats(a),
                            second = diffStats(b)
                        const delta =
                            (second?.additions ?? 0) +
                            (second?.deletions ?? 0) -
                            (first?.additions ?? 0) -
                            (first?.deletions ?? 0)
                        if (delta) return delta
                    }
                    return a.name.localeCompare(b.name)
                }),
        [files, filter, order]
    )
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
    useEffect(() => {
        let current = true
        void loadCodeHighlighting().then((result) => {
            if (current) setRuntime(result.status)
        })
        return () => {
            current = false
        }
    }, [])
    const onFailure = useCallback(() => setFailed(text), [text])
    const toggleFile = useCallback(
        (name: string) =>
            setCollapsed((previous) => {
                const next = new Set(previous)
                if (next.has(name)) next.delete(name)
                else next.add(name)
                return next
            }),
        []
    )
    const selectFile = useCallback((name: string) => {
        setCollapsed((previous) => {
            if (!previous.has(name)) return previous
            const next = new Set(previous)
            next.delete(name)
            return next
        })
        setSelected(name)
        setNavigation((previous) => ({ name, revision: (previous?.revision ?? 0) + 1 }))
    }, [])
    const active = visibleFiles.find((file) => file.name === selected) ?? visibleFiles[0]
    const ready = runtime === 'ready' && failed !== text
    const allCollapsed = visibleFiles.length > 0 && visibleFiles.every((file) => collapsed.has(file.name))
    const sourceAction = onOpenSource && (
        <Button variant="secondary" size="sm" onClick={onOpenSource}>
            {provider ? `Open on ${providerName(provider)}` : 'Open source'}
        </Button>
    )
    if (text.length > codeLimits.patch || /^(Diff is too large\.|GitHub could not provide this diff)/.test(text))
        return (
            <DiffEmptyState
                title={
                    text.includes('406')
                        ? `${provider ? providerName(provider) : 'The provider'} could not provide these changes`
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
                <pre className="diff-fallback">{text}</pre>
            </ScrollArea>
        )
    return (
        <div className="diff-viewer ws-diff-viewer diff-workspace-container" data-wrap={wrapLines}>
            <DiffWorkspace
                files={files}
                visibleFiles={visibleFiles}
                activeFile={active?.name ?? ''}
                onSelectFile={selectFile}
                split={split}
                onSplitChange={setSplit}
                wrapLines={wrapLines}
                onWrapLinesChange={setWrapLines}
                originalIndentation={originalIndentation}
                onOriginalIndentationChange={setOriginalIndentation}
                showLineCounts={showLineCounts}
                onShowLineCountsChange={setShowLineCounts}
                filter={filter}
                onFilterChange={setFilter}
                fileList={fileList}
                onFileListChange={setFileList}
                order={order}
                onOrderChange={setOrder}
                allCollapsed={allCollapsed}
                onToggleAll={() =>
                    setCollapsed((previous) => {
                        const next = new Set(previous)
                        for (const file of visibleFiles) {
                            if (allCollapsed) next.delete(file.name)
                            else next.add(file.name)
                        }
                        return next
                    })
                }
                detached={detached}
                structured={ready}
            >
                {!visibleFiles.length ? (
                    <DiffEmptyState
                        title="No matching files"
                        description="Choose another file filter or show all changes."
                        action={
                            <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>
                                Show all files
                            </Button>
                        }
                    />
                ) : ready ? (
                    <DiffSurface
                        files={visibleFiles}
                        split={split}
                        wrap={wrapLines}
                        originalIndentation={originalIndentation}
                        collapsed={collapsed}
                        onToggleFile={toggleFile}
                        showLineCounts={showLineCounts}
                        initialFile={active?.name ?? ''}
                        navigation={navigation}
                        onActiveFileChange={setSelected}
                        onFailure={onFailure}
                    />
                ) : runtime === undefined ? (
                    <DiffSkeleton label="Preparing syntax highlighting" />
                ) : (
                    <div className="diff-raw-reader">
                        <p className="diff-raw-notice" role="status">
                            Showing raw patches. Syntax highlighting is unavailable.
                        </p>
                        <RawDiffStream
                            files={visibleFiles}
                            navigation={navigation}
                            sourceAction={sourceAction}
                            collapsed={collapsed}
                            onToggleFile={toggleFile}
                            showLineCounts={showLineCounts}
                        />
                    </div>
                )}
            </DiffWorkspace>
        </div>
    )
}
