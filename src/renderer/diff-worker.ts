import { parseDiff } from 'react-diff-view'
import { highlightDiff } from './diff-syntax'
import type { DiffRequest } from './diff-loader'

self.onmessage = (event: MessageEvent<DiffRequest>) => {
    const { id } = event.data
    try {
        self.postMessage(
            event.data.type === 'parse'
                ? { id, files: parseDiff(event.data.text) }
                : { id, tokens: highlightDiff(event.data.file) }
        )
    } catch {
        self.postMessage({ id })
    }
}
