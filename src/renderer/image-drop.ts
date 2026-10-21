import type { EditorView } from '@tiptap/pm/view'

/** Block edges are valid insertion targets, including the blank space after the last sentence. */
export function imageDropTarget(view: EditorView, y: number): { position: number; y: number } {
    let target = { position: view.state.doc.content.size, y: view.dom.getBoundingClientRect().bottom }
    let distance = Infinity
    view.state.doc.forEach((node, position) => {
        const element = view.nodeDOM(position)
        if (!(element instanceof HTMLElement)) return
        const rect = element.getBoundingClientRect()
        for (const edge of [
            { position, y: rect.top },
            { position: position + node.nodeSize, y: rect.bottom }
        ]) {
            const next = Math.abs(y - edge.y)
            if (next <= distance) {
                distance = next
                target = edge
            }
        }
    })
    return target
}

export function attachImageDrop(
    view: EditorView,
    zone: HTMLElement,
    host: HTMLElement,
    insert: (files: File[], position: number) => void,
    guide: (top?: number) => void
): () => void {
    const hasFiles = (event: DragEvent) =>
        !!event.dataTransfer &&
        (Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0)
    const over = (event: DragEvent) => {
        if (!hasFiles(event) || !view.editable) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        guide(imageDropTarget(view, event.clientY).y - host.getBoundingClientRect().top)
    }
    const drop = (event: DragEvent) => {
        if (!hasFiles(event) || !view.editable) return
        event.preventDefault()
        event.stopPropagation()
        const target = imageDropTarget(view, event.clientY)
        guide()
        insert(Array.from(event.dataTransfer!.files), target.position)
    }
    const leave = (event: DragEvent) => {
        if (!zone.contains(event.relatedTarget as Node | null)) guide()
    }
    const end = () => guide()
    zone.addEventListener('dragover', over, true)
    zone.addEventListener('drop', drop, true)
    zone.addEventListener('dragleave', leave)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
        zone.removeEventListener('dragover', over, true)
        zone.removeEventListener('drop', drop, true)
        zone.removeEventListener('dragleave', leave)
        window.removeEventListener('dragend', end)
        window.removeEventListener('drop', end)
        guide()
    }
}
