import { Button } from './components/arc/button/button'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cachedDiff, loadDiff } from './diff-loader'
import { DiffSkeleton } from './DiffSkeleton'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { ChangedFilePicker } from './ChangedFilePicker'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'
import { EmptyState } from './components/arc/empty-state/empty-state'
import { FileDiff, SlidersHorizontal } from 'lucide-react'
import { Switch } from './components/arc/switch/switch'
import { Popover, PopoverContent, PopoverTrigger } from './components/arc/popover/popover'
import { ChangeCounts } from './ChangeStatistics'
import { providerName, type Provider } from '../shared/provider-accounts'
import { codeLimits, loadCodeHighlighting } from './code-highlighting'
import { diffStats, type DiffFile } from './diff-model'
import { DiffSurface } from './DiffSurface'

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
    provider,
    onOpenSource
}: {
    text: string
    initialSplit?: boolean
    provider?: Provider
    onOpenSource?: () => void
}) {
    const [mode, setMode] = useState(initialSplit ? 'split' : 'unified')
    const [selected, setSelected] = useState('')
    const [wrapLines, setWrapLines] = useState(true)
    const [originalIndentation, setOriginalIndentation] = useState(false)
    const [parsed, setParsed] = useState<{ text: string; files: DiffFile[] }>()
    const [runtime, setRuntime] = useState<'ready' | 'unavailable'>()
    const [failed, setFailed] = useState<DiffFile>()
    const [copyStatus, setCopyStatus] = useState<{ file: DiffFile; status: 'copied' | 'error' }>()
    const needsParsing = text.startsWith('diff --git') && text.length <= codeLimits.patch
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
    useEffect(() => {
        let current = true
        void loadCodeHighlighting().then((result) => {
            if (current) setRuntime(result.status)
        })
        return () => {
            current = false
        }
    }, [])
    const paths = useMemo(() => files.map((file) => file.name), [files])
    const active = files.find((file) => file.name === selected) ?? files[0]
    const onFailure = useCallback(() => setFailed(active), [active])
    const ready = runtime === 'ready' && active !== failed
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
    if (!active)
        return (
            <ScrollArea className="ws-diff-scroll" orientation="both" label="Text diff" fade={0}>
                <pre className="diff-fallback">{text}</pre>
            </ScrollArea>
        )
    return (
        <div className="diff-viewer ws-diff-viewer" data-wrap={wrapLines}>
            <div className="ws-diff-tools">
                <ChangedFilePicker value={active.name} onValueChange={setSelected} paths={paths} />
                {ready && (
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
                )}
            </div>
            <section className="file-diff ws-file-diff" aria-label={`Changes in ${active.name}`}>
                <div className="ws-file-heading">
                    <code>{active.name}</code>
                    <ChangeCounts stats={diffStats(active)} />
                </div>
                {active.binary || !active.hunks.length ? (
                    <DiffEmptyState
                        title={active.binary ? 'Binary file' : 'No text changes'}
                        description={
                            active.binary
                                ? 'Binary files do not have a text diff.'
                                : 'This file contains only a rename or metadata changes.'
                        }
                        action={sourceAction}
                    />
                ) : ready ? (
                    <DiffSurface
                        file={active}
                        split={mode === 'split'}
                        wrap={wrapLines}
                        originalIndentation={originalIndentation}
                        onFailure={onFailure}
                    />
                ) : (
                    <>
                        <div className="ws-diff-notice" role="status">
                            {runtime === undefined
                                ? 'Preparing syntax highlighting'
                                : 'Showing the raw patch. Syntax highlighting is unavailable.'}
                        </div>
                        {runtime !== undefined && (
                            <div className="ws-diff-fallback-actions">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            await window.journal.writeClipboardText(active.raw)
                                            setCopyStatus({ file: active, status: 'copied' })
                                        } catch {
                                            setCopyStatus({ file: active, status: 'error' })
                                        }
                                    }}
                                >
                                    {copyStatus?.file === active
                                        ? copyStatus.status === 'copied'
                                            ? 'Patch copied'
                                            : 'Copy failed. Try again'
                                        : 'Copy patch'}
                                </Button>
                                {sourceAction}
                            </div>
                        )}
                        <ScrollArea
                            className="ws-diff-scroll"
                            orientation="both"
                            label={`Raw patch for ${active.name}`}
                            fade={0}
                        >
                            <pre className="diff-fallback">{active.raw}</pre>
                        </ScrollArea>
                    </>
                )}
            </section>
        </div>
    )
}
