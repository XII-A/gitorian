import { parseDiff } from 'react-diff-view'

import type { DiffRequest } from './diff-loader'
import { highlightDiff } from './diff-syntax'

self.onmessage = (event: MessageEvent<DiffRequest>) => {
    const { id } = event.data
    try {
        self.postMessage(
            event.data.type === 'parse'
                ? { files: parseDiff(event.data.text), id }
                : { id, tokens: highlightDiff(event.data.file) },
            self.location.origin
        )
    } catch {
        self.postMessage({ id }, self.location.origin)
    }
}
