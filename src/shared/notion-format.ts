import type { JournalNode } from './model'

export interface RichText {
    type: 'text'
    text: { content: string; link?: { url: string } }
    annotations?: Record<string, boolean>
    plain_text?: string
}
export interface NotionBlock {
    id?: string
    type: string
    has_children?: boolean
    children?: NotionBlock[]
    [key: string]: unknown
}
export function plainText(node: JournalNode): string {
    return node.text ?? (node.content ?? []).map(plainText).join(node.type === 'doc' ? '\n' : '')
}
function richText(nodes: JournalNode[] = []): RichText[] {
    return nodes.flatMap((node) => {
        if (node.type === 'hardBreak') return [{ type: 'text' as const, text: { content: '\n' } }]
        if (node.type !== 'text') return richText(node.content)
        const marks = node.marks ?? []
        const link = marks.find((mark) => mark.type === 'link')?.attrs?.href
        return (
            (node.text ?? '').match(/[\s\S]{1,2000}/g)?.map((content) => ({
                type: 'text' as const,
                text: { content, ...(typeof link === 'string' ? { link: { url: link } } : {}) },
                annotations: {
                    bold: marks.some((mark) => mark.type === 'bold'),
                    italic: marks.some((mark) => mark.type === 'italic'),
                    strikethrough: marks.some((mark) => mark.type === 'strike'),
                    underline: marks.some((mark) => mark.type === 'underline'),
                    code: marks.some((mark) => mark.type === 'code')
                }
            })) ?? []
        )
    })
}
function block(type: string, data: Record<string, unknown>): NotionBlock {
    return { object: 'block', type, [type]: data }
}
export function toNotion(document: JournalNode, uploads?: Record<string, string>): NotionBlock[] {
    return (document.content ?? []).flatMap((node) => {
        if (node.type === 'image') {
            const id = node.attrs?.assetId
            if (typeof id !== 'string' || typeof (node.attrs?.alt ?? '') !== 'string')
                throw new Error('Invalid journal image')
            if (uploads && !uploads[id]) throw new Error('A journal image has not been uploaded')
            return [
                block('image', {
                    ...(uploads
                        ? { type: 'file_upload', file_upload: { id: uploads[id] } }
                        : { type: 'asset', asset: { id } }),
                    caption: richText(node.attrs?.alt ? [{ type: 'text', text: node.attrs.alt as string }] : [])
                })
            ]
        }
        if (node.type === 'toggle') {
            const [summary, contents] = node.content ?? []
            return [
                block('toggle', {
                    rich_text: richText(summary?.content),
                    children: toNotion({ type: 'doc', content: contents?.content ?? [] }, uploads)
                })
            ]
        }
        if (node.type === 'horizontalRule') return [block('divider', {})]
        if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
            return (node.content ?? []).map((item) => {
                const [first, ...rest] = item.content ?? []
                const type =
                    node.type === 'taskList'
                        ? 'to_do'
                        : node.type === 'orderedList'
                          ? 'numbered_list_item'
                          : 'bulleted_list_item'
                return block(type, {
                    rich_text: richText(first?.content),
                    ...(type === 'to_do' ? { checked: !!item.attrs?.checked } : {}),
                    ...(rest.length ? { children: toNotion({ type: 'doc', content: rest }, uploads) } : {})
                })
            })
        }
        if (node.type === 'blockquote') {
            const [first, ...rest] = node.content ?? []
            const children = first?.type === 'image' ? node.content! : rest
            return [
                block('quote', {
                    rich_text: richText(first?.type === 'image' ? [] : first?.content),
                    ...(children.length ? { children: toNotion({ type: 'doc', content: children }, uploads) } : {})
                })
            ]
        }
        if (node.type === 'codeBlock')
            return [block('code', { rich_text: richText(node.content), language: 'plain text' })]
        if (node.type === 'heading')
            return [
                block(`heading_${Math.min(4, Number(node.attrs?.level ?? 1))}`, { rich_text: richText(node.content) })
            ]
        if (node.type === 'paragraph') return [block('paragraph', { rich_text: richText(node.content) })]
        throw new Error(`Unsupported journal formatting: ${node.type}`)
    })
}
function fromRichText(values: RichText[] = []): JournalNode[] {
    return values
        .filter((value) => value.text?.content || value.plain_text)
        .map((value) => ({
            type: 'text',
            text: value.text?.content ?? value.plain_text ?? '',
            marks: [
                ...Object.entries(value.annotations ?? {})
                    .filter(
                        ([key, enabled]) =>
                            enabled && ['bold', 'italic', 'strikethrough', 'underline', 'code'].includes(key)
                    )
                    .map(([key]) => ({ type: key === 'strikethrough' ? 'strike' : key })),
                ...(value.text?.link ? [{ type: 'link', attrs: { href: value.text.link.url } }] : [])
            ]
        }))
}
export function fromNotion(blocks: NotionBlock[]): JournalNode {
    const content: JournalNode[] = []
    for (const item of blocks) {
        const data = item[item.type] as { rich_text?: RichText[]; checked?: boolean; title?: string } | undefined
        const text = fromRichText(data?.rich_text)
        const nested = item.children?.length ? (fromNotion(item.children).content ?? []) : []
        if (
            item.type === 'paragraph' &&
            plainText({ type: 'paragraph', content: text }) === 'Published with weekly-j' &&
            data?.rich_text?.some((value) =>
                value.text?.link?.url.startsWith('https://github.com/XII-A/weekly-j#weekly-j-operation:')
            )
        )
            continue
        if (item.type === 'image' && typeof item.managedAssetId === 'string') {
            const image = item.image as { caption?: RichText[] }
            content.push({
                type: 'image',
                attrs: {
                    assetId: item.managedAssetId,
                    alt: plainText({ type: 'paragraph', content: fromRichText(image.caption) })
                }
            })
        } else if (['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(item.type)) {
            const type =
                item.type === 'to_do' ? 'taskList' : item.type === 'numbered_list_item' ? 'orderedList' : 'bulletList'
            let list = content.at(-1)
            if (list?.type !== type) {
                list = { type, content: [] }
                content.push(list)
            }
            list.content!.push({
                type: type === 'taskList' ? 'taskItem' : 'listItem',
                attrs: { checked: !!data?.checked },
                content: [{ type: 'paragraph', content: text }, ...nested]
            })
        } else if (item.type === 'divider') content.push({ type: 'horizontalRule' })
        else if (/^heading_[1234]$/.test(item.type))
            content.push({ type: 'heading', attrs: { level: Number(item.type.slice(-1)) }, content: text }, ...nested)
        else if (item.type === 'toggle')
            content.push({
                type: 'toggle',
                content: [
                    { type: 'toggleSummary', content: text },
                    { type: 'toggleContent', content: nested.length ? nested : [{ type: 'paragraph' }] }
                ]
            })
        else if (item.type === 'code') content.push({ type: 'codeBlock', content: text })
        else if (item.type === 'quote')
            content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: text }, ...nested] })
        else if (item.type === 'paragraph') content.push({ type: 'paragraph', content: text }, ...nested)
        else if (item.type === 'child_page')
            content.push({
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: data?.title ?? 'Child page',
                        marks: item.id
                            ? [
                                  {
                                      type: 'link',
                                      attrs: { href: `https://www.notion.so/${item.id.replaceAll('-', '')}` }
                                  }
                              ]
                            : []
                    }
                ]
            })
        else
            content.push(
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: `[${item.type === 'toggle' ? plainText({ type: 'paragraph', content: text }) : `Unsupported content: ${item.type} — open in Notion`}]`
                        }
                    ]
                },
                ...nested
            )
    }
    return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
