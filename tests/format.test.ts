import { expect, it } from 'vitest'
import { fromNotion, plainText, toNotion } from '../src/shared/notion-format'
import type { JournalNode } from '../src/shared/model'

it('round-trips the accepted formatting including nested lists, links, marks, quotes and code', () => {
    const formatted: JournalNode = {
        type: 'doc',
        content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Week' }] },
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: 'Learning',
                        marks: [
                            { type: 'bold' },
                            { type: 'italic' },
                            { type: 'underline' },
                            { type: 'strike' },
                            { type: 'code' },
                            { type: 'link', attrs: { href: 'https://github.com/example/project' } }
                        ]
                    }
                ]
            },
            {
                type: 'bulletList',
                content: [
                    {
                        type: 'listItem',
                        content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
                            {
                                type: 'orderedList',
                                content: [
                                    {
                                        type: 'listItem',
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            {
                type: 'taskList',
                content: [
                    {
                        type: 'taskItem',
                        attrs: { checked: true },
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reflected' }] }]
                    }
                ]
            },
            { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A thought' }] }] },
            { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1\n  whitespace matters' }] }
        ]
    }
    const blocks = toNotion(formatted)
    const enrich = (items: typeof blocks): typeof blocks =>
        items.map((item) => ({
            ...item,
            children: ((item[item.type] as { children?: typeof blocks }).children ?? []).map(
                (child) => enrich([child])[0]
            )
        }))
    expect(toNotion(fromNotion(enrich(blocks)))).toEqual(blocks)
})

it('renders unsupported historical content with a placeholder and child-page links', () => {
    const body = fromNotion([
        { type: 'table', table: {} },
        { type: 'child_page', id: 'abc-def', child_page: { title: 'Earlier reflection' } }
    ])
    expect(plainText(body)).toContain('Unsupported content: table')
    expect(body.content?.[1].content?.[0].marks?.[0].attrs?.href).toBe('https://www.notion.so/abcdef')
})
