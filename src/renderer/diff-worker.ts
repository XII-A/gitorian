import { parseDiff } from 'react-diff-view'

import type { DiffRequest } from './diff-loader'
import { highlightDiff } from './diff-syntax'

// This module runs in a dedicated worker; the renderer's DOM types describe `self` as Window.
const workerScope = self as unknown as {
    addEventListener: (type: 'message', listener: (event: MessageEvent<DiffRequest>) => void) => void
    postMessage: (message: unknown, transfer: Transferable[]) => void
}
workerScope.addEventListener('message', (event: MessageEvent<DiffRequest>) => {
    const { id } = event.data
    try {
        workerScope.postMessage(
            event.data.type === 'parse'
                ? { files: parseDiff(event.data.text), id }
                : { id, tokens: highlightDiff(event.data.file) },
            []
        )
    } catch {
        workerScope.postMessage({ id }, [])
    }
})
