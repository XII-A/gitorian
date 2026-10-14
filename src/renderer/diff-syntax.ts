import type { FileData, HunkTokens } from 'react-diff-view'
import { tokenize } from 'react-diff-view'
import refractor from 'refractor/core'
import json from 'refractor/lang/json'
import markdown from 'refractor/lang/markdown'
import sql from 'refractor/lang/sql'
import tsx from 'refractor/lang/tsx'
import yaml from 'refractor/lang/yaml'

// TSX also registers JSX and TypeScript; the core includes JavaScript and CSS.
refractor.register(tsx)
refractor.register(json)
refractor.register(markdown)
refractor.register(sql)
refractor.register(yaml)

const languages: Record<string, string> = {
    cjs: 'javascript',
    css: 'css',
    cts: 'typescript',
    js: 'javascript',
    json: 'json',
    jsonc: 'json',
    jsx: 'jsx',
    markdown: 'markdown',
    md: 'markdown',
    mjs: 'javascript',
    mts: 'typescript',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'tsx',
    webmanifest: 'json',
    yaml: 'yaml',
    yml: 'yaml'
}

export const highlightDiff = (file: FileData): HunkTokens | undefined => {
    const path = file.newPath === '/dev/null' ? file.oldPath : file.newPath
    const language = languages[path.slice(path.lastIndexOf('.') + 1).toLowerCase()]
    const lines = file.hunks.reduce((total, hunk) => total + hunk.changes.length, 0)
    if (!language || !lines || lines > 4000) {
        return undefined
    }
    try {
        return tokenize(file.hunks, { highlight: true, language, refractor })
    } catch {
        // A partial patch can be malformed. Keep its plain text readable.
        return undefined
    }
}
