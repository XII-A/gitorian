import { useMemo, useState } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import SegmentedControl from './components/arc/segmented-control/segmented-control'
import { Select } from './components/arc/select/select'

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
    if (!text)
        return (
            <div className="ws-diff-empty">
                <p>No text diff for this activity.</p>
                <span>Reviews and metadata changes may not contain code changes.</span>
            </div>
        )
    if (!files.length) return <pre className="diff-fallback">{text.slice(0, 8000)}</pre>
    const active =
        files.find((file) => (file.newPath === '/dev/null' ? file.oldPath : file.newPath) === selected) ?? files[0]
    const path = active.newPath === '/dev/null' ? active.oldPath : active.newPath
    return (
        <div className="diff-viewer ws-diff-viewer">
            <div className="ws-diff-tools">
                <Select
                    label=""
                    aria-label="Changed file"
                    value={path}
                    onValueChange={setSelected}
                    options={files.map((file) => {
                        const name = file.newPath === '/dev/null' ? file.oldPath : file.newPath
                        return { value: name, label: name }
                    })}
                />
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
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scrollable code region needs a tab stop for keyboard scrolling. */}
                <div className="ws-diff-scroll" tabIndex={0} role="region" aria-label={`Scrollable diff for ${path}`}>
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
                </div>
            </section>
        </div>
    )
}
