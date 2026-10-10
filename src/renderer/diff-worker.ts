import { parseDiff } from 'react-diff-view'

self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
    try {
        self.postMessage({ id: event.data.id, files: parseDiff(event.data.text) })
    } catch {
        self.postMessage({ id: event.data.id, files: [] })
    }
}
