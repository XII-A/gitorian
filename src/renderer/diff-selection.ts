/** Source-only native selection. Styling may crop indentation, but text never changes. */
export function selectedSource(range: Range, root: ShadowRoot): string | undefined {
    const startElement =
        range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement
    const column = startElement?.closest('code[data-code]')
    const lines = [
        ...(column ?? root).querySelectorAll<HTMLElement>('code[data-code] [data-line], :scope > [data-line]')
    ].filter((line) => range.intersectsNode(line))
    const selected: string[] = []
    for (const line of lines) {
        const contents = document.createRange()
        contents.selectNodeContents(line)
        if (range.compareBoundaryPoints(Range.START_TO_START, contents) > 0)
            contents.setStart(range.startContainer, range.startOffset)
        if (range.compareBoundaryPoints(Range.END_TO_END, contents) < 0)
            contents.setEnd(range.endContainer, range.endOffset)
        if (contents.collapsed && line.textContent) continue
        const before = document.createRange()
        before.selectNodeContents(line)
        before.setEnd(contents.startContainer, contents.startOffset)
        const start = before.toString().length
        const indent = Number(line.dataset.indentCharacters ?? 0)
        selected.push((start <= indent ? (line.textContent ?? '').slice(0, start) : '') + contents.toString())
    }
    return selected.length ? selected.join('\n') : undefined
}

export function sourceSelection(root: ShadowRoot): string | undefined {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return undefined
    const composed = selection.getComposedRanges?.({ shadowRoots: [root] })[0]
    const range = document.createRange()
    if (composed) {
        range.setStart(composed.startContainer, composed.startOffset)
        range.setEnd(composed.endContainer, composed.endOffset)
    } else if (selection.rangeCount) return selectedSource(selection.getRangeAt(0), root)
    else return undefined
    if (range.startContainer.getRootNode() !== root) return undefined
    return selectedSource(range, root)
}
