import { fromHtml } from 'hast-util-from-html'
import type { Element, Root } from 'hast'

const dimension = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined

/** Project HTML images into the Markdown image renderer; all other raw HTML stays skipped. */
export function rehypeDescriptionImages() {
    const imagesFrom = (parent: Root | Element): Element[] =>
        parent.children.flatMap((node): Element[] => {
            if (node.type !== 'element') return []
            if (node.tagName === 'img') {
                const { src, alt, title, width, height } = node.properties
                return [
                    {
                        type: 'element',
                        tagName: 'img',
                        properties: { src, alt, title, width: dimension(width), height: dimension(height) },
                        children: []
                    }
                ]
            }
            if (['script', 'style', 'iframe', 'template', 'svg', 'math'].includes(node.tagName)) return []
            return imagesFrom(node)
        })

    return (tree: Root) => {
        const visit = (parent: Root | Element) => {
            for (let index = 0; index < parent.children.length; index++) {
                const node = parent.children[index]
                if (node.type === 'raw') {
                    const images = imagesFrom(fromHtml(node.value, { fragment: true }))
                    parent.children.splice(index, 1, ...images)
                    index += images.length - 1
                } else if (node.type === 'element') visit(node)
            }
        }
        visit(tree)
    }
}
