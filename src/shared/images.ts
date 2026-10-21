import type { JournalNode } from './model'

export const imageLimits = { bytes: 5_000_000, pixels: 40_000_000, batch: 10, backup: 512 * 1024 * 1024 } as const
export const imageIdPattern = /^[a-f0-9]{64}$/
export interface JournalImage {
    id: string
    mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
    width: number
    height: number
    bytes: Uint8Array
}
export function imageExtension(mime: JournalImage['mime']): string {
    return mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1]
}
export function imageURL(id: string): string {
    return imageIdPattern.test(id) ? `journal-image://local/${id}` : ''
}
export function imageIds(document: JournalNode): string[] {
    const ids = new Set<string>()
    const visit = (node: JournalNode) => {
        if (node.type === 'image') {
            const id = node.attrs?.assetId
            if (typeof id !== 'string' || !imageIdPattern.test(id) || typeof (node.attrs?.alt ?? '') !== 'string')
                throw new Error('Invalid journal image reference')
            ids.add(id)
        }
        node.content?.forEach(visit)
    }
    visit(document)
    return [...ids]
}
