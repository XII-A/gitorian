import type { JournalNode } from './model'
import { required } from './required'

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
export const plainText = (node: JournalNode): string =>
    node.text ?? (node.content ?? []).map(plainText).join(node.type === 'doc' ? '\n' : '')

const richText = (nodes: JournalNode[] = []): RichText[] =>
    nodes.flatMap((node) => {
        if (node.type === 'hardBreak') {
            return [{ text: { content: '\n' }, type: 'text' as const }]
        }
        if (node.type !== 'text') {
            return richText(node.content)
        }
        const marks = node.marks ?? []
        const link = marks.find((mark) => mark.type === 'link')?.attrs?.href
        return (
            (node.text ?? '').match(/[\s\S]{1,2000}/gu)?.map((content) => ({
                annotations: {
                    bold: marks.some((mark) => mark.type === 'bold'),
                    code: marks.some((mark) => mark.type === 'code'),
                    italic: marks.some((mark) => mark.type === 'italic'),
                    strikethrough: marks.some((mark) => mark.type === 'strike'),
                    underline: marks.some((mark) => mark.type === 'underline')
                },
                text: { content, ...(typeof link === 'string' ? { link: { url: link } } : {}) },
                type: 'text' as const
            })) ?? []
        )
    })

const block = (type: string, data: Record<string, unknown>): NotionBlock => ({ object: 'block', type, [type]: data })
export const toNotion = (document: JournalNode): NotionBlock[] =>
    (document.content ?? []).flatMap((node) => {
        if (node.type === 'horizontalRule') {
            return [block('divider', {})]
        }
        if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') {
            return (node.content ?? []).map((item) => {
                const [first, ...rest] = item.content ?? []
                const type = (() => {
                    if (node.type === 'taskList') {
                        return 'to_do'
                    }
                    if (node.type === 'orderedList') {
                        return 'numbered_list_item'
                    }
                    return 'bulleted_list_item'
                })()
                return block(type, {
                    rich_text: richText(first?.content),
                    ...(type === 'to_do' ? { checked: !!item.attrs?.checked } : {}),
                    ...(rest.length ? { children: toNotion({ content: rest, type: 'doc' }) } : {})
                })
            })
        }
        if (node.type === 'blockquote') {
            const [first, ...rest] = node.content ?? []
            return [
                block('quote', {
                    rich_text: richText(first?.content),
                    ...(rest.length ? { children: toNotion({ content: rest, type: 'doc' }) } : {})
                })
            ]
        }
        if (node.type === 'codeBlock') {
            return [block('code', { language: 'plain text', rich_text: richText(node.content) })]
        }
        if (node.type === 'heading') {
            return [
                block(`heading_${Math.min(3, Number(node.attrs?.level ?? 1))}`, { rich_text: richText(node.content) })
            ]
        }
        if (node.type === 'paragraph') {
            return [block('paragraph', { rich_text: richText(node.content) })]
        }
        throw new Error(`Unsupported journal formatting: ${node.type}`)
    })

const fromRichText = (values: RichText[] = []): JournalNode[] =>
    values
        .filter((value) => value.text?.content || value.plain_text)
        .map((value) => ({
            marks: [
                ...Object.entries(value.annotations ?? {})
                    .filter(
                        ([key, enabled]) =>
                            enabled && ['bold', 'italic', 'strikethrough', 'underline', 'code'].includes(key)
                    )
                    .map(([key]) => ({ type: key === 'strikethrough' ? 'strike' : key })),
                ...(value.text?.link ? [{ attrs: { href: value.text.link.url }, type: 'link' }] : [])
            ],
            text: value.text?.content ?? value.plain_text ?? '',
            type: 'text'
        }))

export const fromNotion = (blocks: NotionBlock[]): JournalNode => {
    const content: JournalNode[] = []
    for (const item of blocks) {
        const data = item[item.type] as { rich_text?: RichText[]; checked?: boolean; title?: string } | undefined
        const text = fromRichText(data?.rich_text)
        const nested = item.children?.length ? (fromNotion(item.children).content ?? []) : []
        if (
            item.type === 'paragraph' &&
            plainText({ content: text, type: 'paragraph' }) === 'Published with weekly-j' &&
            data?.rich_text?.some((value) =>
                value.text?.link?.url.startsWith('https://github.com/XII-A/weekly-j#weekly-j-operation:')
            )
        ) {
            continue
        }
        if (['bulleted_list_item', 'numbered_list_item', 'to_do'].includes(item.type)) {
            const type = (() => {
                if (item.type === 'to_do') {
                    return 'taskList'
                }
                if (item.type === 'numbered_list_item') {
                    return 'orderedList'
                }
                return 'bulletList'
            })()
            let list = content.at(-1)
            if (list?.type !== type) {
                list = { content: [], type }
                content.push(list)
            }
            required(list.content).push({
                attrs: { checked: !!data?.checked },
                content: [{ content: text, type: 'paragraph' }, ...nested],
                type: type === 'taskList' ? 'taskItem' : 'listItem'
            })
        } else if (item.type === 'divider') {
            content.push({ type: 'horizontalRule' })
        } else if (/^heading_[123]$/u.test(item.type)) {
            content.push({ attrs: { level: Number(item.type.slice(-1)) }, content: text, type: 'heading' }, ...nested)
        } else if (item.type === 'code') {
            content.push({ content: text, type: 'codeBlock' })
        } else if (item.type === 'quote') {
            content.push({ content: [{ content: text, type: 'paragraph' }, ...nested], type: 'blockquote' })
        } else if (item.type === 'paragraph') {
            content.push({ content: text, type: 'paragraph' }, ...nested)
        } else if (item.type === 'child_page') {
            content.push({
                content: [
                    {
                        marks: item.id
                            ? [
                                  {
                                      attrs: { href: `https://www.notion.so/${item.id.replaceAll('-', '')}` },
                                      type: 'link'
                                  }
                              ]
                            : [],
                        text: data?.title ?? 'Child page',
                        type: 'text'
                    }
                ],
                type: 'paragraph'
            })
        } else {
            content.push(
                {
                    content: [
                        {
                            text: `[${item.type === 'toggle' ? plainText({ content: text, type: 'paragraph' }) : `Unsupported content: ${item.type} — open in Notion`}]`,
                            type: 'text'
                        }
                    ],
                    type: 'paragraph'
                },
                ...nested
            )
        }
    }
    return { content: content.length ? content : [{ type: 'paragraph' }], type: 'doc' }
}
