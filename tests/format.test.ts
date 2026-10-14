import { describe, expect, it } from 'vitest'

import type { JournalNode } from '../src/shared/model'
import { fromNotion, plainText, toNotion } from '../src/shared/notion-format'

describe('format', () => {
    it('round-trips the accepted formatting including nested lists, links, marks, quotes and code', () => {
        const formatted: JournalNode = {
            content: [
                { attrs: { level: 1 }, content: [{ text: 'Week', type: 'text' }], type: 'heading' },
                {
                    content: [
                        {
                            marks: [
                                { type: 'bold' },
                                { type: 'italic' },
                                { type: 'underline' },
                                { type: 'strike' },
                                { type: 'code' },
                                { attrs: { href: 'https://github.com/example/project' }, type: 'link' }
                            ],
                            text: 'Learning',
                            type: 'text'
                        }
                    ],
                    type: 'paragraph'
                },
                {
                    content: [
                        {
                            content: [
                                { content: [{ text: 'First', type: 'text' }], type: 'paragraph' },
                                {
                                    content: [
                                        {
                                            content: [
                                                { content: [{ text: 'Nested', type: 'text' }], type: 'paragraph' }
                                            ],
                                            type: 'listItem'
                                        }
                                    ],
                                    type: 'orderedList'
                                }
                            ],
                            type: 'listItem'
                        }
                    ],
                    type: 'bulletList'
                },
                {
                    content: [
                        {
                            attrs: { checked: true },
                            content: [{ content: [{ text: 'Reflected', type: 'text' }], type: 'paragraph' }],
                            type: 'taskItem'
                        }
                    ],
                    type: 'taskList'
                },
                {
                    content: [{ content: [{ text: 'A thought', type: 'text' }], type: 'paragraph' }],
                    type: 'blockquote'
                },
                { content: [{ text: 'const a = 1\n  whitespace matters', type: 'text' }], type: 'codeBlock' }
            ],
            type: 'doc'
        }
        const blocks = toNotion(formatted)
        const enrich = (items: typeof blocks): typeof blocks =>
            items.map((item) => ({
                ...item,
                children: ((item[item.type] as { children?: typeof blocks }).children ?? []).map(
                    (child) => enrich([child])[0]
                )
            }))
        expect(toNotion(fromNotion(enrich(blocks)))).toStrictEqual(blocks)
    })

    it('renders unsupported historical content with a placeholder and child-page links', () => {
        const body = fromNotion([
            { table: {}, type: 'table' },
            { child_page: { title: 'Earlier reflection' }, id: 'abc-def', type: 'child_page' }
        ])
        expect(plainText(body)).toContain('Unsupported content: table')
        expect(body.content?.[1].content?.[0].marks?.[0].attrs?.href).toBe('https://www.notion.so/abcdef')
    })
})
