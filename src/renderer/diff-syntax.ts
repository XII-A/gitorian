import { tokenize, type FileData, type HunkTokens } from 'react-diff-view'
import refractor from 'refractor/core'
import tsx from 'refractor/lang/tsx'

// TSX also registers JSX and TypeScript; the core includes JavaScript.
refractor.register(tsx)

const languages: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    tsx: 'tsx'
}

export function highlightDiff(file: FileData): HunkTokens | undefined {
    const path = file.newPath === '/dev/null' ? file.oldPath : file.newPath
    const language = languages[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]
    const lines = file.hunks.reduce((total, hunk) => total + hunk.changes.length, 0)
    if (!language || !lines || lines > 4000) return undefined
    try {
        return tokenize(file.hunks, { highlight: true, refractor, language })
    } catch {
        // A partial patch can be malformed. Keep its plain text readable.
        return undefined
    }
}
