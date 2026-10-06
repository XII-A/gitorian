import { useMemo, useState } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'

export function DiffViewer({ text }: { text: string }) {
    const [split, setSplit] = useState(false)
    const [selected, setSelected] = useState('')
    const files = useMemo(() => {
        if (!text.startsWith('diff --git') || text.length > 2_000_000) return []
        try {
            return parseDiff(text)
        } catch {
            return []
        }
    }, [text])
    if (!text) return <p className="muted">No text diff for this activity.</p>
    if (!files.length) return <pre className="diff-fallback">{text.slice(0, 8000)}</pre>
    return (
        <div className="diff-viewer">
            <div className="row">
                <label>
                    Changed file{' '}
                    <select
                        value={selected}
                        onChange={(event) => {
                            setSelected(event.target.value)
                        }}
                    >
                        <option value="">All files</option>
                        {files.map((file) => (
                            <option key={file.newPath} value={file.newPath}>
                                {file.newPath}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="row">
                    <input
                        type="checkbox"
                        checked={split}
                        onChange={(event) => {
                            setSplit(event.target.checked)
                        }}
                    />
                    Side by side
                </label>
            </div>
            {files
                .filter((file) => !selected || file.newPath === selected)
                .map((file) => (
                    <section key={`${file.oldPath}:${file.newPath}`} className="file-diff">
                        <h4>
                            {file.newPath} <span className="muted">{file.type}</span>
                        </h4>
                        {file.hunks.length ? (
                            <Diff viewType={split ? 'split' : 'unified'} diffType={file.type} hunks={file.hunks}>
                                {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                            </Diff>
                        ) : (
                            <p>Binary file or metadata-only change. No text diff.</p>
                        )}
                    </section>
                ))}
        </div>
    )
}
