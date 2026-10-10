import { useMemo, useState } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { ChangedFilePicker } from './ChangedFilePicker'
import { ScrollArea } from './components/arc/scroll-area/scroll-area'

export function DiffViewer({ text, initialSplit = false }: { text: string; initialSplit?: boolean }) {
    const [mode, setMode] = useState(initialSplit ? 'split' : 'unified')
    const [selected, setSelected] = useState('')
    const files = useMemo(() => {
        if (!text.startsWith('diff --git') || text.length > 2_000_000) return []
        try {
            return parseDiff(text)
        } catch {
            return []
        }
    }, [text])
    const paths = useMemo(
        () => files.map((file) => (file.newPath === '/dev/null' ? file.oldPath : file.newPath)),
        [files]
    )
    if (!text)
        return (
            <div className="ws-diff-empty">
                <p>No text diff for this activity.</p>
                <span>Reviews and metadata changes may not contain code changes.</span>
            </div>
        )
    if (!files.length)
        return (
            <ScrollArea className="ws-diff-scroll" orientation="both" label="Text diff" fade={0}>
                <pre className="diff-fallback">{text.slice(0, 8000)}</pre>
            </ScrollArea>
        )
    const active =
        files.find((file) => (file.newPath === '/dev/null' ? file.oldPath : file.newPath) === selected) ?? files[0]
    const path = active.newPath === '/dev/null' ? active.oldPath : active.newPath
    return (
        <div className="diff-viewer ws-diff-viewer">
            <div className="ws-diff-tools">
                <ChangedFilePicker value={path} onValueChange={setSelected} paths={paths} />
                <SegmentedControl
                    label="Diff layout"
                    value={mode}
                    onValueChange={setMode}
                    options={[
                        { value: 'unified', label: 'Unified' },
                        { value: 'split', label: 'Split' }
                    ]}
                />
            </div>
            <section className="file-diff ws-file-diff" aria-label={`Changes in ${path}`}>
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
                    {active.hunks.length ? (
                        <Diff
                            viewType={mode === 'split' ? 'split' : 'unified'}
                            diffType={active.type}
                            hunks={active.hunks}
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
