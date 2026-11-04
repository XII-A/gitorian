import { parsePatch } from './diff-model'
import type { DiffRequest } from './diff-loader'

self.onmessage = (event: MessageEvent<DiffRequest>) => {
    self.postMessage({ id: event.data.id, files: parsePatch(event.data.text) })
}
