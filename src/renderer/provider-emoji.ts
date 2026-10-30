import { gemoji } from 'gemoji'

const aliases = new Map(gemoji.flatMap(({ names, emoji }) => names.map((name) => [name, emoji] as const)))
export function renderEmoji(text: string): string {
    return text.replace(/:([\w+-]+):/g, (shortcode, name: string) => aliases.get(name) ?? shortcode)
}

interface MarkdownNode {
    type: string
    value?: string
    children?: MarkdownNode[]
}

// Transform text nodes only: authored code and URL destinations must remain exact.
export function remarkEmoji() {
    return (tree: MarkdownNode) => {
        const visit = (node: MarkdownNode) => {
            if (node.type === 'text' && node.value) node.value = renderEmoji(node.value)
            node.children?.forEach(visit)
        }
        visit(tree)
    }
}
